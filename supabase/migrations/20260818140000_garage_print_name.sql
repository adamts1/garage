-- The name a garage prints, which is not always the name it goes by.
--
-- `garages.name` is the tenant name: it is on the sidebar, in the WhatsApp
-- message, in the onboarding command, and it is short because that is what a
-- name in a rail has to be. The name on a work order a customer keeps is the
-- registered one — "אי-תן שירותי רכב בע״מ" against "אי-תן" — and until now the
-- printed sheet had no way to say the second without renaming the garage
-- everywhere else.
--
-- Nullable, and printed only when set: a garage that leaves it empty prints its
-- own name exactly as it did before this column existed.
--
-- A migration of its own rather than an edit to 20260818090000, which is
-- already applied on staging. An applied migration is history; changing one is
-- how a database and its migration list stop describing the same schema.

alter table public.garages
  add column if not exists print_name text;

comment on column public.garages.print_name is
  'The garage''s name as it appears on printed documents, when that differs from the name the app shows. Falls back to garages.name when null.';


-- my_garages() gains one more OUT column, so it is dropped and recreated again
-- — CREATE OR REPLACE still cannot change a function's return type. Everything
-- else about it is unchanged from 20260818090000: SECURITY DEFINER, an empty
-- search_path, and the membership join that scopes it to the caller's own
-- garages.

drop function if exists public.my_garages();

create function public.my_garages()
returns table (
  garage_id     uuid,
  garage_name   text,
  role          text,
  print_name    text,
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
         g.print_name, g.motto, g.services, g.address, g.phone, g.fax,
         g.license_no, g.tax_id
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
