-- Per-work notes on a ticket, and the first role a garage member can have.
--
-- Two roles, deliberately: `admin` and `member`. The only thing the distinction
-- decides today is who may change the NAME or the PRICE of a work already on a
-- ticket — the numbers a customer is charged. Everything else a member could do
-- before, they still can: add a work from the catalog, remove one, edit its
-- parts, and now write a note against it.
--
-- Existing members all become admins. A migration that silently demoted the
-- person who onboarded the garage would lock them out of their own prices, and
-- the only way back in is the service_role key.
--
-- WHY THE CHECK IS IN THE FUNCTION AND NOT IN A POLICY
--
-- save_ticket_works replaces a ticket's works wholesale: delete every row, then
-- re-insert from the payload. At the row level "I edited a work" and "I added a
-- work" are the same INSERT, so a policy that refused the first would refuse
-- the second too, and a member could no longer add anything. The rule needs the
-- BEFORE value to be expressible at all, so it lives where both values are in
-- scope: inside the function, across the delete.

alter table public.works add column if not exists notes text;

comment on column public.works.notes is
  'What was actually done, written against this work on this ticket. Any member may write it — it records labour, it does not price it. Like name and labor, it belongs to the ticket''s copy of the work and never to the work_defs entry it came from.';

alter table public.garage_members
  add column if not exists role text not null default 'member';

-- Added separately so the update below runs against rows the constraint has not
-- yet judged; 'member' is the column default and every existing row is about to
-- become 'admin' anyway.
alter table public.garage_members drop constraint if exists garage_members_role_check;
alter table public.garage_members
  add constraint garage_members_role_check check (role in ('admin', 'member'));

update public.garage_members set role = 'admin';

comment on column public.garage_members.role is
  'admin or member. Decides who may change the name or price of a work already on a ticket; a member may still add, remove and annotate. Assigned by scripts/onboard-garage.mjs — there is no in-app role editor, so an admin cannot demote themselves by accident.';


/* Is the caller an admin of the garage they belong to?

   SECURITY INVOKER on purpose. garage_members_read_own already lets a user read
   their own row and nobody else's, so this needs no elevated privilege — and a
   SECURITY DEFINER function reading a membership table is exactly the kind of
   thing that turns into a tenancy hole when someone later adds a parameter. */
create or replace function public.is_garage_admin() returns boolean
    language sql stable
    set search_path to ''
    as $$
  select exists (
    select 1 from public.garage_members
     where user_id = (select auth.uid()) and role = 'admin'
  )
$$;

alter function public.is_garage_admin() owner to postgres;
revoke all on function public.is_garage_admin() from public;
grant execute on function public.is_garage_admin() to authenticated;

comment on function public.is_garage_admin() is
  'Whether the current user is an admin of their garage. SECURITY INVOKER: garage_members_read_own is the boundary, not this function.';


/* my_garages gains the role.

   This is already how the apps learn which garage they are in, and the role is
   the same kind of fact about the same membership — a second round trip to
   fetch it would only create a window where the app knows the garage but not
   what it may do in it. */
drop function if exists public.my_garages();

create or replace function public.my_garages()
  returns table("garage_id" uuid, "garage_name" text, "role" text)
    language sql stable
    set search_path to ''
    as $$
  select g.id, g.name, m.role
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  where m.user_id = (select auth.uid())
  order by g.name
$$;

alter function public.my_garages() owner to postgres;
revoke all on function public.my_garages() from public;
grant execute on function public.my_garages() to authenticated;

comment on function public.my_garages() is
  'Garages the current user belongs to, with their role in each. Empty for anon and for a user with no membership — the login gate must treat both as "cannot proceed". See docs/PRODUCTION.md §5 Phase 2b.';


/* Replace a ticket's works, now carrying notes and refusing a repricing from
   somebody who may not reprice.

   The snapshot is taken before the delete and compared by uid. A uid that was
   not there before is a new work — a member may add those freely, including a
   custom one. A uid that was there and comes back with a different name or a
   different labor is an edit, and that is what admins are for.

   The comparison is on labor and name only. Parts, position and the custom flag
   are not priced by this rule and stay open, which is what keeps a member able
   to do the job: pull in a work, add the parts it turned out to need, write
   down what happened. */
create or replace function public.save_ticket_works("p_ticket_id" uuid, "works" jsonb) returns void
    language plpgsql
    set search_path to ''
    as $$
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
    insert into public.works (ticket_id, uid, code, name, labor, custom, position, notes)
    values (
      p_ticket_id,
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
end $$;

alter function public.save_ticket_works(uuid, jsonb) owner to postgres;

comment on function public.save_ticket_works(uuid, jsonb) is
  'Replace a ticket''s works and parts in one transaction — the delete and the re-inserts land together or not at all. A non-admin may add, remove and annotate works but may not change the name or price of one already there; that is checked against a snapshot taken before the delete, since the wipe-and-reinsert makes an edit and an insert indistinguishable at the row level. SECURITY INVOKER: the caller''s RLS is the ownership check. See docs/PRODUCTION.md §3.5.';


/* create_ticket carries the note too.

   A work can be annotated the moment the ticket is opened, not only later, so
   the create path has to accept the same field the save path does. No admin
   check here: creating a ticket is not editing one, and every member opens
   tickets. Otherwise identical to 20260802020000. */

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


/* The catalog joins the realtime publication.

   Without this, subscribeToTable('work_defs') attaches to a channel that can
   never fire: a table absent from supabase_realtime emits nothing, and the
   subscription looks alive in the code while the screen silently goes stale.
   work_defs already has REPLICA IDENTITY FULL from the baseline. */
ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."work_defs";
