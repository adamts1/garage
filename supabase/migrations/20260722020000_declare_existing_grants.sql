-- ============================================================
--  Declare the grants the app has always relied on. CHANGES NO BEHAVIOUR.
--
--  Every tenant-scoped table carries a demo_all policy granting anon full read
--  and write, and both apps depend on it. But the underlying table GRANT was
--  never written down — it was inherited from whichever default ACL happened to
--  be in force when the database was provisioned.
--
--  On staging and production that inheritance gave anon everything, so the apps
--  work. On a database built from these migrations it does not: migration-created
--  tables are owned by `postgres`, and its default ACL here is anon=Dxtm —
--  TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, but no SELECT, INSERT, UPDATE or
--  DELETE. A clean local database therefore rejects every query the app makes,
--  with `permission denied for table tickets`, before RLS is ever consulted.
--
--  This went unnoticed because local development points at staging (docs/
--  WORKFLOW.md §2); the local database only ever proves that migrations apply,
--  which it does. The gap surfaces the moment something reads the tables — and
--  the Phase 2c gate is exactly that: a CI test proving garage A cannot read
--  garage B. Without a declared grant, that test fails on permissions and tells
--  us nothing about isolation.
--
--  So this migration writes down what production already does. Running it there
--  is a no-op; running it locally makes local behave like production. It is a
--  precondition for 2c, not a change to 2b.
--
--  2c revokes anon's DML entirely — a garage's data is not readable without a
--  session. That belongs with the policy flip, not here, because revoking now
--  would take both apps down before login exists to replace it.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'items', 'tickets', 'works', 'work_items', 'vehicles', 'ticket_photos'
  ]
  loop
    -- anon: what demo_all already permits, now stated explicitly. Removed in 2c.
    execute format(
      'grant select, insert, update, delete on public.%I to anon', t);
    -- authenticated: the same, so that a logged-in session is never *less*
    -- capable than an anonymous one during the 2b window.
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Sequences, for any table not using a uuid default. Harmless where there are
-- none, and the failure it prevents — insert succeeding for postgres and failing
-- for anon on the identity column — is an unpleasant one to diagnose.
grant usage, select on all sequences in schema public to anon, authenticated;
