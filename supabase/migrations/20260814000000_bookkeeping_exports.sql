-- Bookkeeping exports — the חשבשבת movein.dat file, ordered from the accounting
-- provider for a range of dates and handed to the garage's bookkeeper.
--
-- The provider builds this asynchronously: the order returns `status: true` and
-- nothing else — no job id, no file — and minutes later it POSTs a callback
-- carrying a download link. So an export is a row with a life of its own rather
-- than the return value of a call, and this table is that life.
--
-- WHAT THE TOKEN IS FOR
--
-- The callback cannot be authenticated the way everything else here is: it comes
-- from the provider's servers, which hold no session and no JWT of ours. The
-- endpoint therefore has to be public, and the whole of its authorisation is a
-- secret this table issues — one per export, long, random, single-purpose.
--
-- It does two jobs at once, and the second is the reason the design works at
-- all: the order call gives back no identifier, so there is nothing to match a
-- callback against. The token IS the match. It goes out inside the webhook URL,
-- comes back as the path that was called, and names both the export and the
-- garage it belongs to. Nothing else in the callback is trusted.
--
-- WHY THE FILE IS FETCHED RATHER THAN LINKED
--
-- The link the provider sends is, as far as we can tell, unauthenticated —
-- anyone holding it downloads a garage's books. So the callback pulls the file
-- immediately and stores it in a private bucket behind the same tenant
-- isolation as everything else, and the link is never given to a browser. Their
-- link expiring then stops being our problem too.

create table if not exists public.bookkeeping_exports (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null default public.current_garage_id()
    references public.garages(id) on delete restrict,

  -- What was asked for. Kept so a finished export can say what it covers, and
  -- so the same range is recognisable in the list a month later.
  start_date date not null,
  end_date date not null,
  export_docs boolean not null default true,
  export_expenses boolean not null default true,
  export_clients boolean not null default true,
  export_suppliers boolean not null default true,

  provider text not null default 'icount',
  format text not null default 'hash_dos_long',

  status text not null default 'requested',
  /* The provider's own words when it fails, or ours when the callback could not
     retrieve the file. Shown as-is: a bookkeeping export that failed is a thing
     somebody has to act on, and "something went wrong" is not actionable. */
  error text,

  /* Never leaves the server. See the header — this is the callback's entire
     authorisation. The grant below is column-level and omits this one, so
     `select *` as `authenticated` is refused outright rather than relying on
     every caller remembering to name its columns. */
  callback_token text not null unique,

  /* Where the file landed in the bucket, once it did. Null until then. */
  storage_path text,
  file_bytes integer,

  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  ready_at timestamptz,

  constraint bookkeeping_exports_status_check
    check (status in ('requested', 'ready', 'error')),
  /* A range that runs backwards is a typo, and it would come back as an empty
     file rather than an error — the one failure that looks like a success. */
  constraint bookkeeping_exports_range_check check (end_date >= start_date)
);

comment on column public.bookkeeping_exports.callback_token is
  'The secret in the webhook URL. It is both the authorisation for the public callback and the only way to match a callback to its export, since the order call returns no identifier. service_role only.';

comment on column public.bookkeeping_exports.storage_path is
  'Path in the bookkeeping-exports bucket. The provider''s own download link is deliberately not stored: it is unauthenticated, and the file is pulled behind our own tenant isolation instead.';

create index if not exists bookkeeping_exports_garage_id_idx
  on public.bookkeeping_exports using btree (garage_id);

create index if not exists bookkeeping_exports_recent_idx
  on public.bookkeeping_exports using btree (garage_id, created_at desc);

alter table public.bookkeeping_exports enable row level security;

/* Read-only to the garage, like every other tenant table. Writes belong to the
   two Edge Functions: one holds the provider credentials, the other answers to
   a caller who is nobody. Neither is a client. */
create policy "tenant_isolation" on public.bookkeeping_exports
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

/* Column-level, and the point of it is the column that is missing.
   `callback_token` is the authorisation for a public endpoint; a table-level
   grant would hand it to any client that wrote `select *`, and RLS would not
   care because the row IS theirs. Naming the readable columns makes the secret
   unreadable by construction rather than by convention — a `select *` now fails
   for `authenticated` instead of quietly returning the key.

   Anything added to this table later has to be added here too, and that is the
   intended friction: a new column on this table is a decision about whether the
   browser may see it. */
grant select (
  id, garage_id, start_date, end_date,
  export_docs, export_expenses, export_clients, export_suppliers,
  provider, format, status, error,
  storage_path, file_bytes, requested_by, created_at, ready_at
) on table public.bookkeeping_exports to authenticated;

grant all on table public.bookkeeping_exports to service_role;
revoke all on table public.bookkeeping_exports from anon;

/* The files. Private, and read through a signed URL minted for a caller the
   function has already checked — the same shape as ticket photos, for the same
   reason: a public bucket would put a garage's books on a guessable URL. */
insert into storage.buckets (id, name, public)
values ('bookkeeping-exports', 'bookkeeping-exports', false)
on conflict (id) do nothing;

/* Read scoped by the garage folder the path starts with. No insert, update or
   delete policy at all: only the callback writes here, and it runs as
   service_role, which bypasses these. A client has no business putting a file
   in a bookkeeping bucket. */
create policy "bookkeeping_exports_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bookkeeping-exports'
    and name like ((select public.current_garage_id())::text || '/%')
  );
