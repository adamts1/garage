-- One name on one phone is one customer.
--
-- Neither is an identity alone, and that stays: a household and a fleet
-- share a number, and two people share a name. But the same name on the same
-- number is the same person entered twice, and the garage asked (2026-11-05)
-- that it never be stored twice — not even with two different ת״ז.
--
-- Compared loosely, the way the apps compare them (packages/shared/src/
-- identity.ts: looseName, phoneDigits): the name trimmed, spaces collapsed,
-- lower-cased; the phone on its digits. "משה  כהן" on 050-1234567 is
-- "משה כהן" on 0501234567.
--
-- A trigger rather than a unique index, because records entered before this
-- rule may already break it, and an index would refuse to build until someone
-- merged them. The trigger leaves those alone and stops new ones — a write
-- that does not touch the name or the phone is not checked. It raises 23505
-- naming customers_garage_name_phone_key, which the web app turns into words.
--
-- create_ticket now resolves a typed name + phone to the record holding them,
-- after a picked customer and after the ת״ז, instead of opening a second one.

-- 1. the keys -----------------------------------------------------------------

create or replace function public.customer_name_key(n text) returns text
language sql immutable
set search_path = ''
as $$ select nullif(lower(regexp_replace(btrim(coalesce(n, '')), '\s+', ' ', 'g')), '') $$;

comment on function public.customer_name_key(text) is
  'A customer name as compared: trimmed, inner spaces collapsed, lower-cased. Mirrors looseName in packages/shared/src/identity.ts.';

create or replace function public.phone_key(p text) returns text
language sql immutable
set search_path = ''
as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

comment on function public.phone_key(text) is
  'A phone as compared: digits only. Mirrors phoneDigits in packages/shared/src/identity.ts.';

create index if not exists customers_garage_name_phone_idx
  on public.customers (garage_id, public.customer_name_key(name), public.phone_key(phone))
  where phone is not null;

-- 2. the rule -----------------------------------------------------------------

create or replace function public.customers_name_phone_unique() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  holder text;
begin
  if public.customer_name_key(new.name) is null or public.phone_key(new.phone) is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and public.customer_name_key(new.name) is not distinct from public.customer_name_key(old.name)
     and public.phone_key(new.phone) is not distinct from public.phone_key(old.phone) then
    return new;
  end if;

  select c.name into holder from public.customers c
   where c.garage_id = new.garage_id
     and c.id <> new.id
     and c.phone is not null
     and public.customer_name_key(c.name) = public.customer_name_key(new.name)
     and public.phone_key(c.phone) = public.phone_key(new.phone)
   limit 1;

  if found then
    raise exception 'duplicate key value violates unique constraint "customers_garage_name_phone_key"'
      using errcode = '23505',
            detail = format('A customer named %s with this phone is already on file.', holder);
  end if;
  return new;
end $$;

drop trigger if exists customers_name_phone_unique on public.customers;
create trigger customers_name_phone_unique
  before insert or update of name, phone on public.customers
  for each row execute function public.customers_name_phone_unique();

-- 3. create_ticket — recreated from 20261103100000; only the customer
--    resolution changes (the name + phone step). CREATE OR REPLACE keeps its
--    owner and grants. -----------------------------------------------------------

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

  -- Then the name and the phone together. Either alone is shared by several
  -- customers; both together are one customer (20261105090000), and the
  -- trigger there refuses a second record for them. So a ticket typed with a
  -- name and a number already on file belongs to that record — opening a new
  -- one would only be refused and take the ticket down with it.
  if cust_id is null and cust_name is not null and v_phone is not null then
    select id into cust_id from public.customers
      where garage_id = g
        and public.customer_name_key(name) = public.customer_name_key(cust_name)
        and public.phone_key(phone) = public.phone_key(v_phone)
      order by created_at
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


COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS 'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer by an explicitly picked (and garage-checked) customer_id, then by ת״ז, then by name and phone together, opens a customer when none matches, and inserts the ticket with its works and parts in one transaction. Every ticket belongs to a customer; a ticket with no customer name and no picked customer is refused before a number is taken. The phone alone is NOT resolved by: one number legitimately belongs to several customers. Garage comes from current_garage_id(), never the payload. See 20261105090000_customer_name_phone_unique.sql and docs/PRODUCTION.md §3.4-§3.6.';
