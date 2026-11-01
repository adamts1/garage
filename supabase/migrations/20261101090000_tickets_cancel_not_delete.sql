-- A work order is a record the garage must keep: once opened it is never
-- deleted, it stays attached to its customer, and its number is never reused.
--
-- Until now "בטל כרטיס" deleted the row, and its works and parts with it, which
-- left a hole in the GAR- sequence and no trace of the job. Cancelling is now a
-- status: the ticket stays, read-only, with when and why it was cancelled, and
-- the next ticket takes the next number as it always did (garage_counters only
-- ever counts up — create_ticket never reads back a deleted key).
--
-- What this migration enforces, at the database so no client, old bundle or
-- direct API call can get round it:
--   1. 'cancelled' is a ticket status. It is not a board column — COLUMNS in
--      packages/shared/src/types.ts still lists exactly the four that are.
--   2. A ticket cannot be deleted.
--   3. A cancelled ticket cannot be changed, its works and parts included, and
--      cannot be brought back. A job that does come back is a new ticket.
--   4. Cancelling needs a reason, and is refused while the ticket has a live
--      bill: credit it first, the way an invoice itself is cancelled.
--   5. A customer who has tickets cannot be deleted. The foreign key used to
--      SET NULL, which silently detached every one of their tickets.
--   6. Every new ticket is attached to a customer.
--
-- The invoice check reads invoices as the definer, for the same reason
-- create_ticket is one: whether a ticket may be cancelled cannot depend on what
-- the caller happens to be allowed to read.

-- 1. the status ----------------------------------------------------------------

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status = any (array['todo', 'appr', 'done', 'paid', 'cancelled']));

alter table public.tickets
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid,
  add column if not exists cancel_reason text;

-- A cancellation is all three facts or none of them. cancelled_by is not
-- required: a ticket cancelled by the service role (a support fix) has no user.
alter table public.tickets add constraint tickets_cancellation_complete
  check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or nullif(btrim(cancel_reason), '') is not null)
  );

comment on column public.tickets.status is
  'todo (כניסה), appr (ממתין לאישור), done (מוכן), paid (שולם) are the four board columns; see COLUMNS in packages/shared/src/types.ts, which must list exactly those. cancelled (בוטל) is not a column: a cancelled ticket is off the board, read-only, and kept for good — tickets are never deleted. See tickets_guard_lifecycle.';
comment on column public.tickets.cancelled_at is
  'When the ticket was cancelled. Stamped by tickets_guard_lifecycle, never by a client.';
comment on column public.tickets.cancelled_by is
  'auth.users id of whoever cancelled it. Stamped by tickets_guard_lifecycle; NULL for a service-role write.';
comment on column public.tickets.cancel_reason is
  'Why it was cancelled, as typed by the advisor. Required with the status.';

-- 2-4. the lifecycle -------------------------------------------------------------

create or replace function public.tickets_guard_lifecycle() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tickets cannot be deleted — cancel the ticket instead'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'cancelled' then
      raise exception 'a ticket cannot be created cancelled' using errcode = '23514';
    end if;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancel_reason := null;
    return new;
  end if;

  if old.status = 'cancelled' then
    raise exception 'ticket % is cancelled and cannot be changed', old.key
      using errcode = '42501';
  end if;

  if new.status = 'cancelled' then
    if nullif(btrim(new.cancel_reason), '') is null then
      raise exception 'a cancellation needs a reason' using errcode = '23514';
    end if;
    -- A live bill is one still 'issued'. A bill credited in full is marked
    -- 'cancelled' by issue-invoice, so a fully credited ticket may go.
    if exists (
      select 1 from public.invoices
       where ticket_id = new.id
         and doc_type in ('invoice_receipt', 'tax_invoice')
         and status = 'issued'
    ) then
      raise exception 'ticket % has an issued invoice — credit it before cancelling', new.key
        using errcode = '23514';
    end if;
    new.cancel_reason := btrim(new.cancel_reason);
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  else
    -- Not a client's to set: these only ever describe a real cancellation.
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancel_reason := null;
  end if;
  return new;
end $$;

alter function public.tickets_guard_lifecycle() owner to postgres;

comment on function public.tickets_guard_lifecycle() is
  'Tickets are never deleted; a cancelled one is frozen; cancelling needs a reason and no issued bill, and is stamped here. See 20261101090000_tickets_cancel_not_delete.sql.';

drop trigger if exists tickets_guard_lifecycle on public.tickets;
create trigger tickets_guard_lifecycle
  before insert or update or delete on public.tickets
  for each row execute function public.tickets_guard_lifecycle();

-- Works and parts are part of the record. save_ticket_works wipes and
-- reinserts them, so without this a cancelled ticket's lines could still be
-- rewritten even though the ticket row itself is frozen.
create or replace function public.works_follow_ticket_lock() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  tid uuid;
begin
  if tg_table_name = 'works' then
    tid := coalesce(new.ticket_id, old.ticket_id);
  else
    select w.ticket_id into tid from public.works w
     where w.id = coalesce(new.work_id, old.work_id);
  end if;

  if exists (select 1 from public.tickets where id = tid and status = 'cancelled') then
    raise exception 'the ticket is cancelled and its works cannot be changed'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

