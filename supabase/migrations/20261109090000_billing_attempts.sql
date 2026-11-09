-- A billing act is written down BEFORE the provider is asked to perform it.
--
-- issue-invoice checks what is still owed (or whether a ticket already has its
-- bill), then calls the provider, then inserts the document's row. The check and
-- the insert are separate steps with a network call between them, so two calls
-- that overlap — two counters, a double click, a retry after a timeout — both
-- passed the check and both created a legal document at the provider. The
-- triggers and unique indexes on `invoices` did refuse the second row, but only
-- after the second document already existed, and nothing recorded it: a tax
-- document at iCount that this system has never heard of.
--
-- So every issue, counter sale, collect and credit first inserts a row here, and
-- at most one may be open per target — the ticket being billed, the invoice
-- being collected on or credited, the key of a counter sale. The second of two
-- overlapping calls fails on the unique index before it reaches the provider.
--
-- The row also records how the act ended, which is what makes the failures
-- that matter visible instead of lost:
--
--   pending   the provider is being asked right now
--   done      the document exists and its row is in `invoices`
--   failed    the provider said no; nothing was created, the target is free
--   unknown   no answer (timeout, network, a crash mid-call): a document may or
--             may not exist at the provider. Never guessed either way — the
--             target stays locked until somebody checks the provider and
--             resolves the row by hand (docs/PRODUCTION.md, "billing attempts").
--   orphaned  the provider created the document (its number is here) but
--             storing it failed. Locked the same way, and the number is kept so
--             the row can be completed rather than the document hunted for.
--
-- Written only by the Edge Function (service_role). Members of the garage may
-- read their own, so the app can say why a bill is locked.

create table public.billing_attempts (
  id               uuid primary key default gen_random_uuid(),
  garage_id        uuid not null references public.garages(id) on delete cascade,
  action           text not null check (action in ('issue', 'issue_standalone', 'collect', 'credit')),
  -- The ticket for 'issue', the invoice for 'collect'/'credit', the client's
  -- idempotency key for 'issue_standalone' (a counter sale has no other target).
  target_id        uuid not null,
  amount           numeric(12, 2),
  state            text not null default 'pending'
                     check (state in ('pending', 'done', 'failed', 'unknown', 'orphaned')),
  provider_docnum  text,
  invoice_id       uuid references public.invoices(id),
  error            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.billing_attempts is
  'One row per billing act (issue, counter sale, collect, credit), written before the provider is called. At most one open (pending/unknown/orphaned) per target, so overlapping calls cannot both create a document. See the migration 20261109090000 for the states.';

-- The lock. Open states only: a finished or refused attempt frees the target.
create unique index billing_attempts_one_open_per_target
  on public.billing_attempts (target_id)
  where state in ('pending', 'unknown', 'orphaned');

create index billing_attempts_garage_created_idx
  on public.billing_attempts (garage_id, created_at desc);

alter table public.billing_attempts enable row level security;

create policy billing_attempts_read on public.billing_attempts
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

grant select on public.billing_attempts to authenticated;
grant select, insert, update on public.billing_attempts to service_role;
