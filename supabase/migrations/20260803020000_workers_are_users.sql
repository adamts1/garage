-- A worker and a user become one person.
--
-- They were two tables for two ideas that turned out to be one. `garage_members`
-- is who may sign in; `garage_workers` is who a ticket can be assigned to. The
-- onboarding script writes the first, the workers screen writes the second, and
-- nothing joined them — so a person added by the script could sign in and was
-- absent from the staff list, which is exactly how this was found.
--
-- Three things here:
--
--   1. `user_id` on garage_workers, linking the chip to the login.
--   2. A worker row for every member that has none, so the people already in a
--      garage appear on the screen the moment it can show them.
--   3. Deactivating a worker stops them signing in, by making
--      current_garage_id() require an active row.
--
-- ON (3) AND WHY IT IS ONE FLAG
--
-- The screen has had an active/retired toggle since it was written, driving
-- whether a mechanic is offered in the assignee picker. Now that a worker is a
-- user, "no longer works here" has to mean "cannot sign in" as well — and the
-- honest way to do that is to make the existing flag mean both, rather than add
-- a second one beside it that somebody will forget to set.
--
-- A deactivated person signs in successfully and resolves to no garage, which is
-- a state the apps already handle: AuthGate renders 'no-garage', deliberately
-- distinct from signed-out. Nothing new to build, and no auth-level ban to keep
-- in step with a row.

alter table public.garage_workers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

comment on column public.garage_workers.user_id is
  'The login behind this worker, when there is one. NULL is a legitimate state: a mechanic who does not use the app is still assignable, and the pre-tenancy rows have no account at all. Set by the manage-staff function, which creates the account and both rows together.';

/* One account cannot be two workers in the same garage. Partial, because NULL
   means "no account" and any number of those may coexist. */
create unique index if not exists garage_workers_garage_user_key
  on public.garage_workers (garage_id, user_id)
  where user_id is not null;

/* Link the rows that can already be matched — a garage where somebody built a
   worker list by hand has none of these, but a re-run is harmless. */
update public.garage_workers w
   set user_id = m.user_id
  from public.garage_members m
 where w.user_id is null
   and m.garage_id = w.garage_id
   and lower(w.name) = lower(split_part((select email from auth.users u where u.id = m.user_id), '@', 1));


/* Everybody who can sign in gets a row on the staff screen.

   Without this the screen stays empty for exactly the people who were onboarded
   by the script — which is every garage, since that is the only way accounts
   have ever been made. Name and initials come from the address because it is
   the only thing known here; both are editable on the screen afterwards.

   The colour is dealt round the same palette the screen offers (WORKER_COLORS
   in useWorkers.ts), so two people are unlikely to share a chip. */
with palette as (
  select array[
    '#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e'
  ] as colors
),
missing as (
  select
    m.garage_id,
    m.user_id,
    split_part(u.email, '@', 1) as handle,
    row_number() over (partition by m.garage_id order by m.created_at) as seat
  from public.garage_members m
  join auth.users u on u.id = m.user_id
  where not exists (
    select 1 from public.garage_workers w
     where w.garage_id = m.garage_id and w.user_id = m.user_id
  )
)
insert into public.garage_workers (garage_id, user_id, code, name, initials, color, position)
select
  ms.garage_id,
  ms.user_id,
  -- Unique per garage: the code is what tickets store in `assignee`.
  left(ms.handle, 6) || '-' || ms.seat,
  ms.handle,
  upper(left(ms.handle, 2)),
  (select colors[1 + ((ms.seat - 1) % array_length(colors, 1))] from palette),
  ms.seat
from missing ms;


/* Signing in resolves to a garage only while the person is active.

   This is the function every policy on every table calls, and the DEFAULT for
   garage_id on all of them — so the join is kept to one left join and one
   coalesce. `coalesce(w.active, true)` is load-bearing twice over: a member with
   no worker row (a garage mid-migration, or a service account) keeps working,
   and so does a worker row that belongs to no user.

   Deactivating therefore removes the garage, not the account. The person can
   still sign in; they land on the 'no-garage' screen, which says to talk to the
   garage rather than pretending the password was wrong. */
create or replace function public.current_garage_id() returns uuid
    language sql stable security definer
    set search_path to ''
    as $$
  select m.garage_id
  from public.garage_members m
  left join public.garage_workers w
    on w.user_id = m.user_id and w.garage_id = m.garage_id
  where m.user_id = auth.uid()
    and coalesce(w.active, true)
  limit 1
$$;

alter function public.current_garage_id() owner to postgres;

comment on function public.current_garage_id() is
  'The garage the current user belongs to, or NULL when unauthenticated OR deactivated. Since 2c this is also the DEFAULT for garage_id on every tenant table, so an unauthenticated insert fails NOT NULL rather than landing in the backfill tenant. A retired member resolves to NULL, which the apps render as the no-garage state. LIMIT 1: multi-garage membership needs an explicit chooser, not an arbitrary row. See docs/PRODUCTION.md §4.';

