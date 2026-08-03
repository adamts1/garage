-- Only an admin may change the garage's staff list, and the list updates live.
--
-- Two unrelated problems in the same table, fixed together because they are
-- both one line and both about the same screen.
--
-- 1. AUTHORITY. garage_workers had a single policy for everything: any member
--    of the garage could add, rename, recolour, deactivate or delete a
--    mechanic. A worker's code is what every ticket stores in `assignee`, and
--    the foreign key is MATCH SIMPLE — so deleting one is not cosmetic. It is
--    the same class of decision as pricing a work, which is already an admin's.
--
--    Split into a read policy for everyone and a write policy for admins.
--    Reading has to stay open to all: the board draws a mechanic's chip on
--    every card, and the assignee picker has to list somebody to assign.
--
-- 2. LIVENESS. garage_workers was never added to the realtime publication, so
--    subscribeToTable('garage_workers') attached to a channel that could not
--    fire. The workers screen has subscribed since it was written and has never
--    once received an event — a worker added in another tab, or by the garage
--    owner while a mechanic has the screen open, simply did not appear. The
--    same gap existed on work_defs and was closed when that screen was built;
--    this is the one left behind.

drop policy if exists "garage_workers_tenant" on public.garage_workers;

create policy "garage_workers_read" on public.garage_workers
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

create policy "garage_workers_write" on public.garage_workers
  for all to authenticated
  using (garage_id = (select public.current_garage_id()) and public.is_garage_admin())
  with check (garage_id = (select public.current_garage_id()) and public.is_garage_admin());

comment on table public.garage_workers is
  'The garage''s mechanics — a name, initials and a colour behind the code that tickets store in assignee. Readable by every member, because the board draws these on every card; written only by an admin, because deleting one orphans the assignee on every ticket that named it. Not users: nobody signs in as a worker. See garage_members for who may log in.';

/* Without this the screen's subscription is decoration. Realtime needs the row
   as it was as well as as it is, and REPLICA IDENTITY FULL is how a table with
   no stable replica identity supplies that — the baseline already sets it. */
ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."garage_workers";