alter function public.works_follow_ticket_lock() owner to postgres;

drop trigger if exists works_follow_ticket_lock on public.works;
create trigger works_follow_ticket_lock
  before insert or update or delete on public.works
  for each row execute function public.works_follow_ticket_lock();

drop trigger if exists work_items_follow_ticket_lock on public.work_items;
create trigger work_items_follow_ticket_lock
  before insert or update or delete on public.work_items
  for each row execute function public.works_follow_ticket_lock();

-- The two clock stamps clear themselves when a ticket leaves done/paid. That is
-- right for a ticket reopened for more work, and wrong for one being cancelled:
-- when it was finished and when it was paid are part of what is being kept.
-- Recreated with that one early return; otherwise verbatim.

create or replace function public.stamp_paid_at() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  if tg_op = 'UPDATE' and new.status = 'cancelled' then
    return new;   -- keep the history the ticket is being frozen with
  end if;
  if tg_op = 'INSERT' then
    -- A ticket can be created already settled (an over-the-counter sale).
    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := now();
  elsif new.status is distinct from 'paid' then
    -- Back out of שולם: the clock is off, and the ticket is live again.
    new.paid_at := null;
  end if;
  return new;
end $$;

create or replace function public.stamp_closed_at() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
  finished boolean := new.status in ('done', 'paid');
begin
  if tg_op = 'UPDATE' and new.status = 'cancelled' then
    return new;   -- keep the history the ticket is being frozen with
  end if;
  if tg_op = 'INSERT' then
    if finished then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
    return new;
  end if;

  /* Only the FIRST arrival is stamped: 'done' → 'paid' is the same job
     finishing and then being paid for, and re-stamping on the second step would
     restart the clock on a debt at the moment it is settled — precisely
     backwards. Going back to open work clears it, so a job reopened for a
     comeback is not still aging against its first visit. */
  if finished and old.status not in ('done', 'paid') then
    new.closed_at := now();
  elsif not finished then
    new.closed_at := null;
  end if;
  return new;
end $$;

-- 5. the customer link -----------------------------------------------------------

alter table public.tickets drop constraint if exists tickets_customer_id_fkey;
alter table public.tickets add constraint tickets_customer_id_fkey
  foreign key (customer_id) references public.customers (id) on delete restrict;

-- 6. every new ticket has a customer ---------------------------------------------
--
-- create_ticket used to open a customer only when it had a phone or a ת״ז to
-- match on next time, and leave a name-only ticket unattached. Both intake
-- forms require a name and a phone, so in practice that branch was a direct API
-- call; it now opens the record anyway, because a ticket that belongs to nobody
-- is the one thing the rule forbids. No name at all is refused.
-- Otherwise verbatim from the baseline.

CREATE OR REPLACE FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  g           uuid := public.current_garage_id();
  next_key    integer;
  next_job    integer;
  new_key     text;
  new_job     text;
  cust_id     uuid;
  picked_id   uuid;
  cust_name   text := nullif(btrim(t->>'customer_name'), '');
  v_id_number text := nullif(t->>'id_number', '');
  v_phone     text := nullif(t->>'phone', '');
  v_plate     text := nullif(t->>'plate', '');
  new_ticket  public.tickets;
  w           jsonb;
  wid         uuid;
  p           jsonb;
