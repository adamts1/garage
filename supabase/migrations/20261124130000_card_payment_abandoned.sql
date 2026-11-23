-- An abandoned card attempt — 2026-11-24.
--
-- Its own migration: 20261124120000 was already applied when this was added.

-- An attempt the advisor walked away from — cancelled on the provider's page,
-- stopped in the drawer, or left to expire. It stays 'pending' (no verdict was
-- read, and a guessed "failed" is how a customer pays twice) and is still
-- re-checked with the provider before any new charge on the ticket; it only
-- stops a new attempt from asking "an earlier page may still be paid?" —
-- the question was answered when it was abandoned.
alter table public.card_payments
  add column if not exists abandoned_at timestamptz;

grant select (abandoned_at) on table public.card_payments to authenticated;
