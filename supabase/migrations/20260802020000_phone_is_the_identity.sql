-- The phone is the customer identifier. ת״ז rides with it and is optional.
--
-- Two things were wrong, both found by probing the RPC rather than reading it:
--
-- 1. A ת״ז skipped the phone check entirely. Resolution was written as
--    `if v_id_number ... elsif v_phone ...`, so a ticket carrying a ת״ז that
--    matched nothing never consulted the phone at all and inserted a SECOND
--    customer holding a number the first one already had. From that moment the
--    phone stops being an identifier: `limit 1` picks between the two rows
--    arbitrarily, and which person a ticket lands on is luck.
--
--    The order is now: an explicitly picked id, then the phone's digits, then
--    ת״ז. Phone first because it is the identifier; ת״ז second because it is
--    supplementary — it still finds a returning customer whose number we never
--    recorded, but it can no longer route around one we did.
--
-- 2. Filling in a ת״ז could abort the whole ticket. `customers` has a partial
--    unique index on (garage_id, id_number), and the fill did not check whether
--    the number already belonged to somebody else — so opening a ticket with a
--    mistyped ת״ז raised a constraint violation and rolled back the ticket, the
--    works and the parts along with it. The fill now skips a ת״ז already held
--    by another customer, leaving the ticket to be created. The mismatch is the
--    intake form's problem to raise, not a reason to lose the ticket.
--
-- Everything else is unchanged from 20260802010000_pick_customer.sql.

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
  cust_name   text := nullif(t->>'customer_name', '');
  v_id_number text := nullif(t->>'id_number', '');
  v_phone     text := nullif(t->>'phone', '');
  v_digits    text := nullif(regexp_replace(coalesce(t->>'phone', ''), '\D', '', 'g'), '');
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

  -- The phone is the identifier, matched on its digits so punctuation cannot
  -- split one person into two. Always consulted — never skipped by a ת״ז.
  if cust_id is null and v_digits is not null then
    select id into cust_id from public.customers
      where garage_id = g
        and phone is not null
        and regexp_replace(phone, '\D', '', 'g') = v_digits
      limit 1;
  end if;

  -- ת״ז second: it finds a returning customer whose number we never recorded.
  if cust_id is null and v_id_number is not null then
    select id into cust_id from public.customers
      where garage_id = g and id_number = v_id_number
      limit 1;
  end if;

  -- A name alone is not an identity: with neither a phone nor a ת״ז there is
  -- nothing to match on next time, so we do not open a record we could only
  -- ever duplicate. The ticket keeps the name either way.
  if cust_id is null and cust_name is not null
     and (v_id_number is not null or v_digits is not null) then
    insert into public.customers (name, phone, email, address, id_number, kind)
    values (
      cust_name, v_phone,
      nullif(t->>'email', ''), nullif(t->>'address', ''), v_id_number,
      case when (t->'flags') ? 'עסקי' then 'עסקי' else 'פרטי' end
    )
    returning id into cust_id;
  elsif cust_id is not null and v_id_number is not null then
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
  -- file gets this ticket's, so the next visit resolves by phone like any other.
  if cust_id is not null and v_phone is not null then
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
  --
  -- The key is (customer_id, plate), not the plate alone: one car legitimately
  -- belongs to two customers — a couple sharing it, a car sold on — and each
  -- owner gets their own row. That is why the plate is not a customer identity
  -- key above.
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

COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS
  'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer by an explicitly picked (and garage-checked) customer_id, then by the phone''s digits, then by ת״ז, and inserts the ticket with its works and parts in one transaction. The phone is the identifier and is never skipped; ת״ז is supplementary and optional. A name with neither creates no customer. Garage comes from current_garage_id(), never the payload. See docs/PRODUCTION.md §3.4, §3.5, §3.6.';
