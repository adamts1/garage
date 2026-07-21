-- ============================================================
--  BASELINE — the schema as deployed at 2026-07-20.
--
--  This is the union of the four hand-run files that preceded it
--  (schema.sql, add-paid-status.sql, vehicles.sql, ticket-photos.sql),
--  with two deliberate differences:
--
--    1. NO `drop table` statements. Every later change is a new
--       migration; nothing in migrations/ ever destroys data.
--    2. NO seed data. Demo rows live in supabase/seed.sql and are
--       applied only to local and staging databases.
--
--  Re-runnable: every statement is guarded.
--
--  NOTE: the RLS policies below are still the permissive demo ones.
--  That is intentional — a baseline records reality, it does not
--  improve it. Phase 2 replaces them. See docs/PRODUCTION.md §3.2.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- customers ----------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  city       text,
  kind       text not null default 'פרטי',   -- פרטי | עסקי
  created_at timestamptz not null default now()
);

-- ---------- items (parts / inventory catalog) ----------
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  price      numeric(10,2) not null default 0,
  stock      integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- tickets ----------
-- 'paid' is present in the status check from the outset here; it was
-- added later in production by add-paid-status.sql.
create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,                    -- GAR-142
  job           text,                                    -- W-1042
  status        text not null default 'todo'    check (status   in ('todo','diag','appr','prog','parts','qa','done','paid')),
  type          text not null default 'job'     check (type     in ('job','diag','part','quote','test')),
  epic          text not null default 'service' check (epic     in ('brakes','engine','service','ac','susp','elec','body')),
  priority      text not null default 'med'     check (priority in ('urgent','high','med','low')),
  assignee      text not null default 'dk'      check (assignee in ('dk','il','ns','am')),
  points        integer not null default 3,
  title         text not null,
  plate         text,
  car           text,
  customer_id   uuid references public.customers(id) on delete set null,
  customer_name text,                                    -- denormalised: the board renders with no join
  phone         text,
  email         text,
  address       text,
  km            text,
  year          text,
  amount        numeric(10,2) not null default 0,
  done          integer not null default 0,              -- how many subtasks are checked
  subtasks      text[] not null default '{}',
  flags         text[] not null default '{}',
  due           text,
  blocked       text,
  notes         text,
  paid          boolean not null default false,
  pay_method    text,
  doc           text,
  reference     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Added directly in the dashboard, never recorded in any of the legacy .sql
  -- files. Found only because seeding a clean database from a production dump
  -- failed on them. Kept in production's column order so the two match exactly.
  --   id_number    — ת״ז, collected by the new-ticket form in App.tsx
  --   vehicle_code — the garage's own code for the vehicle
  -- Both are currently write-only dead ends: the form captures them but the
  -- data layer never maps them, so every row is NULL. See docs/PRODUCTION.md §3.10.
  id_number     text,
  vehicle_code  text
);
create index if not exists tickets_status_idx      on public.tickets (status);
create index if not exists tickets_customer_id_idx on public.tickets (customer_id);

-- ---------- works (a job line on a ticket) ----------
create table if not exists public.works (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  uid        text not null,                              -- the id the UI uses client-side
  code       text,
  name       text not null,
  labor      numeric(10,2) not null default 0,
  custom     boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists works_ticket_id_idx on public.works (ticket_id);

-- ---------- work_items (the parts a work consumes) ----------
create table if not exists public.work_items (
  id       uuid primary key default gen_random_uuid(),
  work_id  uuid not null references public.works(id) on delete cascade,
  sku      text,
  name     text not null,
  qty      numeric(10,2) not null default 1,
  price    numeric(10,2) not null default 0,
  position integer not null default 0
);
create index if not exists work_items_work_id_idx on public.work_items (work_id);

-- ---------- vehicles (a customer's cars, for ticket auto-complete) ----------
create table if not exists public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  plate         text not null,
  manufacturer  text,
  model         text,
  year          text,
  km            text,
  vehicle_code  text,
  created_at    timestamptz not null default now()
);
create index if not exists vehicles_customer_id_idx on public.vehicles (customer_id);
create index if not exists vehicles_plate_idx       on public.vehicles (plate);

-- ---------- ticket_photos ----------
-- Bytes live in the `ticket-photos` storage bucket; one row per object so a
-- ticket's photos list with a plain query and can carry a caption.
create table if not exists public.ticket_photos (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  path       text not null unique,          -- e.g. GAR-142/1737283910000-3f2a.jpg
  caption    text,
  created_at timestamptz not null default now()
);
create index if not exists ticket_photos_ticket_id_idx on public.ticket_photos (ticket_id, created_at);

-- ---------- keep updated_at honest ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tickets_touch_updated_at on public.tickets;
create trigger tickets_touch_updated_at
  before update on public.tickets
  for each row execute function public.touch_updated_at();

-- ============================================================
--  RLS — DEMO POLICIES, replaced in Phase 2.
--  Anyone holding the anon key can read and write everything.
--  See docs/PRODUCTION.md §3.2.
-- ============================================================
alter table public.customers     enable row level security;
alter table public.items         enable row level security;
alter table public.tickets       enable row level security;
alter table public.works         enable row level security;
alter table public.work_items    enable row level security;
alter table public.vehicles      enable row level security;
alter table public.ticket_photos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','items','tickets','works','work_items','vehicles','ticket_photos']
  loop
    execute format('drop policy if exists demo_all on public.%I', t);
    execute format('create policy demo_all on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================
--  Realtime — replica identity full so DELETE payloads carry the old row.
-- ============================================================
alter table public.customers     replica identity full;
alter table public.items         replica identity full;
alter table public.tickets       replica identity full;
alter table public.works         replica identity full;
alter table public.work_items    replica identity full;
alter table public.vehicles      replica identity full;
alter table public.ticket_photos replica identity full;

-- Adding a table already in the publication is an error, so check first.
do $$
declare t text;
begin
  foreach t in array array['customers','items','tickets','works','work_items','vehicles','ticket_photos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================
--  Storage
--  Public bucket — Phase 2 makes this private with signed URLs.
--  See docs/PRODUCTION.md §3.3.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('ticket-photos', 'ticket-photos', true)
on conflict (id) do nothing;

drop policy if exists ticket_photos_read   on storage.objects;
drop policy if exists ticket_photos_insert on storage.objects;
drop policy if exists ticket_photos_delete on storage.objects;

create policy ticket_photos_read   on storage.objects for select
  using (bucket_id = 'ticket-photos');
create policy ticket_photos_insert on storage.objects for insert
  with check (bucket_id = 'ticket-photos');
create policy ticket_photos_delete on storage.objects for delete
  using (bucket_id = 'ticket-photos');

-- Deleting a ticket cascades these rows but NOT the bucket objects — Postgres
-- cascade does not reach storage. Client deletes remove the object first, then
-- the row. Orphans from a cascaded ticket delete accumulate harmlessly; a
-- scheduled cleanup is the follow-up if that ever matters.
