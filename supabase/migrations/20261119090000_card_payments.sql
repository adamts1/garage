-- Card payments taken through a clearing provider (Pelecard first) — 2026-11-19.
--
-- Mirrors the invoicing seam on purpose (garage_billing / garage_billing_secrets):
--
--   * garage_payments         — which provider, whether it is on, and the
--     shop number of the garage's physical card terminal if it has one. Its
--     members may READ it (the drawer asks "can I charge a card here?"), not
--     write it: connecting is an admin action (scripts/connect-payments.mjs).
--
--   * garage_payment_secrets  — the provider credentials. No grant to anon or
--     authenticated at all; only service_role, i.e. the card-payment function.
--
--   * card_payments           — one row per ATTEMPT to charge a card. A hosted
--     payment page can be used once and expires within minutes, so a retry is
--     a new page and a new row; a row is never repointed at another
--     transaction (if the customer completed the old page that charge is real).
--
-- The rule the whole feature rests on: a row becomes 'paid' only after the
-- server has fetched the transaction from the provider AND validated it AND the
-- amount matches. Nothing the browser reports is evidence. When no verdict can
-- be reached the row stays 'pending' — never 'declined' — because telling a
-- customer whose card was charged that it failed means charging them twice.

-- ------------------------------------------------------------ garage_payments

create table if not exists public.garage_payments (
  garage_id   uuid primary key references public.garages(id) on delete cascade,
  provider    text not null default 'pelecard',
  active      boolean not null default false,
  /* The physical terminal (Pelecard: ShopNo). Null = no terminal: the hosted
     page offers card entry only. */
  pos_shop_no text,
  /* Installments (תשלומים רגילים — no credit/interest plans). The close drawer
     offers 1..max_installments, and only on a payment of at least
     installments_min_amount. They apply to a card however it is taken: charged
     through the provider, or on a terminal the system does not talk to and
     recorded by hand — so a garage with no provider still has these, on a row
     with active = false. max_installments = 1 turns installments off. */
  max_installments       integer not null default 12 check (max_installments between 1 and 36),
  installments_min_amount numeric(12,2) not null default 0 check (installments_min_amount >= 0),
  updated_at  timestamptz not null default now()
);

alter table public.garage_payments owner to postgres;
alter table public.garage_payments enable row level security;

create policy garage_payments_read on public.garage_payments
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

revoke all on table public.garage_payments from anon, authenticated;
grant select on table public.garage_payments to authenticated;
grant all on table public.garage_payments to service_role;

-- ------------------------------------------------------------ garage_payment_secrets

create table if not exists public.garage_payment_secrets (
  garage_id   uuid primary key references public.garages(id) on delete cascade,
  credentials jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.garage_payment_secrets owner to postgres;
alter table public.garage_payment_secrets enable row level security;
-- No policy, no grant: invisible to every client role.
revoke all on table public.garage_payment_secrets from anon, authenticated;
grant all on table public.garage_payment_secrets to service_role;

-- ------------------------------------------------------------ card_payments

create table if not exists public.card_payments (
  id               uuid primary key default gen_random_uuid(),
  garage_id        uuid not null references public.garages(id) on delete cascade,
  ticket_id        uuid references public.tickets(id) on delete set null,
  provider         text not null,
  /* counter: the advisor's screen (card typed or the physical terminal).
     link: a page the customer opens on their own phone. */
  mode             text not null default 'counter' check (mode in ('counter', 'link')),
  amount           numeric(12,2) not null check (amount > 0),
  /* How many installments the advisor chose. The provider is told exactly this
     many, and a result for any other number is not believed. */
  installments     integer not null default 1 check (installments between 1 and 36),
  status           text not null default 'pending'
                   check (status in ('pending', 'paid', 'declined')),
  /* The document this payment is on — set once, by issue-invoice, when the
     receipt that records it is stored. A paid payment with none is money
     taken that no document shows yet; the next attempt on the ticket returns
     it instead of charging again. */
  invoice_id       uuid references public.invoices(id) on delete set null,
  /* The provider's id for the hosted page / transaction. */
  provider_tx_id   text,
  /* Needed to validate the result with the provider. Not a card secret, but no
     client needs it, so it is not in the column grant below. */
  confirmation_key text,
  approval_number  text,
  card_last4       text,
  card_brand       text,
  /* The brand as a code (visa | mastercard | amex | diners | isracard), for the
     receipt; card_brand is the issuer's own Hebrew name, for the screen. */
  card_type        text,
  /* Human-readable reason for a decline, or why a verdict is still pending. */
  message          text,
  /* The provider's last answer, card number masked. For support, not for UI. */
  raw              jsonb,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  settled_at       timestamptz
);

alter table public.card_payments owner to postgres;
create index if not exists card_payments_garage_ticket on public.card_payments (garage_id, ticket_id);
create index if not exists card_payments_invoice on public.card_payments (invoice_id);

alter table public.card_payments enable row level security;

create policy card_payments_read on public.card_payments
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

-- Members read the outcome; only the function writes. confirmation_key and raw
-- stay server-side.
revoke all on table public.card_payments from anon, authenticated;
grant select (id, garage_id, ticket_id, invoice_id, provider, mode, amount, installments, status, provider_tx_id,
              approval_number, card_last4, card_brand, card_type, message, created_by,
              created_at, updated_at, settled_at)
  on table public.card_payments to authenticated;
grant all on table public.card_payments to service_role;

/* A settled payment is history. 'paid' is final — money moved — and so is the
   amount and the transaction it was taken on. 'declined' may still become
   'paid': a verdict read early can be overtaken by the provider's own record,
   and the provider's record wins. */
create or replace function public.card_payments_settle_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'paid' and (new.status <> 'paid'
      or new.amount is distinct from old.amount
      or new.installments is distinct from old.installments
      or new.provider_tx_id is distinct from old.provider_tx_id
      or new.approval_number is distinct from old.approval_number) then
    raise exception 'card payment % is paid and cannot change', old.id;
  end if;
  if new.amount is distinct from old.amount or new.installments is distinct from old.installments then
    raise exception 'card payment % amount cannot change', old.id;
  end if;
  if old.provider_tx_id is not null and new.provider_tx_id is distinct from old.provider_tx_id then
    raise exception 'card payment % cannot move to another transaction', old.id;
  end if;
  /* On one document, once. Only a paid payment goes on a document. */
  if old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    raise exception 'card payment % is already on a document', old.id;
  end if;
  if new.invoice_id is not null and new.status <> 'paid' then
    raise exception 'card payment % is not paid and cannot go on a document', old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter function public.card_payments_settle_once() owner to postgres;
revoke all on function public.card_payments_settle_once() from public, anon, authenticated;

drop trigger if exists card_payments_settle_once on public.card_payments;
create trigger card_payments_settle_once
  before update on public.card_payments
  for each row execute function public.card_payments_settle_once();
