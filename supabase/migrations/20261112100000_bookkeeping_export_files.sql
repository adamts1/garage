-- Bookkeeping exports: the person picks which files they want, out of three.
--
--   movein.dat   the movements (תנועות)
--   heshin.dat   the client and supplier cards (כרטיסים)
--   heshin.prm   the layout of heshin.dat, which חשבשבת needs to read it
--
-- WHERE THE FILES COME FROM
--
-- Some garages' bookkeepers import into ריווחית, some into חשבשבת — set per
-- garage, in 20261115090000_bookkeeping_software.sql. Measured on 2026-11-12 against a real iCount account, with
-- export_cards=true (which, not export_clients / export_suppliers, is what adds
-- the heshin files):
--
--   rivhit             -> movein.dat, heshin.dat, heshin.prm
--   hash_dos_long      -> movein.dat only
--   hash_win_flexible  -> heshin.dat, heshin.prm (+ movein.doc, movein.prm)
--
-- The two movein.dat files are NOT interchangeable: the movement-type code at
-- the start of every line is numeric for ריווחית ("200") and Hebrew letters for
-- חשבשבת ("חש"). The heshin files are byte-for-byte the same in both.
--
--   ריווחית -> one order:  rivhit
--   חשבשבת  -> two orders: hash_dos_long (movein.dat) and
--                          hash_win_flexible (heshin.dat, heshin.prm)
--
-- So an export is one or more PARTS — one order to the provider each, with its
-- own callback, its own download link and its own success or failure, because
-- the provider calls back once per order and the two do not arrive together.

-- THE RULE THAT MATTERS
--
-- An export is `ready` only when every file the person ticked has arrived and is
-- not empty. One part failing fails the export. A bookkeeper handed two files out
-- of three, without being told, is worse off than one handed an error.

-- ---------------------------------------------------------------- the export

/* What was asked for. Existing rows are the old single-file exports, and the
   default makes them say so. */
alter table public.bookkeeping_exports
  add column if not exists files text[] not null default array['movein.dat']::text[];

alter table public.bookkeeping_exports
  drop constraint if exists bookkeeping_exports_files_check;
alter table public.bookkeeping_exports
  add constraint bookkeeping_exports_files_check check (
    cardinality(files) > 0
    and files <@ array['movein.dat', 'heshin.dat', 'heshin.prm']::text[]
  );

/* What arrived: file name -> bytes. Filled one part at a time, so it is the
   record of exactly which files are on disk. Null on rows from before this. */
alter table public.bookkeeping_exports
  add column if not exists file_sizes jsonb;

/* The callback token moves to the parts — each order has its own callback.
   Kept, and still unique, so an export ordered before this deploy can still be
   called back and finish. New exports leave it null. */
alter table public.bookkeeping_exports
  alter column callback_token drop not null;

/* The browser may read both new columns. Neither is a secret. */
grant select (files, file_sizes) on table public.bookkeeping_exports to authenticated;

-- ---------------------------------------------------------------- the parts

create table if not exists public.bookkeeping_export_parts (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.bookkeeping_exports(id) on delete cascade,
  garage_id uuid not null references public.garages(id) on delete restrict,

  /* Which order this is, from the list in _shared/bookkeepingParts.ts. Here
     there is one: 'all', export_type rivhit with export_cards=true. The חשבשבת
     kinds are added in 20261115090000_bookkeeping_software.sql. */
  kind text not null,
  format text not null,
  /* The files this part must deliver — the ones ticked, of those it provides. */
  files text[] not null,

  /* The authorisation for the public callback, and the only way to match a
     callback to its order. Same rules as before: 32 random bytes, server only. */
  callback_token text not null unique,
  /* The provider's download link. Unauthenticated, so server only. Written
     before any download is tried, so a download that runs early can be retried. */
  source_url text,

  status text not null default 'requested',
  error text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,

  constraint bookkeeping_export_parts_kind_check check (kind in ('all')),
  constraint bookkeeping_export_parts_status_check check (status in ('requested', 'ready', 'error')),
  constraint bookkeeping_export_parts_files_check check (cardinality(files) > 0),
  constraint bookkeeping_export_parts_one_per_kind unique (export_id, kind)
);

create index if not exists bookkeeping_export_parts_export_idx
  on public.bookkeeping_export_parts using btree (export_id);

comment on table public.bookkeeping_export_parts is
  'One order to the accounting provider; an export is one or more. Server only: every column but the status is either a secret or a link to a garage''s books. See 20261112100000_bookkeeping_export_files.sql.';

/* No client reads or writes parts at all. Everything a person needs to see is
   summarised on the export row. RLS on with no policies is a second lock behind
   the missing grant. */
alter table public.bookkeeping_export_parts enable row level security;
revoke all on table public.bookkeeping_export_parts from anon, authenticated;
grant all on table public.bookkeeping_export_parts to service_role;

-- ---------------------------------------------------------------- outcomes

/* A part's files are stored. Records it, and decides the export.

   One function rather than two updates from the Edge Function, because the two
   parts call back independently and can finish at the same moment. The export
   row is locked first, so the two run one after the other: the second always
   sees the first, and exactly one of them decides that everything is in. The
   file sizes are merged rather than overwritten for the same reason. */
create or replace function public.bookkeeping_part_ready(p_part uuid, p_sizes jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_export uuid;
  v_status text;
  v_open int;
  v_missing int;
begin
  select export_id into v_export from public.bookkeeping_export_parts where id = p_part;
  if v_export is null then
    raise exception 'bookkeeping part % not found', p_part;
  end if;

  perform 1 from public.bookkeeping_exports where id = v_export for update;

  update public.bookkeeping_export_parts
     set status = 'ready', error = null, ready_at = now()
   where id = p_part;

  update public.bookkeeping_exports
     set file_sizes = coalesce(file_sizes, '{}'::jsonb) || p_sizes
   where id = v_export
  returning status into v_status;

  /* Already failed because the other part did. Stays failed. */
  if v_status = 'error' then
    return v_status;
  end if;

  select count(*) into v_open
    from public.bookkeeping_export_parts
   where export_id = v_export and status <> 'ready';

  /* Belt and braces: every ticked file must have a size recorded, whatever the
     parts say. This is the check that a file never silently goes missing. */
  select count(*) into v_missing
    from public.bookkeeping_exports e, unnest(e.files) f
   where e.id = v_export
     and not coalesce((e.file_sizes ? f) and (e.file_sizes ->> f)::int > 0, false);

  if v_open = 0 and v_missing = 0 then
    update public.bookkeeping_exports
       set status = 'ready',
           ready_at = now(),
           error = null,
           file_bytes = (select sum(value::int) from jsonb_each_text(file_sizes))
     where id = v_export
    returning status into v_status;
  end if;

  return v_status;
end;
$$;

/* A part failed for good. The whole export fails with it, carrying the reason. */
create or replace function public.bookkeeping_part_failed(p_part uuid, p_error text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_export uuid;
begin
  select export_id into v_export from public.bookkeeping_export_parts where id = p_part;
  if v_export is null then
    raise exception 'bookkeeping part % not found', p_part;
  end if;

  perform 1 from public.bookkeeping_exports where id = v_export for update;

  update public.bookkeeping_export_parts set status = 'error', error = p_error where id = p_part;
  update public.bookkeeping_exports set status = 'error', error = p_error where id = v_export;
end;
$$;

revoke all on function public.bookkeeping_part_ready(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.bookkeeping_part_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.bookkeeping_part_ready(uuid, jsonb) to service_role;
grant execute on function public.bookkeeping_part_failed(uuid, text) to service_role;
