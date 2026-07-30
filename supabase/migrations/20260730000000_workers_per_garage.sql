-- ============================================================
--  Phase 3.8 — the team becomes data, and becomes per-garage.
--
--  Until now the mechanics a ticket could be assigned to were four hardcoded
--  people in packages/shared/src/types.ts:
--
--    dk דני כהן   il עידו לוי   ns נועה שמש   am אבי מזרחי
--
--  They are invented. Every garage onboarded saw the same four names and could
--  assign work to none of its own staff, and the names were baked into a
--  released binary, so correcting them meant an App Store review.
--
--  Worse, the list was enforced in the database: tickets.assignee carried
--  `check (assignee in ('dk','il','ns','am'))` and `default 'dk'`. A real
--  garage could not record who actually did the job even by writing SQL, and a
--  ticket created without an assignee was silently attributed to a person who
--  does not exist.
--
--  This is the same move already made for the works catalog in
--  20260723000000_catalog_per_garage.sql, and it follows that migration's
--  shape deliberately: a per-garage table, tenant policies from the start,
--  explicit grants, no demo_all.
--
--  Two decisions worth stating, because both are load-bearing:
--
--  * assignee stays a per-garage `code`, not a uuid. Existing tickets already
--    hold 'dk'/'il'/'ns'/'am', so keeping the column's type lets a foreign key
--    adopt that data in place instead of a rewrite that could drop history.
--
--  * assignee becomes NULLABLE. A garage that has entered no workers yet must
--    still be able to open a ticket, and "nobody is assigned" is a real state
--    a board needs to show. It is not the same as a phantom default.
-- ============================================================

-- ---------- 1. the team ----------
create table if not exists public.garage_workers (
  id         uuid primary key default gen_random_uuid(),
  -- Defaulted to the caller's garage for the same reason as work_defs: the
  -- caller never names their own tenant, and an unauthenticated insert gets
  -- NULL and is rejected rather than landing in someone else's garage.
  garage_id  uuid not null default public.current_garage_id()
             references public.garages(id) on delete cascade,
  -- What tickets.assignee stores. Short because it is what the board groups and
  -- filters by; unique within the garage so the lookup is unambiguous, and
  -- deliberately NOT unique across garages, or the second garage to employ a
  -- דני cannot use 'dk'.
  code       text not null,
  name       text not null,
  -- Shown in the avatar chip when there is no room for the full name.
  initials   text not null,
  -- The chip background. A garage's own colour choice, so it is data too.
  color      text not null default '#3e5c76',
  position   integer not null default 0,          -- display order
  -- Retiring a worker, rather than deleting them. A mechanic who leaves must
  -- disappear from the assignment picker while every ticket they ever closed
  -- still resolves to their name — which a delete cannot do. This is the
  -- intended path; see the foreign key below for what a delete does instead.
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint garage_workers_garage_code_key unique (garage_id, code)
);

create index if not exists garage_workers_garage_id_idx on public.garage_workers (garage_id);

comment on column public.garage_workers.active is
  'false retires a worker: hidden from pickers, still resolves on old tickets.';

-- ---------- 2. RLS, explicitly ----------
-- Never inherited from the platform: rls_auto_enable() is present on some
-- projects and absent on others. See docs/PRODUCTION.md §5 Phase 2.
alter table public.garage_workers enable row level security;

-- ---------- 3. grants, also explicitly ----------
-- A policy says which rows; a grant says whether the role may address the table
-- at all, and RLS is never consulted without one.
grant select, insert, update, delete on public.garage_workers to authenticated;
grant select, insert, update, delete on public.garage_workers to service_role;
-- anon gets nothing: this table is new, so there is no legacy anonymous caller.

-- ---------- 4. tenant policy ----------
drop policy if exists garage_workers_tenant on public.garage_workers;
create policy garage_workers_tenant on public.garage_workers
  for all to authenticated
  using      (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));

-- ---------- 5. adopt the names every existing ticket already refers to ----------
-- Before the foreign key, or it would reject the rows it is meant to protect.
--
-- Only codes a garage's tickets actually use. A garage that never assigned
-- anything to 'am' does not get an אבי מזרחי it never employed — that is the
-- whole point of this migration, and seeding all four everywhere would rebuild
-- the fiction in a new table.
insert into public.garage_workers (garage_id, code, name, initials, color, position)
select
  t.garage_id,
  t.assignee,
  coalesce(legacy.name,     t.assignee),
  coalesce(legacy.initials, upper(left(t.assignee, 2))),
  coalesce(legacy.color,    '#3e5c76'),
  (row_number() over (partition by t.garage_id order by t.assignee) - 1)::int
