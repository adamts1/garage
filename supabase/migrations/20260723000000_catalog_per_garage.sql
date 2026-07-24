-- ============================================================
--  Phase 2c, part 1 — the catalog becomes data, and becomes per-garage.
--  NON-BREAKING. demo_all is untouched; the flip is a later migration.
--
--  Until now the works catalog lived in packages/shared/src/catalog.ts as a
--  hardcoded constant: ten standard jobs, each with a labour price and the
--  parts it needs. Both apps read it directly, so every garage saw identical
--  work names and identical prices, and changing one meant editing TypeScript
--  and shipping a release — an App Store review, for a price change.
--
--  That cannot survive ten garages. A garage's labour rate is its own, and so
--  is what it calls a job.
--
--  Two structural problems had to be fixed to make per-garage catalogs
--  possible at all:
--
--  1. items.sku carried a GLOBAL unique constraint. Two garages could not both
--     stock OIL-530 — the second insert would fail with a constraint violation
--     naming a row it cannot see. Now unique per (garage_id, sku).
--
--  2. There was nowhere to put a work definition. work_defs / work_def_items
--     below are the catalog equivalents of works / work_items, which hold the
--     works actually attached to a ticket.
--
--  These new tables get tenant policies immediately rather than demo_all.
--  demo_all exists because the apps predate auth; these tables do not. Adding
--  a permissive policy here only to remove it two migrations later would widen
--  the flip's surface for no gain.
-- ============================================================

-- ---------- 1. SKUs are unique within a garage, not the world ----------
-- Dropped by name: baseline created it as an inline `unique` on the column,
-- which Postgres names items_sku_key.
alter table public.items drop constraint if exists items_sku_key;
alter table public.items add constraint items_garage_sku_key unique (garage_id, sku);

comment on constraint items_garage_sku_key on public.items is
  'Per-garage, not global. Two garages legitimately stock the same part number.';

-- ---------- 2. the works catalog ----------
create table if not exists public.work_defs (
  id         uuid primary key default gen_random_uuid(),
  -- Defaulted to the caller's garage, not to the backfill tenant. The other
  -- seven tables carry a hardcoded UUID default as scaffolding, because they
  -- predate auth and a NOT NULL column with no default would break every
  -- insert. These tables do not, so they start with the shape the flip is
  -- moving everything else towards: the caller never names their own garage,
  -- and an unauthenticated insert gets NULL and is rejected rather than
  -- silently landing in someone else's tenant.
  garage_id  uuid not null default public.current_garage_id()
             references public.garages(id) on delete cascade,
  code       text not null,                              -- typed in the works table to pull it in
  name       text not null,
  labor      numeric(10,2) not null default 0,
  hours      numeric(10,2) not null default 0,
  position   integer not null default 0,                 -- display order, garage's own preference
  created_at timestamptz not null default now(),
  -- The code is what a mechanic types. It has to be unique within the garage or
  -- the lookup is ambiguous; it must NOT be unique across garages, or the second
  -- garage to want OIL-01 cannot have it.
  constraint work_defs_garage_code_key unique (garage_id, code)
);

-- ---------- 3. the parts a catalog work needs ----------
-- garage_id is denormalised here for the same reason as on work_items: a policy
-- on this table stays a column comparison instead of a join back through
-- work_defs. The trigger below makes divergence unrepresentable.
create table if not exists public.work_def_items (
  id           uuid primary key default gen_random_uuid(),
  work_def_id  uuid not null references public.work_defs(id) on delete cascade,
  garage_id    uuid not null references public.garages(id)   on delete cascade,
  sku          text,
  name         text not null,
  qty          numeric(10,2) not null default 1,
  price        numeric(10,2) not null default 0,
  position     integer not null default 0
);

create index if not exists work_defs_garage_id_idx      on public.work_defs (garage_id);
create index if not exists work_def_items_garage_id_idx on public.work_def_items (garage_id);
create index if not exists work_def_items_work_def_idx  on public.work_def_items (work_def_id);

-- ---------- 4. a child never names its own garage ----------
-- Same guarantee as the 2a triggers: the value is read from the parent, never
-- taken from the caller, so a forged garage_id cannot place a row in another
-- tenant. The column is NOT NULL and this trigger is the only thing that fills
-- it, which is why it must run before insert and on any parent change.
create or replace function public.inherit_garage_from_work_def()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select w.garage_id into new.garage_id
  from public.work_defs w
  where w.id = new.work_def_id;
  return new;
end $$;

drop trigger if exists work_def_items_inherit_garage on public.work_def_items;
create trigger work_def_items_inherit_garage
  before insert or update of work_def_id on public.work_def_items
  for each row execute function public.inherit_garage_from_work_def();

-- ---------- 5. RLS, explicitly ----------
-- Never inherited from the platform: rls_auto_enable() is present on some
-- projects and absent on others, and the difference is invisible until someone
-- reads the table. See docs/PRODUCTION.md §5 Phase 2.
alter table public.work_defs      enable row level security;
alter table public.work_def_items enable row level security;

