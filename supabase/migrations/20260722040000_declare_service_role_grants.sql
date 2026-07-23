-- ============================================================
--  Declare service_role's grants too. No-op on hosted projects.
--
--  service_role bypasses RLS. It does NOT bypass GRANTs — those are two
--  different mechanisms and conflating them is the reason this was missed
--  twice. A policy decides which rows; a grant decides whether the role may
--  address the table at all, and no amount of RLS-bypassing helps a role that
--  was never granted INSERT.
--
--  Same environment split as 20260722020000: tables created by a migration are
--  owned by `postgres`, whose default ACL here gives service_role only
--  Dxtm — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. Hosted projects were
--  provisioned under supabase_admin's default ACL, which grants full DML.
--
--  Found by running supabase/tests/tenancy.mjs against a clean local database:
--  creating a garage as service_role returned
--  `permission denied for table garages`. The same call succeeds against
--  staging. scripts/onboard-garage.mjs runs under this role, so without this
--  migration onboarding works on hosted projects and fails on any database
--  built from these migrations — including every CI run that tries to prove
--  tenant isolation, which must create tenants before it can isolate them.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'garages', 'garage_members',
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

grant usage, select on all sequences in schema public to service_role;

-- Not granted to anon or authenticated: 20260722020000 covers what those roles
-- may do, and 20260722030000 deliberately takes anon off the membership map.
