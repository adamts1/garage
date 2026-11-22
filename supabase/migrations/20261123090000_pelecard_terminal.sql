-- The physical card terminal (Pelecard N6) — 2026-11-23.
--
-- 1. A breaker against locking the garage's account. Pelecard locks a user
--    after failed logins (it happened to the pilot garage). The first answer
--    that says the credentials are wrong (codes 404/501/502/503/505/507/509)
--    switches card payments OFF for that garage and records why; from then on
--    nothing is sent to the provider with those credentials — not a charge,
--    not a status check, not a refund — until an admin reconnects
--    (scripts/connect-payments.mjs clears it).
--
-- 2. How each card payment was taken: typed on the provider's page, or on the
--    terminal. A refund of a terminal payment uses the provider's terminal
--    (EMV) operations, so the payment has to say which it was.
--
-- 3. Terminal checks: an attempt that only checks the card (no money moves),
--    run by an admin to prove the terminal answers. Kept in card_payments with
--    purpose = 'check' and no ticket, so it goes through the same verified
--    path — and can never be put on a document.

alter table public.garage_payments
  add column if not exists auth_failed_at timestamptz,
  add column if not exists auth_error     text;

comment on column public.garage_payments.auth_failed_at is
  'Set when the provider rejected the credentials. While set, nothing is sent to the provider for this garage. Cleared by connect-payments.';

-- Members read garage_payments whole (its grant is table-level), so the screen
-- can say "card payments are suspended" without asking the function.

alter table public.card_payments
  add column if not exists entry   text check (entry in ('page', 'terminal')),
  add column if not exists purpose text not null default 'charge' check (purpose in ('charge', 'check'));

grant select (entry, purpose) on table public.card_payments to authenticated;

/* A check moves no money and is about no ticket. */
alter table public.card_payments drop constraint if exists card_payments_check_has_no_ticket;
alter table public.card_payments add constraint card_payments_check_has_no_ticket
  check (purpose = 'charge' or (ticket_id is null and invoice_id is null));
