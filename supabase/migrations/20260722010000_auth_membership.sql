-- ============================================================
--  Phase 2b — auth. STILL NON-BREAKING.
--
--  2a gave every row a garage_id. This migration gives a signed-in user a way
--  to find out which garage that is, and nothing more. The demo_all policies
--  stay exactly where they are.
--
--  Read that again, because it is the thing most likely to be misunderstood:
--  THE LOGIN SCREEN ADDED IN 2b IS NOT A SECURITY BOUNDARY. demo_all still
--  grants the anon key full read and write on every tenant-scoped table, so
--  anyone holding the anon key — it ships in both apps and is not a secret —
--  reads everything whether or not they can get past the login form. 2b makes
--  the app know who you are. 2c makes the database care. Until 2c lands, treat
--  this as UI, not protection.
--
--  Accounts are created by an operator (scripts/onboard-garage.ts) rather than
--  by self-signup, which is why there is no join RPC, no invite code and no
--  trigger on auth.users here. A user that exists always has a membership,
--  because the same script writes both. That closes by construction the
--  "authenticated but garage-less" hazard in docs/PRODUCTION.md §5.
--
--  See docs/PRODUCTION.md §5 Phase 2b.
-- ============================================================

-- ============================================================
--  Grants, declared rather than inherited
--
--  A policy says which rows a role may see. A grant says whether the role may
--  touch the table at all, and RLS is never consulted without one. Both are
--  required; neither implies the other.
--
--  These are spelled out because the default differs by environment. Tables
--  created by a migration are owned by `postgres`, whose default ACL in the
--  local stack is anon=Dxtm — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, and no
--  SELECT. Hosted projects were provisioned under supabase_admin's default ACL,
--  which does include it. So an inherited grant is present on staging and
--  absent locally, and the difference only shows up when something actually
--  reads the table.
--
--  Same reasoning as the RLS note in 20260722000000: never let the platform
--  decide something a policy depends on.
-- ============================================================
grant select on public.garages        to authenticated;
grant select on public.garage_members to authenticated;

-- anon gets nothing on either table. It has no legitimate read of the
-- membership map, and after 2c it has no legitimate read of anything.

-- ---------- a member may read their own membership ----------
-- current_garage_id() is SECURITY DEFINER and so does not need this. The apps
-- do: the login gate has to distinguish "signed in, belongs to a garage" from
-- "signed in, belongs to nothing" before it renders a board, and it cannot ask
-- a function that answers NULL for both "no membership" and "not logged in".
drop policy if exists garage_members_read_own on public.garage_members;
create policy garage_members_read_own
  on public.garage_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert, update or delete policy, deliberately. Membership is written by
-- the onboarding script under the service_role key, which bypasses RLS
-- entirely. Leaving the write path unpoliced means a stolen anon key cannot
-- add itself to a garage even after 2c — the strongest available statement is
-- the absence of a policy, not a restrictive one.

-- ---------- a member may read the garage they belong to ----------
-- The subquery is filtered by the policy above, so this cannot be used to
-- enumerate other garages: a caller only sees rows whose id appears in their
-- own membership. Written as an EXISTS against garage_members rather than
-- current_garage_id() because that function is LIMIT 1, and a user in two
-- garages would otherwise be unable to read the second one.
drop policy if exists garages_read_own on public.garages;
create policy garages_read_own
  on public.garages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.garage_members m
      where m.garage_id = garages.id
        and m.user_id = (select auth.uid())
    )
  );

-- ---------- what the app actually calls ----------
-- One round trip that answers "who am I and where do I work", so the login
-- gate does not need two queries and a join on the client. Returns zero rows
-- for an unauthenticated caller and for a member-less user alike; the app
-- treats an empty result as "no garage", which is the state it must refuse to
-- render a board for.
--
-- SECURITY INVOKER: this deliberately runs under the caller's RLS so it can
-- never return more than the policies above already allow.
create or replace function public.my_garages()
returns table (garage_id uuid, garage_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id, g.name
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  where m.user_id = (select auth.uid())
  order by g.name
$$;

comment on function public.my_garages() is
  'Garages the current user belongs to. Empty for anon and for a user with no '
  'membership — the login gate must treat both as "cannot proceed". '
  'See docs/PRODUCTION.md §5 Phase 2b.';

revoke all on function public.my_garages() from public;
grant execute on function public.my_garages() to authenticated;
