-- Percent discounts on a ticket's lines: one on each work's labour, one on
-- each part. Taken off the price before VAT; the discounted unit price is
-- rounded to the agora (packages/shared/src/catalog.ts: discounted, and
-- issue-invoice: netUnit — the two must agree). The invoice carries only the
-- discounted price.
--
-- Any member may give one. The rule that only an admin may change the price
-- of a work already on a ticket is about the list price, and stays as it was.
--
-- Also: once a ticket has a live bill, its works and parts are frozen, the
-- way its vehicle already is (20261103090000). The invoice was built from
-- those lines; a discount added afterwards would leave the ticket saying one
-- amount and the tax document another. A bill credited in full is marked
-- 'cancelled' by issue-invoice and the lines open again.
--
-- Deploy order: this migration BEFORE the issue-invoice function, which
-- selects the new columns.

-- 1. the columns ---------------------------------------------------------------

alter table public.works
  add column if not exists labor_discount numeric(5,2) not null default 0;
alter table public.works
  drop constraint if exists works_labor_discount_range;
alter table public.works
  add constraint works_labor_discount_range check (labor_discount between 0 and 100);

alter table public.work_items
  add column if not exists discount numeric(5,2) not null default 0;
alter table public.work_items
  drop constraint if exists work_items_discount_range;
alter table public.work_items
  add constraint work_items_discount_range check (discount between 0 and 100);

comment on column public.works.labor_discount is
  'Percent off labor, 0-100. The charged labour is round(labor * (1 - labor_discount/100), 2).';
comment on column public.work_items.discount is
  'Percent off price, 0-100. The charged unit price is round(price * (1 - discount/100), 2); the line is that times qty.';

-- 2. save_ticket_works — recreated from the baseline; only the two inserts
--    change, to carry the discounts. CREATE OR REPLACE keeps its owner,
--    grants and comment. ----------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  w        jsonb;
  wid      uuid;
  p        jsonb;
  admin    boolean := public.is_garage_admin();
  existing jsonb;
  prev     jsonb;
begin
  -- Refuse to touch a ticket the caller cannot see. Without this the delete
  -- below would simply affect zero rows for someone else's ticket, which is
  -- safe but silent; a clear error is better than a no-op that looks like
  -- success.
  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    raise exception 'ticket not found or not in your garage' using errcode = '42501';
  end if;

  -- What the works look like now, keyed by uid, so the wipe below does not take
  -- the only copy of the values the rule is about.
  select coalesce(
           jsonb_object_agg(uid, jsonb_build_object('name', name, 'labor', labor)),
           '{}'::jsonb)
    into existing
    from public.works
   where ticket_id = p_ticket_id;

  if not admin then
    for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
    loop
      prev := existing -> (w->>'uid');
      if prev is not null then
        if coalesce(w->>'name', '') is distinct from coalesce(prev->>'name', '')
           or coalesce((w->>'labor')::numeric, 0)
              is distinct from coalesce((prev->>'labor')::numeric, 0) then
          raise exception 'only an admin can change the name or price of a work on a ticket'
            using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;

  delete from public.works where ticket_id = p_ticket_id;

  for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
  loop
    insert into public.works (ticket_id, uid, code, name, labor, labor_discount, custom, position, notes)
    values (
      p_ticket_id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'labor_discount')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, discount, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'discount')::numeric, 0),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;
end $$;

-- 3. create_ticket — recreated from 20261101090000; only the two inserts
--    change. ---------------------------------------------------------------------

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
    insert into public.works (ticket_id, uid, code, name, labor, labor_discount, custom, position, notes)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'labor_discount')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, discount, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'discount')::numeric, 0),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;

  return jsonb_build_object('id', new_ticket.id, 'key', new_key, 'job', new_job);
end $$;

-- 4. works and parts follow the bill -------------------------------------------
--    Recreated from 20261101090000 with the live-bill check added; the
--    triggers that call it are unchanged.

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

  if exists (
    select 1 from public.invoices
     where ticket_id = tid
       and doc_type in ('invoice_receipt', 'tax_invoice')
       and status = 'issued'
  ) then
    raise exception 'the ticket has an issued invoice and its works cannot be changed'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