begin
  if g is null then
    raise exception 'no garage for the current session' using errcode = '42501';
  end if;

  -- A picked customer beats any derivation: the advisor looked at the record
  -- and said "this one". Only ours, and only if it still exists.
  begin
    picked_id := nullif(t->>'customer_id', '')::uuid;
  exception when invalid_text_representation then
    picked_id := null;   -- garbage in the field is ignored, not fatal
  end;

  if picked_id is not null then
    select id into cust_id from public.customers
      where id = picked_id and garage_id = g;
  end if;

  -- Checked before a number is taken, so a refused ticket does not burn one.
  if cust_id is null and cust_name is null then
    raise exception 'a ticket must belong to a customer — the customer name is required'
      using errcode = '23502';
  end if;

  insert into public.garage_counters (garage_id, last_ticket, last_job)
  values (g, 1, 1)
  on conflict (garage_id) do update
    set last_ticket = public.garage_counters.last_ticket + 1,
        last_job    = public.garage_counters.last_job + 1
  returning last_ticket, last_job into next_key, next_job;

  new_key := 'GAR-' || next_key;
  new_job := 'W-' || next_job;

  -- ת״ז next, and it is the only derivation left. It identifies because the
  -- database will not let two customers hold one: a match is that person, and
  -- not somebody who happens to answer the same telephone.
  --
  -- The phone is not consulted: one number legitimately belongs to several
  -- customers — a household shares a line, a company answers for eleven vans.
  -- The intake forms name the holder and offer to attach the ticket to them;
  -- taking the offer sends customer_id, which is handled above.
  if cust_id is null and v_id_number is not null then
    select id into cust_id from public.customers
      where garage_id = g and id_number = v_id_number
      limit 1;
  end if;

  if cust_id is null then
    insert into public.customers (name, phone, email, address, id_number, kind)
    values (
      cust_name, v_phone,
      nullif(t->>'email', ''), nullif(t->>'address', ''), v_id_number,
      case when (t->'flags') ? 'business' then 'business' else 'private' end
    )
    returning id into cust_id;
  elsif v_id_number is not null then
    -- Fill a ת״ז we lacked; never overwrite one already on file, and never one
    -- another customer here already holds — the partial unique index would
    -- raise and take the whole ticket down with it.
    update public.customers set id_number = v_id_number
      where id = cust_id
        and public.customers.id_number is null
        and not exists (
          select 1 from public.customers other
           where other.garage_id = g and other.id_number = v_id_number
        );
  end if;

  -- Same for the phone: a picked (or ת״ז-matched) customer with no number on
  -- file gets this ticket's.
  if v_phone is not null then
    update public.customers set phone = v_phone
      where id = cust_id and public.customers.phone is null;
  end if;

  insert into public.tickets (
    key, job, status, type, epic, priority, points, assignee, title, plate, car,
    customer_id, customer_name, phone, email, address, km, year, amount, done,
    subtasks, flags, due, blocked, notes, paid, pay_method, doc, reference,
    id_number, vehicle_code
  )
  values (
    new_key, new_job,
    coalesce(t->>'status','todo'), coalesce(t->>'type','job'),
    coalesce(t->>'epic','service'), coalesce(t->>'priority','med'),
    coalesce((t->>'points')::int, 3), nullif(t->>'assignee',''),
    coalesce(t->>'title',''), v_plate, nullif(t->>'car',''),
    cust_id, coalesce(cust_name, (select name from public.customers where id = cust_id)),
    v_phone, nullif(t->>'email',''),
    nullif(t->>'address',''), nullif(t->>'km',''), nullif(t->>'year',''),
    coalesce((t->>'amount')::numeric, 0), coalesce((t->>'done')::int, 0),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(t->'subtasks')), '{}'),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(t->'flags')), '{}'),
    nullif(t->>'due',''), nullif(t->>'blocked',''), nullif(t->>'notes',''),
    coalesce((t->>'paid')::boolean, false), nullif(t->>'pay_method',''),
    nullif(t->>'doc',''), nullif(t->>'reference',''),
    v_id_number, nullif(t->>'vehicle_code','')
  )
  returning * into new_ticket;

  -- Promote the vehicle onto the customer so the next ticket auto-fills it.
  -- Only with a real plate: a walk-in with no car sends plate '-' (App.tsx) and
  -- must not create a phantom vehicle. On a return visit the same (customer,
  -- plate) updates in place. coalesce keeps what we already knew when a later
  -- ticket leaves a field blank, so a sparse ticket never erases a fuller
  -- record; a supplied value (a fresh km reading) wins.
  --
  -- The key is (customer_id, plate), not the plate alone: one car legitimately
  -- belongs to two customers — a couple sharing it, a car sold on — and each
  -- owner gets their own row.
  if v_plate is not null and v_plate <> '-' then
    insert into public.vehicles (
      customer_id, plate, manufacturer, model, year, km, vehicle_code
    )
    values (
      cust_id, v_plate,
      nullif(t->>'manufacturer',''), nullif(t->>'model',''),
      nullif(t->>'year',''), nullif(t->>'km',''), nullif(t->>'vehicle_code','')
    )
    on conflict (customer_id, plate) do update set
      manufacturer = coalesce(excluded.manufacturer, public.vehicles.manufacturer),
      model        = coalesce(excluded.model,        public.vehicles.model),
      year         = coalesce(excluded.year,         public.vehicles.year),
      km           = coalesce(excluded.km,           public.vehicles.km),
      vehicle_code = coalesce(excluded.vehicle_code, public.vehicles.vehicle_code);
  end if;

  for w in select * from jsonb_array_elements(works)
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position, notes)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;

  return jsonb_build_object('id', new_ticket.id, 'key', new_key, 'job', new_job);
end $$;

COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS 'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer by an explicitly picked (and garage-checked) customer_id and then by ת״ז, opens a customer when neither matches, and inserts the ticket with its works and parts in one transaction. Every ticket belongs to a customer; a ticket with no customer name and no picked customer is refused before a number is taken. The phone is NOT resolved by: one number legitimately belongs to several customers. Garage comes from current_garage_id(), never the payload. See 20261101090000_tickets_cancel_not_delete.sql and docs/PRODUCTION.md §3.4-§3.6.';
