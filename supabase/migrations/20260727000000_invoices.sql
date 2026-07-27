-- ============================================================
--  Phase 4a — invoices as stored, immutable legal documents.  *** DRAFT ***
--
--  This file is a DRAFT: filename prefixed DRAFT_ so `supabase db reset`/`push`
--  ignore it until the iCount answers are in and the shape is confirmed. Rename
--  to a real timestamp to activate.
--
--  §3.1: today an invoice is invoiceFrom() recomputing from the ticket's LIVE
--  works on every render — number is 10000+ticketNumber, VAT is a module
--  constant, nothing is stored. Editing a billed ticket silently rewrites an
--  issued tax document. That cannot be a legal invoice.
--
--  The fix is not "store the computed view". It is: the PROVIDER (iCount) issues
--  the legal document and owns its number and allocation number; we store what it
--  issued, frozen, forever. The record survives the ticket being edited, the
--  garage switching providers, or the provider changing its API — because it is a
--  snapshot, not a live view.
--
--  Numbering: NOT a per-garage counter like tickets. The legal number comes from
--  iCount (docnum) and the allocation number from רשות המסים via iCount. We never
--  allocate an invoice number ourselves — doing so was exactly the §3.1 bug.
-- ============================================================

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  garage_id      uuid not null default public.current_garage_id()
                 references public.garages(id) on delete restrict,
  -- The ticket this bills. SET NULL, not CASCADE: a tax document must outlive
  -- the ticket. Deleting a billed ticket must never delete its invoice — §3.1.
  ticket_id      uuid references public.tickets(id) on delete set null,
  ticket_key     text,                       -- kept even if ticket_id is nulled

  -- Provider-independent type. חשבונית מס-קבלה for the pilot; credit note cancels.
  doc_type       text not null check (doc_type in ('invoice_receipt','credit_note')),

  -- What the provider issued. These are the legal identity of the document.
  provider       text not null default 'icount',
  provider_docnum text not null,             -- iCount docnum — the legal number
  allocation_number text,                    -- מספר הקצאה; null below the threshold
  provider_doc_id text,                      -- iCount docid, for later API calls
  pdf_url        text,                        -- iCount doc_url (the PDF)

  -- Billing date = when issued, NOT ticket creation date (§3.1: wrong VAT period).
  issued_at      timestamptz not null default now(),

  -- Customer, frozen at issue. A later edit to the customer card must not change
  -- an issued document.
  customer_name  text,
  customer_id_number text,
  customer_address text,
  customer_phone text,

  -- Line items, frozen as a snapshot. Not a child table joined live — the whole
  -- point is that these never move again. [{desc, qty, unit_price, line_total}]
  lines          jsonb not null default '[]'::jsonb,

  -- Money, frozen. vat_rate stored PER INVOICE so reprinting an old document
  -- applies the rate that was in force then, not today's (§3.1).
  subtotal       numeric(12,2) not null,
  vat_rate       numeric(5,4)  not null,     -- e.g. 0.18
  vat            numeric(12,2) not null,
  total          numeric(12,2) not null,

  -- How it was paid (this is a מס-קבלה — invoice and receipt in one).
  pay_method     text,
  pay_reference  text,

  -- Lifecycle. An invoice is never edited or deleted; it is cancelled by issuing
  -- a credit note, and we link the two.
  status         text not null default 'issued' check (status in ('issued','cancelled')),
  cancelled_by   uuid references public.invoices(id),

  created_at     timestamptz not null default now()
);

create index if not exists invoices_garage_id_idx on public.invoices (garage_id);
create index if not exists invoices_ticket_id_idx on public.invoices (ticket_id);
-- The provider's number is unique within a garage's books.
create unique index if not exists invoices_garage_docnum_key
  on public.invoices (garage_id, provider, provider_docnum);

-- ---------- tenant isolation ----------
alter table public.invoices enable row level security;
grant select on public.invoices to authenticated;   -- read only; see below
grant select, insert, update on public.invoices to service_role;

-- Authenticated users may READ their garage's invoices, and nothing more. They
-- cannot INSERT: an invoice only exists after the Edge Function has had iCount
-- issue it, and that runs under service_role. A client that could insert could
-- fabricate a tax document.
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

-- ---------- immutability ----------
-- The financial record cannot be edited or deleted. The only permitted change is
-- linking a cancelling credit note (status → cancelled, cancelled_by set), done
-- by the Edge Function. Everything else raises.
create or replace function public.invoices_are_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices cannot be deleted — cancel with a credit note';
  end if;
  -- allow ONLY the cancellation link to change
  if row(new.*) is distinct from row(old.*) then
    if new.status = 'cancelled' and old.status = 'issued'
       and new.provider_docnum = old.provider_docnum
       and new.total = old.total and new.lines = old.lines then
      return new;   -- a cancellation, permitted
    end if;
    raise exception 'an issued invoice is immutable';
  end if;
  return new;
end $$;

drop trigger if exists invoices_immutable on public.invoices;
create trigger invoices_immutable
  before update or delete on public.invoices
  for each row execute function public.invoices_are_immutable();

alter table public.invoices replica identity full;
