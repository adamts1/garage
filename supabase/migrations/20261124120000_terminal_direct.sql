-- A card charged straight on the terminal, without the provider's page —
-- 2026-11-24.
--
-- Pelecard (2026-11-22): a charge sent to the services API with the terminal's
-- shop number and no card values goes to the N6 itself. The server asks, the
-- customer taps, the answer comes back to the server — no hosted page, no
-- browser in between.
--
-- That answer can be lost (a dropped connection while the customer is still
-- at the terminal). A page attempt is then found again by its page id
-- (GetTransaction); a direct one has none, so it is found by its own ParamX in
-- the provider's transaction report. `channel` says which way an attempt went,
-- and so how to look it up.

alter table public.card_payments
  add column if not exists channel text not null default 'page' check (channel in ('page', 'direct'));

grant select (channel) on table public.card_payments to authenticated;

-- An attempt the advisor walked away from — cancelled on the provider's page,
-- stopped in the drawer, or left to expire. It stays 'pending' (no verdict was
-- read, and a guessed "failed" is how a customer pays twice) and is still
-- re-checked with the provider before any new charge on the ticket; it only
-- stops a new attempt from asking "an earlier page may still be paid?" —
-- the question was answered when it was abandoned.
alter table public.card_payments
  add column if not exists abandoned_at timestamptz;

grant select (abandoned_at) on table public.card_payments to authenticated;
