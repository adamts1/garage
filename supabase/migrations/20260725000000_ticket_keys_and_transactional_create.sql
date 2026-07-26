-- ============================================================
--  Phase 3.4 + 3.5 — ticket keys stop racing, and creation becomes atomic.
--
--  Two bugs, one fix, because they share a transaction.
--
--  3.4: the client computed the next key as `GAR-${max+1}` from whatever tickets
--  it had in memory (App.tsx). Two service advisors creating a ticket at the
--  same second computed the same number. The key column's global UNIQUE would
--  then reject the second insert — but only after the flip made keys per-garage
--  did "GAR-1 in two different garages" become legitimate, so the constraint
--  itself has to change too.
--
--  3.5: createTicket inserted the ticket, then saveWorks deleted and re-inserted
--  the works in separate statements with no transaction around them. A failure
--  between the ticket insert and the works insert left a ticket with no job
--  lines. Nothing rolled back.
--
--  Both are solved by moving creation into one SECURITY DEFINER function that
--  runs in a single transaction: assign the key atomically, insert the ticket,
--  insert its works and parts, or roll the whole thing back.
-- ============================================================

-- ---------- keys are unique within a garage, not the world ----------
-- Same change items.sku got in 2c, and for the same reason: GAR-1 belongs to
-- each garage, so a global unique is wrong now.
alter table public.tickets drop constraint if exists tickets_key_key;
alter table public.tickets add constraint tickets_garage_key_key unique (garage_id, key);

-- ---------- the counters ----------
-- One row per garage holding the last number handed out for tickets (GAR-N) and
-- jobs (W-N). Incremented under a row lock, so two concurrent creates serialise
-- on this row and get consecutive numbers instead of colliding.
create table if not exists public.garage_counters (
  garage_id   uuid primary key references public.garages(id) on delete cascade,
  last_ticket integer not null default 0,
  last_job    integer not null default 0
);

alter table public.garage_counters enable row level security;
-- No policy: only the SECURITY DEFINER function below touches this table. The
-- app has no business reading or writing it directly.
grant select, insert, update on public.garage_counters to service_role;

-- Seed from existing data so numbering continues rather than restarting at 1 and
-- colliding with tickets already out there. The suffix after the dash is the
-- number; anything that does not parse is ignored via NULLIF/regexp.
insert into public.garage_counters (garage_id, last_ticket, last_job)
select
  t.garage_id,
  coalesce(max(nullif(regexp_replace(t.key, '\D', '', 'g'), ''))::int, 0),
  coalesce(max(nullif(regexp_replace(coalesce(t.job, ''), '\D', '', 'g'), ''))::int, 0)
from public.tickets t
group by t.garage_id
on conflict (garage_id) do update
  set last_ticket = greatest(public.garage_counters.last_ticket, excluded.last_ticket),
      last_job    = greatest(public.garage_counters.last_job,    excluded.last_job);

-- ============================================================
--  create_ticket — the one atomic path for a new ticket.
--
--  SECURITY DEFINER so it can touch garage_counters, which the caller cannot.
--  Because it bypasses RLS, it takes the garage from current_garage_id() and
--  NEVER from the payload: a caller cannot create a ticket in another garage by
--  forging a field. current_garage_id() still resolves here — it reads auth.uid()
--  from the JWT, which is present regardless of the function's security context.
--
--  Customer resolution lives inside the transaction too. This is not the full
--  3.6 fix (matching is still by name, improved in a later migration), but
--  moving it here already kills 3.6's worst symptom: the client did
--  .maybeSingle(), which THROWS when two customers share a name and breaks
--  ticket creation outright. `select ... limit 1` in SQL simply picks one, so
--  creation no longer breaks — it just still needs a stable key, which comes
--  next.
--
--  Returns the created ticket's id and the server-assigned key/job, so the
--  optimistic client can reconcile the temporary key it painted with the real
--  one.
-- ============================================================
create or replace function public.create_ticket(t jsonb, works jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g          uuid := public.current_garage_id();
  next_key   integer;
  next_job   integer;
  new_key    text;
  new_job    text;
  cust_id    uuid;
  cust_name  text := nullif(t->>'customer_name', '');
  v_id_number text := nullif(t->>'id_number', '');
  new_ticket public.tickets;
  w          jsonb;
  wid        uuid;
  p          jsonb;
begin
  if g is null then
    raise exception 'no garage for the current session' using errcode = '42501';
  end if;

  -- Atomic per-garage numbering. The row is created on first use, then locked
  -- and incremented; concurrent callers block here and leave with distinct
  -- numbers rather than racing on a client-side max.
  insert into public.garage_counters (garage_id, last_ticket, last_job)
  values (g, 1, 1)
  on conflict (garage_id) do update
    set last_ticket = public.garage_counters.last_ticket + 1,
        last_job    = public.garage_counters.last_job + 1
  returning last_ticket, last_job into next_key, next_job;

  new_key := 'GAR-' || next_key;
  new_job := 'W-' || next_job;

  -- Resolve or create the customer, in-transaction. limit 1, not maybeSingle:
  -- a duplicate name must not abort ticket creation.
  if cust_name is not null then
    select id into cust_id from public.customers
      where garage_id = g and name = cust_name
      limit 1;
    if cust_id is null then
      insert into public.customers (name, phone, email, address, id_number, kind)
      values (
        cust_name,
        nullif(t->>'phone', ''),
        nullif(t->>'email', ''),
        nullif(t->>'address', ''),
        v_id_number,
        case when (t->'flags') ? 'עסקי' then 'עסקי' else 'פרטי' end
      )
      returning id into cust_id;
    elsif v_id_number is not null then
      -- fill a ת״ז we lacked; never overwrite one we have
      update public.customers set id_number = v_id_number
        where id = cust_id and public.customers.id_number is null;
    end if;
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
    coalesce(t->>'title',''), nullif(t->>'plate',''), nullif(t->>'car',''),
    cust_id, cust_name, nullif(t->>'phone',''), nullif(t->>'email',''),
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

  -- Works and their parts. garage_id on each is set by the inheritance triggers
  -- from 2a/2c, so it is never taken from the payload.
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

comment on function public.create_ticket(jsonb, jsonb) is
  'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, '
  'resolves the customer, and inserts the ticket with its works and parts in one '
  'transaction. Garage comes from current_garage_id(), never the payload. '
  'See docs/PRODUCTION.md §3.4, §3.5.';
