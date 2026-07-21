-- ============================================================
--  Phase 2a — tenancy schema. NON-BREAKING BY DESIGN.
--
--  Adds garages, garage_members and a garage_id on every table, and backfills
--  all existing rows into one garage. It deliberately does NOT touch the
--  demo_all policies: the moment tenant isolation replaces them, the anon key
--  can read nothing, and both apps go dark until auth exists. That flip is 2c,
--  after auth lands in 2b.
--
--  So after this migration the system behaves exactly as before. The only
--  difference is that every row now knows which garage it belongs to.
--
--  See docs/PRODUCTION.md §4 and §5 Phase 2.
-- ============================================================

-- ---------- the tenants ----------
create table if not exists public.garages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  tax_id     text,                                  -- ח.פ / עוסק מורשה; needed before invoicing (Phase 4a)
  created_at timestamptz not null default now()
);

-- ---------- who belongs to which garage ----------
-- Composite primary key: a user can be in more than one garage (an accountant
-- covering two sites), and cannot be added to the same one twice.
create table if not exists public.garage_members (
  garage_id  uuid not null references public.garages(id)  on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (garage_id, user_id)
);

-- The lookup current_garage_id() performs on every query.
create index if not exists garage_members_user_id_idx on public.garage_members (user_id);

-- ============================================================
--  RLS is enabled EXPLICITLY on both new tables.
--
--  Staging carries Supabase's rls_auto_enable() event trigger, which would do
--  this for us. Production was created a week earlier and has no such trigger.
--  Relying on it would mean these tables are protected on staging and silently
--  open on production — the rehearsal passes, the real thing ships an unlocked
--  table holding the membership map. Never rely on the platform for this.
--
--  No policies are attached, which denies all access through the anon and
--  authenticated roles. That is the correct default here: nothing reads these
--  tables yet, and current_garage_id() is SECURITY DEFINER so it bypasses RLS.
--  2c adds real policies alongside login.
-- ============================================================
alter table public.garages        enable row level security;
alter table public.garage_members enable row level security;

-- ---------- which garage is the caller in? ----------
-- SECURITY DEFINER so it can read garage_members regardless of RLS.
-- STABLE so Postgres evaluates it once per query rather than once per row —
-- with this in a policy on every table, per-row evaluation would be felt.
-- Empty search_path so a caller cannot shadow `garage_members` with their own.
create or replace function public.current_garage_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select garage_id
  from public.garage_members
  where user_id = auth.uid()
  limit 1
$$;

comment on function public.current_garage_id() is
  'The garage the current user belongs to, or NULL when unauthenticated. '
  'LIMIT 1: multi-garage membership needs an explicit chooser, not an arbitrary row. '
  'See docs/PRODUCTION.md §4.';

revoke all on function public.current_garage_id() from public;
grant execute on function public.current_garage_id() to anon, authenticated;

-- ============================================================
--  Backfill
--
--  Everything that exists today belongs to one garage. A fixed UUID rather
--  than a generated one so this migration lands identically on every database
--  — local, staging, production — and stays re-runnable.
-- ============================================================
insert into public.garages (id, name)
values ('00000000-0000-0000-0000-000000000001', 'מוסך ראשי')
on conflict (id) do nothing;

-- Adds the column, backfills it, defaults it, then enforces NOT NULL.
--
-- The DEFAULT is temporary scaffolding. Until auth exists the apps insert rows
-- without knowing about garages at all, and a NOT NULL column with no default
-- would break every insert. 2c replaces this default with
-- current_garage_id() once callers are authenticated.
do $$
declare
  t text;
  demo constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists garage_id uuid references public.garages(id)', t);
    execute format(
      'update public.%I set garage_id = %L where garage_id is null', t, demo);
    execute format(
      'alter table public.%I alter column garage_id set default %L', t, demo);
    execute format(
      'alter table public.%I alter column garage_id set not null', t);
    -- Every tenant-scoped query filters on this column; without the index each
    -- one is a sequential scan the moment there is more than one garage.
    execute format(
      'create index if not exists %I on public.%I (garage_id)', t || '_garage_id_idx', t);
  end loop;
end $$;

-- ============================================================
--  Keep children with their parents
--
--  works, work_items and ticket_photos carry garage_id denormalised, so policies
--  on them are a column comparison rather than a join back to tickets. The risk
--  of denormalising is divergence: a work row claiming a different garage from
--  the ticket it belongs to would be invisible to its owner, or worse, visible
--  to someone else.
--
--  These triggers make that unrepresentable — the child's garage_id is always
--  taken from its parent, never from the caller. A compromised client cannot
--  write a row into another tenant by forging the column.
-- ============================================================
create or replace function public.inherit_garage_from_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.garage_id into new.garage_id
  from public.tickets t
  where t.id = new.ticket_id;
  return new;
end $$;

create or replace function public.inherit_garage_from_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select w.garage_id into new.garage_id
  from public.works w
  where w.id = new.work_id;
  return new;
end $$;

drop trigger if exists works_inherit_garage on public.works;
create trigger works_inherit_garage
  before insert or update of ticket_id on public.works
  for each row execute function public.inherit_garage_from_ticket();

drop trigger if exists ticket_photos_inherit_garage on public.ticket_photos;
create trigger ticket_photos_inherit_garage
  before insert or update of ticket_id on public.ticket_photos
  for each row execute function public.inherit_garage_from_ticket();

drop trigger if exists work_items_inherit_garage on public.work_items;
create trigger work_items_inherit_garage
  before insert or update of work_id on public.work_items
  for each row execute function public.inherit_garage_from_work();

-- vehicles hang off customers rather than tickets.
create or replace function public.inherit_garage_from_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.garage_id into new.garage_id
  from public.customers c
  where c.id = new.customer_id;
  return new;
end $$;

drop trigger if exists vehicles_inherit_garage on public.vehicles;
create trigger vehicles_inherit_garage
  before insert or update of customer_id on public.vehicles
  for each row execute function public.inherit_garage_from_customer();

-- ============================================================
--  Realtime
--  garage_id is now part of every row these tables broadcast.
-- ============================================================
alter table public.garages        replica identity full;
alter table public.garage_members replica identity full;
