-- The garage's own letterhead: what the top of a printed work order says.
--
-- Until now `garages` held a name and a tax id, and the printed sheet had a
-- name and nothing else — no address, no phone, no licence number. A work order
-- is a document a customer keeps and a document the ministry may ask for, and
-- one that cannot say who issued it or how to reach them is not doing the job.
--
-- Every one of these is nullable and every one of them is printed only when it
-- is set, so a garage that fills in none of them gets exactly the header it has
-- today. There is no default: a placeholder address on a customer's copy is
-- worse than no address, and one garage's details appearing on another's paper
-- is the failure this whole file exists to make impossible.


-- ============================================================
-- 1. the columns
-- ============================================================

-- `tax_id` is not among them: it has been on this table since the baseline. It
-- was simply never read back — the apps only ever see what my_garages() returns,
-- and that returned a name and a role. Section 2 is what puts it on the paper.
alter table public.garages
  add column if not exists motto      text,
  add column if not exists services   text,
  add column if not exists address    text,
  add column if not exists phone      text,
  add column if not exists fax        text,
  add column if not exists license_no text;

comment on column public.garages.motto is
  'The line above the name on printed documents — a garage''s own words, glyphs included. Printed verbatim when set, omitted when not.';
comment on column public.garages.services is
  'What the garage does, as one line under its name on printed documents. Free text: the garage decides its own separators.';
comment on column public.garages.address is
  'Street address, as one line, for the letterhead.';
comment on column public.garages.phone is
  'Contact number for the letterhead. Not the WhatsApp number a customer is messaged from — that is the operator''s own device.';
comment on column public.garages.fax is
  'Fax number for the letterhead. Still on a garage''s paper, and still how some insurers accept a work order.';
comment on column public.garages.license_no is
  'Ministry of Transport licence number (מורשה משרד התחבורה), printed on the letterhead.';
comment on column public.garages.tax_id is
  'The garage''s ע.מ / ח.פ. Held here since the baseline; printed on the letterhead from 2026-08-18.';


-- ============================================================
-- 2. my_garages(), which is how an app learns any of this
-- ============================================================
--
-- The apps never select from `garages`. They call this, once, at the session
-- gate — so the letterhead has to travel with the name or it arrives on a
-- second round trip that every printed document would have to wait for.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE cannot change
-- a function's OUT columns, and this one gains six.
--
-- SECURITY DEFINER with an empty search_path, unchanged from the baseline. The
-- membership join is still what scopes it: a caller gets the letterheads of the
-- garages they belong to and no others.

drop function if exists public.my_garages();

create function public.my_garages()
returns table (
  garage_id     uuid,
  garage_name   text,
  role          text,
  motto         text,
  services      text,
  address       text,
  phone         text,
  fax           text,
  license_no    text,
  tax_id        text
)
language sql
stable
security definer
set search_path to ''
as $$
  select g.id, g.name, m.role,
         g.motto, g.services, g.address, g.phone, g.fax, g.license_no, g.tax_id
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  left join public.garage_workers w
    on w.user_id = m.user_id and w.garage_id = m.garage_id
  where m.user_id = (select auth.uid())
    and coalesce(w.active, true)
  order by g.name
$$;

alter function public.my_garages() owner to postgres;

comment on function public.my_garages() is
  'Garages the current user belongs to, with their role and their printed letterhead. Empty for anon and for a user with no membership — the login gate must treat both as "cannot proceed". See docs/PRODUCTION.md §5 Phase 2b.';

revoke all on function public.my_garages() from public;
grant execute on function public.my_garages() to authenticated;
