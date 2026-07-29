-- ============================================================
--  Phase 3.7 — a ticket's vehicle becomes the customer's vehicle.
--
--  The vehicles table ("a customer's cars, for ticket auto-complete") and the
--  auto-fill it feeds in App.tsx were both built, but nothing ever wrote a row
--  into it. create_ticket only stored the vehicle denormalised on the tickets
--  row (plate, car, km, year), so the second ticket for a returning customer had
--  no vehicle to suggest — the picker was always empty outside the seed data.
--
--  This closes the loop: when a ticket is created for a resolved customer with a
--  real plate, promote that vehicle into the vehicles table so the next ticket
--  for the same customer auto-fills it.
--
--  Same car, return visit -> update in place, not a duplicate. The key is
--  (customer_id, plate): garage_id is inherited from the customer by trigger, so
--  a customer already scopes a plate to one garage.
--
--  It also fixes vehicle_code, which was a write-only dead end (the form
--  captured it, the data layer dropped it): db.ts now sends it, so it lands on
--  both the ticket and the vehicle. See docs/PRODUCTION.md §3.10.
-- ============================================================

-- The ON CONFLICT target. Not partial: plate is NOT NULL and customer_id is NOT
-- NULL, so no rows can collide on a NULL. The upsert below only ever fires with
-- a real plate, so junk plates ('-' for a walk-in with no car) never get here.
create unique index if not exists vehicles_customer_plate_key
  on public.vehicles (customer_id, plate);

-- ---------- create_ticket, now promoting the vehicle onto the customer ----------
-- Unchanged from 20260725020000 except for the vehicles upsert after the ticket
-- insert; a create-or-replace is the only way to edit an applied function.
create or replace function public.create_ticket(t jsonb, works jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g           uuid := public.current_garage_id();
  next_key    integer;
  next_job    integer;
  new_key     text;
  new_job     text;
  cust_id     uuid;
  cust_name   text := nullif(t->>'customer_name', '');
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

  insert into public.garage_counters (garage_id, last_ticket, last_job)
  values (g, 1, 1)
  on conflict (garage_id) do update
    set last_ticket = public.garage_counters.last_ticket + 1,
        last_job    = public.garage_counters.last_job + 1
  returning last_ticket, last_job into next_key, next_job;

  new_key := 'GAR-' || next_key;
  new_job := 'W-' || next_job;

  -- Identity, not name. ת״ז first (authoritative), then phone (a lookup key),
  -- then create. A ticket with a customer name but neither identifier always
  -- opens a fresh record rather than guessing.
  if v_id_number is not null then
    select id into cust_id from public.customers
      where garage_id = g and id_number = v_id_number
      limit 1;
  elsif v_phone is not null then
    select id into cust_id from public.customers
      where garage_id = g and phone = v_phone
      limit 1;
  end if;

  if cust_id is null and cust_name is not null then
    insert into public.customers (name, phone, email, address, id_number, kind)
    values (
      cust_name, v_phone,
      nullif(t->>'email', ''), nullif(t->>'address', ''), v_id_number,
      case when (t->'flags') ? 'עסקי' then 'עסקי' else 'פרטי' end
    )
    returning id into cust_id;
  elsif cust_id is not null and v_id_number is not null then
    -- Matched by phone but now carrying a ת״ז we lacked; fill it, never overwrite.
    update public.customers set id_number = v_id_number
      where id = cust_id and public.customers.id_number is null;
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
    coalesce((t->>'points')::int, 3), coalesce(t->>'assignee','dk'),
    coalesce(t->>'title',''), v_plate, nullif(t->>'car',''),
    cust_id, cust_name, v_phone, nullif(t->>'email',''),
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
  -- Only when we have both a customer to hang it on and a real plate: a walk-in
  -- with no car sends plate '-' (App.tsx) and must not create a phantom vehicle.
  -- On a return visit the same (customer, plate) updates in place. coalesce keeps
  -- what we already knew when a later ticket leaves a field blank, so a sparse
  -- ticket never erases a fuller record; a supplied value (a fresh km reading)
  -- wins.
  if cust_id is not null and v_plate is not null and v_plate <> '-' then
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
    insert into public.works (ticket_id, uid, code, name, labor, custom, position)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0)
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

revoke all on function public.create_ticket(jsonb, jsonb) from public;
grant execute on function public.create_ticket(jsonb, jsonb) to authenticated;