/* my_garages backs the same gate on the client, so it has to agree — otherwise a
   deactivated person is shown a board whose every query then returns nothing.

   SECURITY DEFINER, which it did not need before and does now. The join it has
   just gained reads garage_workers, and that table's read policy is
   `garage_id = current_garage_id()` — which for a retired person is already
   NULL. As an invoker the join would therefore match no row at all, `coalesce`
   would fall through to true, and the retired person would keep their garage:
   the check would defeat itself precisely in the case it exists for.

   Safe to elevate because there is nothing to point at it. It takes no
   arguments and filters on auth.uid(), so it can only ever return the caller's
   own memberships, whatever privileges it runs with. */
create or replace function public.my_garages()
  returns table("garage_id" uuid, "garage_name" text, "role" text)
    language sql stable security definer
    set search_path to ''
    as $$
  select g.id, g.name, m.role
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  left join public.garage_workers w
    on w.user_id = m.user_id and w.garage_id = m.garage_id
  where m.user_id = (select auth.uid())
    and coalesce(w.active, true)
  order by g.name
$$;

alter function public.my_garages() owner to postgres;
revoke all on function public.my_garages() from public;
grant execute on function public.my_garages() to authenticated;


/* The staff screen's own query: a worker, with the login behind it.

   Three facts about one person live in three places — the chip in
   garage_workers, the role in garage_members, and the address in auth.users —
   and a client can reach only the first. garage_members is readable only for
   your own row (garage_members_read_own), and auth.users is not readable at
   all. So the join happens here.

   SECURITY DEFINER for that reason, and therefore written so it cannot be
   pointed anywhere else: the garage comes from current_garage_id() rather than
   from an argument, and the whole thing returns nothing unless the caller is an
   admin. There is no parameter to forge.

   listWorkers() is untouched and stays open to everyone — the board draws a
   chip on every card and the assignee picker needs the list. This is only for
   the screen that manages people. */
create or replace function public.garage_staff()
  returns table(
    "id" uuid, "code" text, "name" text, "initials" text, "color" text,
    "position" integer, "active" boolean, "user_id" uuid, "email" text, "role" text
  )
    language sql stable security definer
    set search_path to ''
    as $$
  select w.id, w.code, w.name, w.initials, w.color, w.position, w.active, w.user_id,
         u.email::text, m.role
  from public.garage_workers w
  left join public.garage_members m
    on m.user_id = w.user_id and m.garage_id = w.garage_id
  left join auth.users u on u.id = w.user_id
  where w.garage_id = public.current_garage_id()
    and public.is_garage_admin()
  order by w.position
$$;

alter function public.garage_staff() owner to postgres;
revoke all on function public.garage_staff() from public;
grant execute on function public.garage_staff() to authenticated;

comment on function public.garage_staff() is
  'The garage''s people for the staff screen: the worker row joined to its membership role and its account email. SECURITY DEFINER because neither of the last two is client-readable; returns nothing unless the caller is an admin of the garage, and the garage is taken from current_garage_id() so there is no argument to forge.';


/* Every membership gets a worker row, by construction.
 *
 * The backfill above covers the people who existed when this ran. It does
 * nothing for the next one — and the next one is exactly the case that started
 * this: somebody added by scripts/onboard-garage.mjs could sign in and was
 * absent from the staff screen.
 *
 * Fixing the script would fix one caller. A trigger fixes every caller there
 * will ever be: the script, the manage-staff function, and whatever comes
 * after. "A person who can sign in has a row on the staff screen" stops being
 * something to remember and becomes something that is true.
 *
 * The row it makes is a placeholder — handle, two letters, a colour off the
 * palette. manage-staff overwrites it with what the admin actually typed, and
 * the screen can edit it afterwards. */
create or replace function public.ensure_worker_for_member() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  handle  text;
  seat    integer;
  palette text[] := array[
    '#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e'
  ];
begin
  if exists (
    select 1 from public.garage_workers
     where garage_id = new.garage_id and user_id = new.user_id
  ) then
    return new;
  end if;

  select split_part(u.email, '@', 1) into handle
    from auth.users u where u.id = new.user_id;
  handle := coalesce(nullif(handle, ''), 'staff');

  select count(*) + 1 into seat
    from public.garage_workers where garage_id = new.garage_id;

  insert into public.garage_workers (garage_id, user_id, code, name, initials, color, position)
  values (
    new.garage_id,
    new.user_id,
    -- Unique per garage: the code is the key tickets store in `assignee`.
    left(handle, 6) || '-' || seat,
    handle,
    upper(left(handle, 2)),
    palette[1 + ((seat - 1) % array_length(palette, 1))],
    seat
  );

  return new;
end $$;

alter function public.ensure_worker_for_member() owner to postgres;

create trigger garage_members_ensure_worker
  after insert on public.garage_members
  for each row execute function public.ensure_worker_for_member();

comment on function public.ensure_worker_for_member() is
  'Gives every new membership a worker row, so "can sign in" and "appears on the staff screen" cannot drift apart. Placeholder name and colour; manage-staff overwrites them with what was typed, and the screen edits them afterwards.';
