-- Stored values stop being Hebrew words.
--
-- `customers.kind` and `tickets.flags` were enums written as the Hebrew text a
-- screen happened to display. That made every one of them two things at once: a
-- value the database matches on, and a label. Renaming the label would have
-- rewritten data; translating the app would have changed what a row means; and
-- the intake forms in the two apps each carried their own copy of the words,
-- with nothing keeping them in step.
--
-- After this they are codes. What a user reads is looked up per app, in that
-- app's own locale file, from the code — which is the only arrangement where a
-- wording change is a wording change.
--
-- Written to be safe to run twice: every backfill matches the old value and
-- leaves an already-migrated row alone.

-- ---------------------------------------------------------------- customers.kind

-- Anything that is not the business word becomes private, including the legacy
-- default and any row that arrived with something unexpected in the column.
UPDATE "public"."customers"
   SET "kind" = CASE WHEN "kind" = 'עסקי' THEN 'business' ELSE 'private' END
 WHERE "kind" NOT IN ('private', 'business');

ALTER TABLE "public"."customers"
  ALTER COLUMN "kind" SET DEFAULT 'private'::"text";

-- The constraint is the point: without it the column drifts back into free text
-- the first time something writes to it directly.
ALTER TABLE "public"."customers"
  DROP CONSTRAINT IF EXISTS "customers_kind_check";

ALTER TABLE "public"."customers"
  ADD CONSTRAINT "customers_kind_check" CHECK ("kind" IN ('private', 'business'));

COMMENT ON COLUMN "public"."customers"."kind" IS
  'private | business. A code, not a label — the apps translate it for display. See packages/shared/src/identity.ts.';

-- ---------------------------------------------------------------- tickets.flags

-- No application code has ever read these: both intake forms write them and
-- nothing else touches them, so this rewrite cannot break a screen. It is done
-- anyway, because a column half in Hebrew and half in codes is worse than
-- either.
--
-- Six values, not two: the garages' imported data carries four more flags that
-- no code has ever written or read. They are mapped anyway, because a column
-- that is half codes and half Hebrew is worse than either.
UPDATE "public"."tickets"
   SET "flags" = (
         SELECT COALESCE("array_agg"(
                  CASE "f"
                    WHEN 'מפתח התקבל'       THEN 'key_received'
                    WHEN 'חדש'               THEN 'new'
                    WHEN 'עסקי'              THEN 'business'
                    WHEN 'חוסם עבודה'        THEN 'blocked'
                    WHEN 'מוכן לאיסוף'       THEN 'ready_for_pickup'
                    WHEN 'ממתין אישור לקוח'  THEN 'awaiting_approval'
                    WHEN 'VIP'               THEN 'vip'
                    ELSE "f"
                  END
                  ORDER BY "ord"
                ), '{}')
           FROM "unnest"("tickets"."flags") WITH ORDINALITY AS "u"("f", "ord")
       )
 WHERE EXISTS (
         SELECT 1 FROM "unnest"("tickets"."flags") AS "f"
          WHERE "f" IN ('מפתח התקבל', 'חדש', 'עסקי', 'חוסם עבודה', 'מוכן לאיסוף',
                        'ממתין אישור לקוח', 'VIP')
       );

COMMENT ON COLUMN "public"."tickets"."flags" IS
  'Codes, not labels: new | key_received | business | blocked | ready_for_pickup | awaiting_approval | vip. See TICKET_FLAGS in packages/shared/src/intake.ts.';

-- ---------------------------------------------------------------- create_ticket

/* Identical to 20260803000000 but for one line: the flag that marks a business
   customer is now the code rather than the Hebrew word. That branch has never
   fired — neither intake form sends the flag — so this changes no behaviour
   today; it changes what the function will do when one of them starts to. */

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
      case when (t->'flags') ? 'business' then 'business' else 'private' end
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

COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS
  'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer, and inserts the ticket with its works and parts in one transaction. Garage comes from current_garage_id(), never the payload. Customer kind and ticket flags are codes, not Hebrew labels. See docs/PRODUCTION.md §3.4, §3.5.';
