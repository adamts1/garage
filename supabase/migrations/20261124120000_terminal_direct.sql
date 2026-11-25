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
