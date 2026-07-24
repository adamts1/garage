-- ============================================================
--  Phase 2c — THE FLIP. This one breaks things on purpose.
--
--  Every table below has carried `demo_all` since the baseline:
--  FOR ALL USING (true) WITH CHECK (true), granted to anyone holding the anon
--  key — which ships inside the web bundle and inside the APK, and is therefore
--  public. Until this migration, "logging in" changed what the app displayed
--  and nothing about what the database would hand out.
--
--  After it, a caller sees exactly one garage's rows and writes into exactly
--  one garage. This is the boundary docs/PRODUCTION.md §5 calls the first hard
--  gate.
--
--  WHAT THIS BREAKS, deliberately:
--
--  * Any client without a session reads nothing. That includes every app build
--    that predates 2b — they have no login screen, so they will show an empty
--    board rather than an error. Retire those builds before running this.
--  * A signed-in user with no garage_members row also reads nothing. That state
--    should be unreachable (onboard-garage.mjs writes user and membership
--    together) and AuthGate has a screen for it.
--  * Inserts no longer land in the backfill tenant. The temporary default is
--    replaced below, so an unauthenticated insert now fails the NOT NULL rather
--    than silently succeeding in someone else's garage.
--
--  Ordering matters inside this file: the default is swapped BEFORE the
--  policies, so there is no window where a policy demands a garage_id that the
--  default is still filling with the backfill UUID.
-- ============================================================

-- ---------- 1. the temporary default goes ----------
-- 20260722000000 set every garage_id to a fixed UUID as scaffolding, because
-- the apps predated auth and a NOT NULL column with no default would have
-- broken every insert. Callers are authenticated now, so the caller's own
-- garage is the correct value — and NULL for an unauthenticated caller is the
-- correct failure, since NOT NULL then rejects the row instead of parking it
-- in the backfill tenant where someone else can read it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    execute format(
      'alter table public.%I alter column garage_id set default public.current_garage_id()', t);
  end loop;
end $$;

-- ---------- 2. demo_all is replaced, table by table ----------
--
-- USING decides which rows are visible; WITH CHECK decides which rows may be
-- written. Both are required and they are not the same guarantee: USING alone
-- would let a caller insert a row into another garage and simply not see it
-- afterwards, which is worse than refusing — the write succeeded, in someone
-- else's data.
--
-- `(select public.current_garage_id())` rather than a bare call: the function is
-- STABLE, and wrapping it in a scalar subquery lets the planner evaluate it
-- once per statement instead of once per row. With this policy on every table
-- and a board that loads hundreds of rows, that difference is felt.
--
-- `to authenticated` and not `to public`: a policy attached to public also
-- applies to anon, which would defeat the revoke in step 3.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    execute format('drop policy if exists demo_all on public.%I', t);
    execute format($f$
      create policy tenant_isolation on public.%I
        for all to authenticated
        using      (garage_id = (select public.current_garage_id()))
        with check  (garage_id = (select public.current_garage_id()))
    $f$, t);
  end loop;
end $$;

-- ---------- 3. anon loses its grants ----------
-- 20260722020000 declared these, because the app depended on them and an
-- inherited grant behaves differently between a hosted project and a database
-- built from these migrations. The dependency is over: every caller is
-- authenticated now.
--
-- Belt and braces alongside the policies. A policy mistake with the grant
-- present is a data leak; the same mistake without it is a 401. This is the
-- fourth time in this phase that an inherited grant has turned out to be doing
-- work nobody intended, so the revoke is explicit rather than assumed.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- service_role keeps everything: the onboarding script runs under it, and it
-- bypasses RLS but not grants.

comment on function public.current_garage_id() is
  'The garage the current user belongs to, or NULL when unauthenticated. '
  'Since 2c this is also the DEFAULT for garage_id on every tenant table, so an '
  'unauthenticated insert fails NOT NULL rather than landing in the backfill '
  'tenant. LIMIT 1: multi-garage membership needs an explicit chooser, not an '
  'arbitrary row. See docs/PRODUCTION.md §4.';
