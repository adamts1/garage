-- Which accounting software each garage's bookkeeper imports into, and the
-- חשבשבת orders that go with it.
--
-- A migration of its own, NOT an edit to 20261112100000. That one was applied
-- on staging in its first form, and an applied migration is never re-run —
-- the additions made to it afterwards never reached the database, and the
-- export page failed on columns that were not there. Everything here is
-- written to be safe on a database that has none of it, some of it, or all of
-- it (a local database got all of it inside 20261112100000).
--
-- WHY THE SOFTWARE MATTERS
--
-- Some garages' bookkeepers use ריווחית, some חשבשבת, and the two need
-- different files. The movement-type code at the start of every line of
-- movein.dat is numeric for ריווחית ("200") and Hebrew letters for חשבשבת
-- ("חש"); a file built for the wrong one imports without complaint, into the
-- wrong movement types. Measured 2026-11-12:
--
--   ריווחית -> one order:  rivhit + export_cards       (all three files)
--   חשבשבת  -> two orders: hash_dos_long               (movein.dat)
--                          hash_win_flexible + cards   (heshin.dat, heshin.prm)
--
-- See supabase/functions/_shared/bookkeepingParts.ts.

-- ---------------------------------------------------------------- the חשבשבת orders

alter table public.bookkeeping_export_parts
  drop constraint if exists bookkeeping_export_parts_kind_check;
alter table public.bookkeeping_export_parts
  add constraint bookkeeping_export_parts_kind_check
  check (kind in ('all', 'movements', 'cards'));

-- ---------------------------------------------------------------- per garage

/* Which software the garage's bookkeeper imports into. Some use ריווחית, some
   חשבשבת, and the two need DIFFERENT files: the movement-type code that starts
   every line of movein.dat is numeric for one and Hebrew letters for the other.
   See _shared/bookkeepingParts.ts for which orders each one takes.

   Deliberately no default. A garage with nothing set cannot export, and is told
   so. Guessing would hand one bookkeeper the other one's file — it imports
   without complaint, into the wrong movement types. Set with
   scripts/set-bookkeeping-software.mjs.

   Readable by the garage's own members through the table's existing grant and
   policy, so the page can say which software the files are for. Writable only
   by service_role, like the rest of this table. */
alter table public.garage_billing
  add column if not exists bookkeeping_software text;

alter table public.garage_billing
  drop constraint if exists garage_billing_bookkeeping_software_check;
alter table public.garage_billing
  add constraint garage_billing_bookkeeping_software_check
  check (bookkeeping_software is null or bookkeeping_software in ('rivhit', 'hashavshevet'));

comment on column public.garage_billing.bookkeeping_software is
  'rivhit | hashavshevet — which software the bookkeeper imports into, which decides which export_type the files are ordered in. Null: exports refused until set. See 20261112100000_bookkeeping_export_files.sql.';

/* The software is recorded on each export too, so a finished export says what
   it was built for even after the garage's setting changes. */
alter table public.bookkeeping_exports
  add column if not exists software text;
grant select (software) on table public.bookkeeping_exports to authenticated;

/* Setting it from the app. A garage admin picks it on the export screen; a
   member sees it but cannot change it. garage_billing itself stays read-only to
   clients — this function is the one door, and it can only ever touch the
   caller's own garage (the garage comes from current_garage_id(), so there is
   no argument to forge) and only ever this one column.

   SECURITY DEFINER because the table has no client write grant, and should not
   get one: the same row turns invoicing on and off. */
create or replace function public.set_bookkeeping_software(p_software text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_garage uuid := public.current_garage_id();
begin
  if v_garage is null then
    raise exception 'no garage for this user' using errcode = '42501';
  end if;
  /* Admin of THIS garage — not is_garage_admin(), which is true for an admin
     of any garage the user belongs to. */
  if not exists (
    select 1 from public.garage_members
     where user_id = (select auth.uid()) and garage_id = v_garage and role = 'admin'
  ) then
    raise exception 'only a garage admin can change the bookkeeping software' using errcode = '42501';
  end if;
  if p_software is null or p_software not in ('rivhit', 'hashavshevet') then
    raise exception 'bookkeeping software must be rivhit or hashavshevet' using errcode = '22023';
  end if;

  update public.garage_billing
     set bookkeeping_software = p_software, updated_at = now()
   where garage_id = v_garage;
  if not found then
    raise exception 'this garage is not connected to an accounting provider yet';
  end if;

  return p_software;
end;
$$;

alter function public.set_bookkeeping_software(text) owner to postgres;
revoke all on function public.set_bookkeeping_software(text) from public, anon;
grant execute on function public.set_bookkeeping_software(text) to authenticated;