from (
  select distinct garage_id, assignee
  from public.tickets
  where assignee is not null and assignee <> ''
) t
left join (values
  ('dk', 'דני כהן',   'דכ', '#1d2d44'),
  ('il', 'עידו לוי',  'על', '#3e5c76'),
  ('ns', 'נועה שמש',  'נש', '#4f7a5b'),
  ('am', 'אבי מזרחי', 'אמ', '#748cab')
) as legacy(code, name, initials, color) on legacy.code = t.assignee
on conflict (garage_id, code) do nothing;

-- The backfill garage additionally gets the full legacy four, because
-- supabase/seed.sql runs *after* migrations and inserts tickets assigned to
-- dk/il/ns/am into it. Without this, `supabase db reset` would fail on the
-- foreign key below the moment it seeded. Local and the backfill tenant only —
-- a garage onboarded later starts with no workers, by design.
do $$
declare
  demo constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from public.garages where id = demo) then
    return;
  end if;

  insert into public.garage_workers (garage_id, code, name, initials, color, position)
  values
    (demo, 'dk', 'דני כהן',   'דכ', '#1d2d44', 0),
    (demo, 'il', 'עידו לוי',  'על', '#3e5c76', 1),
    (demo, 'ns', 'נועה שמש',  'נש', '#4f7a5b', 2),
    (demo, 'am', 'אבי מזרחי', 'אמ', '#748cab', 3)
  on conflict (garage_id, code) do nothing;
end $$;

-- ---------- 6. unpick the hardcoded four from the tickets table ----------
-- Dropped dynamically. The baseline declared it as an inline `check` on the
-- column, which Postgres names tickets_assignee_check, but this schema has been
-- hand-applied on older projects (see supabase/legacy/) and a differently named
-- constraint carrying the same predicate would survive a drop by name and then
-- reject every real worker.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tickets'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%assignee%'
  loop
    execute format('alter table public.tickets drop constraint %I', c.conname);
  end loop;
end $$;

-- 'dk' as a default is exactly the phantom this migration removes: it attributed
-- unassigned work to an invented person. Unassigned is now NULL and says so.
alter table public.tickets alter column assignee drop default;
alter table public.tickets alter column assignee drop not null;

-- Empty string is the other way to say "nobody", and having two of them means
-- every reader has to check for both. Normalise before the foreign key, which
-- would otherwise reject '' as a code that does not exist.
update public.tickets set assignee = null where assignee = '';

-- ---------- 7. make a phantom worker unrepresentable ----------
-- Filtering the picker is not enough on its own: the complaint that started this
-- was a name appearing that belongs to nobody, and a UI-only fix leaves the
-- database able to produce one again. This is the constraint that cannot be
-- forgotten by a future caller.
--
-- MATCH SIMPLE (the default) treats a row as satisfying the constraint when any
-- referenced column is NULL, so a NULL assignee — unassigned — is allowed
-- while garage_id stays NOT NULL. That is precisely the behaviour wanted here.
--
-- ON DELETE SET NULL (assignee) needs the column list, or Postgres would try to
-- null garage_id too and fail against its NOT NULL. Deleting a worker therefore
-- unassigns their tickets rather than erasing them; to keep the history
-- attributed, set active = false instead.
alter table public.tickets drop constraint if exists tickets_assignee_worker_fkey;
alter table public.tickets
  add constraint tickets_assignee_worker_fkey
  foreign key (garage_id, assignee)
  references public.garage_workers (garage_id, code)
  on update cascade
  on delete set null (assignee);

-- ---------- 8. realtime ----------
-- Full row images, so a rename reaches an open board without a refetch. Matches
-- what 20260723000000 did for the catalog tables.
alter table public.garage_workers replica identity full;

-- ---------- 9. create_ticket stops inventing an assignee ----------
-- Recreated verbatim from 20260729000000_vehicles_from_tickets.sql with one
-- line changed:
--
--   -  coalesce(t->>'assignee','dk')
--   +  nullif(t->>'assignee','')
--
-- That coalesce is where the phantom actually entered the data. Both apps omit
-- assignee when nobody is picked, so every such ticket was written to 'dk' — a
-- person who does not exist at any real garage. Under the foreign key added
-- above it would now fail outright at a garage with no worker coded 'dk', so
-- this is required for correctness, not only for tidiness.
--
-- The body is otherwise untouched; it is repeated in full because Postgres has
-- no way to patch one statement inside a function.

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
