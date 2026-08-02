-- create_ticket honours an explicitly picked customer.
--
-- The intake form's search box lets an advisor choose an existing customer, and
-- until now the choice was thrown away: only the name and phone were copied out
-- of the record, and the server re-derived the identity from those. That works
-- for anybody who has a phone on file, and duplicates anybody who does not —
-- pick a customer saved years ago with no number, type one in, and the ticket
-- opens a second copy of the person you just selected.
--
-- So `customer_id` now rides in the payload and is preferred over matching.
-- It is CHECKED, not trusted: the row must exist and belong to the caller's
-- garage. This function is SECURITY DEFINER, so RLS does not do that for us,
-- and an unchecked id would let a forged payload hang a ticket on another
-- garage's customer. An id that fails the check is ignored rather than fatal —
-- resolution falls through to ת״ז, then the phone's digits, exactly as before.
--
-- Everything else is unchanged from 20260802000000_customer_identity.sql.

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

  -- Identity, not name. ת״ז first (authoritative), then the phone's digits.
  if cust_id is null then
    if v_id_number is not null then
      select id into cust_id from public.customers
        where garage_id = g and id_number = v_id_number
        limit 1;
    elsif v_digits is not null then
      select id into cust_id from public.customers
        where garage_id = g
          and phone is not null
          and regexp_replace(phone, '\D', '', 'g') = v_digits
        limit 1;
    end if;
  end if;

  -- A name alone is not an identity: with neither ת״ז nor phone there is
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
    -- Fill a ת״ז we lacked; never overwrite one already on file.
    update public.customers set id_number = v_id_number
      where id = cust_id and public.customers.id_number is null;
  end if;

  -- Same for the phone: a picked (or ת״ז-matched) customer with no number on
  -- file gets this ticket's, so the next visit can find them by phone too.
  -- This is what closes the loop for the phoneless records already in the
  -- table — pick them once, and they stop being unmatchable.
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
  'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer by an explicitly picked (and garage-checked) customer_id, then ת״ז, then the phone''s digits, and inserts the ticket with its works and parts in one transaction. A name with neither identifier creates no customer. Garage comes from current_garage_id(), never the payload. See docs/PRODUCTION.md §3.4, §3.5, §3.6.';