-- ---------- 6. grants, also explicitly ----------
-- A policy says which rows; a grant says whether the role may address the table
-- at all, and RLS is never consulted without one. Migration-created tables are
-- owned by `postgres`, whose default ACL grants neither anon nor service_role
-- any DML — while hosted projects were provisioned under supabase_admin's
-- default ACL, which grants both. Declaring them is the only way both
-- environments behave alike.
grant select, insert, update, delete on public.work_defs      to authenticated;
grant select, insert, update, delete on public.work_def_items to authenticated;
grant select, insert, update, delete on public.work_defs      to service_role;
grant select, insert, update, delete on public.work_def_items to service_role;
-- anon gets nothing: these tables are new, so there is no legacy anonymous
-- caller to keep working, and after the flip there will be no anonymous caller
-- at all.

-- ---------- 7. tenant policies ----------
-- current_garage_id() is STABLE, so it is evaluated once per query rather than
-- once per row. `(select ...)` around it keeps the planner from treating it as
-- a per-row volatile call in the USING clause.
--
-- WITH CHECK on the write policies is what stops a caller inserting a row into
-- someone else's garage; USING alone would only filter what they can see.
drop policy if exists work_defs_tenant on public.work_defs;
create policy work_defs_tenant on public.work_defs
  for all to authenticated
  using      (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));

-- The child's garage_id is trigger-assigned from its parent, so WITH CHECK here
-- validates a value the caller could not have chosen. That is intentional: it
-- means an attempt to attach a part to another garage's work fails on the
-- policy rather than silently succeeding against a corrected row.
drop policy if exists work_def_items_tenant on public.work_def_items;
create policy work_def_items_tenant on public.work_def_items
  for all to authenticated
  using      (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));

-- ---------- 8. seed the backfill garage with what was hardcoded ----------
-- Only the backfill garage. A garage onboarded later gets its starter catalog
-- from scripts/onboard-garage.mjs, so that a new garage is never handed an
-- empty works list on its first day.
--
-- Re-runnable: on conflict leaves wid null and the child inserts are skipped.
do $$
declare
  demo constant uuid := '00000000-0000-0000-0000-000000000001';
  wid uuid;
begin
  if not exists (select 1 from public.garages where id = demo) then
    return;
  end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'OIL-01', 'טיפול שמן מלא', 120, 1, 0)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'OIL-530', 'שמן מנוע 5W-30 (ליטר)', 5, 45, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'FLT-OIL', 'פילטר שמן', 1, 65, 1);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'FLT-AIR', 'פילטר אוויר', 1, 90, 2);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'BRK-F', 'בלמים קדמיים', 250, 2, 1)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'BRK-F22', 'רפידות בלם קדמי', 1, 240, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'DSC-F10', 'דיסקיות בלם קדמי', 2, 180, 1);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'FLD-BRK', 'נוזל בלמים DOT4', 1, 35, 2);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'BRK-R', 'בלמים אחוריים', 220, 2, 2)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'BRK-R18', 'רפידות בלם אחורי', 1, 190, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'DSC-R08', 'דיסקיות בלם אחורי', 2, 150, 1);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'BAT-01', 'החלפת מצבר', 60, 0.5, 3)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'BAT-70A', 'מצבר 70 אמפר', 1, 520, 0);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'AC-01', 'טיפול מזגן', 180, 1.5, 4)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'GAS-134', 'גז מזגן R134', 1, 220, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'FLT-CAB', 'מסנן אבקנים', 1, 75, 1);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'SUS-01', 'החלפת בולמים אחוריים', 320, 3, 5)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'SHK-R09', 'בולם זעזועים אחורי', 2, 360, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'MNT-R01', 'תותב בולם', 2, 45, 1);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'TIM-01', 'החלפת רצועת טיימינג', 650, 5, 6)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'TIM-KIT', 'ערכת רצועת טיימינג', 1, 890, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'PMP-WTR', 'משאבת מים', 1, 320, 1);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'CLT-01', 'החלפת מצמד מלא', 900, 6, 7)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'CLT-FRD', 'ערכת מצמד מלאה', 1, 1650, 0);
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'BRG-CLT', 'מיסב מצמד', 1, 180, 1);
    end if;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'DIA-01', 'אבחון מחשב (OBD)', 150, 1, 8)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    insert into public.work_defs (garage_id, code, name, labor, hours, position)
    values (demo, 'TST-01', 'בדיקת טסט שנתי', 200, 1, 9)
    on conflict (garage_id, code) do nothing
    returning id into wid;

    if wid is not null then
      insert into public.work_def_items (work_def_id, sku, name, qty, price, position)
      values (wid, 'BLB-H7', 'נורת הלוגן H7', 2, 25, 0);
    end if;
end $$;

-- ---------- 9. realtime ----------
alter table public.work_defs      replica identity full;
alter table public.work_def_items replica identity full;
