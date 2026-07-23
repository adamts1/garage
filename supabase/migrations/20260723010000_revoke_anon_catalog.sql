-- ============================================================
--  Take anon off the catalog tables. No behaviour change; defence in depth.
--
--  20260723000000 granted work_defs and work_def_items to `authenticated` and
--  said in a comment that anon gets nothing. That was true of the grants the
--  migration wrote and false of the grants the tables ended up with: on a
--  hosted project they inherited full DML for anon from the platform's default
--  ACL, exactly as the seven older tables had.
--
--  Omitting a GRANT does not remove an inherited one. That is the whole lesson,
--  and this is the third table pair it has applied to — after the original
--  seven (20260722020000) and the membership map (20260722030000). Writing the
--  intention in a comment is not the same as enforcing it.
--
--  Nothing leaks today: RLS is enabled with a policy only for `authenticated`,
--  so an anonymous SELECT returns an empty set and an anonymous INSERT is
--  refused. The difference is only in which mechanism refuses — locally anon
--  lacks the grant and never reaches RLS; on staging it passes the permission
--  check and RLS filters it to zero rows.
--
--  Which is the problem. Those are the same answer and not the same defence.
--  With the grant in place, one mistaken policy — a `to public` written while
--  debugging, a `using (true)` left in — exposes every garage's price list to
--  anyone holding the anon key, and the anon key ships inside both apps.
--
--  It also restores a property worth having: after this, a client that can read
--  work_defs at all is definitely authenticated. That makes the catalog a
--  canary for "is this app really using a session", which is otherwise awkward
--  to prove from the outside while demo_all still answers yes to everything.
-- ============================================================

revoke all on public.work_defs      from anon;
revoke all on public.work_def_items from anon;

-- authenticated keeps what 20260723000000 granted; the tenant policies there
-- are what make it safe. service_role keeps its own grant — the onboarding
-- script seeds a new garage's catalog under it.
