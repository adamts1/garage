-- ============================================================
--  Take anon off the membership map. Defence in depth; no behaviour change.
--
--  20260722010000 granted SELECT on garages and garage_members to
--  `authenticated` and said anon gets nothing. That was true of the grants the
--  migration *wrote*, and false of the grants those tables already carried:
--  created on a hosted project under supabase_admin's default ACL, they came
--  with full DML for anon inherited from the platform.
--
--  It is currently harmless. RLS is enabled on both tables and neither has a
--  policy for anon, so an anonymous request gets an empty set. The observable
--  difference is only in how the refusal happens — locally anon lacks the grant
--  and is denied at the permission check; on staging and production anon passes
--  the permission check and is filtered to zero rows by RLS.
--
--  Which is precisely the problem. Those are the same answer today and not the
--  same defence. With the grant in place, RLS is the only thing between an
--  anonymous caller and the map of which user belongs to which garage, so a
--  single mistaken policy in 2c — a `using (true)` written while debugging, a
--  policy attached `to public` instead of `to authenticated` — exposes it.
--  Without the grant, that same mistake exposes nothing.
--
--  The membership map is also the worst table to leak. It joins auth.users to
--  garages: a list of every operator's user id and which business they work
--  for, which is a customer list of our own customers.
--
--  Written as REVOKE rather than left to the earlier migration because that one
--  is already applied everywhere, and an applied migration is never edited.
-- ============================================================

revoke all on public.garages        from anon;
revoke all on public.garage_members from anon;

-- authenticated keeps the SELECT granted in 20260722010000; the read-own
-- policies there are what make it safe. Nothing else is granted to anyone:
-- membership is written by the onboarding script under service_role, which
-- bypasses both grants and RLS.
