-- VAT discount (הנחת מע״מ) on a ticket's lines: one flag on each work's
-- labour, one on each part.
--
-- A flagged line keeps the price it shows, and the customer pays exactly that
-- for it: VAT still goes on at the end and still appears on the invoice, but
-- the line is charged, before VAT, the price that comes back to what it shows
-- (500 is charged 423.73; 423.73 + 18% = 500.00). Per unit, after any percent
-- discount, to the agora — packages/shared/src/catalog.ts (partUnitCharged,
-- laborCharged) and issue-invoice (chargedUnit) compute it and must agree.
-- The invoice carries only the charged unit price, as it does for the percent
-- discount.
--
-- Any member may give one, like the percent discount. The lines freeze under a
-- live bill exactly as before (works_follow_ticket_lock, 20261103100000).
--
-- Depends on 20261105090000 (create_ticket is recreated from it).
-- Deploy order: this migration BEFORE the issue-invoice function, which
-- selects the new columns.

-- 1. the columns ---------------------------------------------------------------

alter table public.works
  add column if not exists labor_vat_discount boolean not null default false;
alter table public.work_items
  add column if not exists vat_discount boolean not null default false;

comment on column public.works.labor_vat_discount is
  'הנחת מע״מ: the labour as shown (after labor_discount) is what the customer pays for it including VAT. Charged pre-VAT at the agora price that comes back to it.';
comment on column public.work_items.vat_discount is
  'הנחת מע״מ: the unit price as shown (after discount) is what the customer pays for it including VAT. Charged pre-VAT at the agora price that comes back to it.';

-- 2. save_ticket_works — recreated from 20261103100000; only the two inserts
--    change, to carry the flags. CREATE OR REPLACE keeps its owner, grants and
--    comment. ---------------------------------------------------------------------

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
    insert into public.works (ticket_id, uid, code, name, labor, labor_discount, labor_vat_discount, custom, position, notes)
    values (
      p_ticket_id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'labor_discount')::numeric, 0),
      coalesce((w->>'labor_vat_discount')::boolean, false),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, discount, vat_discount, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'discount')::numeric, 0),
        coalesce((p->>'vat_discount')::boolean, false),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;
end $$;

-- 3. create_ticket — recreated from 20261105090000; only the two inserts
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
    insert into public.works (ticket_id, uid, code, name, labor, labor_discount, labor_vat_discount, custom, position, notes)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'labor_discount')::numeric, 0),
      coalesce((w->>'labor_vat_discount')::boolean, false),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, discount, vat_discount, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'discount')::numeric, 0),
        coalesce((p->>'vat_discount')::boolean, false),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;

  return jsonb_build_object('id', new_ticket.id, 'key', new_key, 'job', new_job);
end $$;
