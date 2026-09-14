-- Invoices with no work order behind them, and a guard against issuing one
-- twice.
--
-- Until now every invoice came from a ticket, and `ticket_id` was how the
-- issuing function stayed idempotent: ask for a bill on a ticket that already
-- has one and it hands back the existing row instead of asking the provider for
-- a second legal number. A counter sale — one part, one customer, no ticket —
-- has no such key, and a slow network with an impatient second click would put
-- two real tax documents at the provider, both stored, both valid, and only
-- undoable by issuing credit notes against them.
--
-- So the caller brings the key. The client mints one when the dialog opens, not
-- when the button is pressed, so every press of that dialog carries the same
-- one and only the first reaches the provider.


alter table public.invoices
  add column if not exists idempotency_key uuid;

comment on column public.invoices.idempotency_key is
  'Client-minted key for an invoice with no ticket behind it, so a retried request returns the document already issued instead of allocating a second legal number. NULL for every ticket-issued invoice, which is deduplicated on ticket_id instead.';

-- Partial and unique: two counter sales cannot share a key within a garage, and
-- the thousands of ticket-issued rows carrying NULL are simply not in the index.
create unique index if not exists invoices_idempotency_key_uniq
  on public.invoices (garage_id, idempotency_key)
  where idempotency_key is not null;


-- ============================================================
-- ticket_key, for a document that never had a ticket
-- ============================================================
--
-- Already nullable — invoices.ticket_id is ON DELETE SET NULL, so a row whose
-- ticket was deleted has been possible since the baseline. Nothing to change;
-- written down because "can this column be null" is the first question anyone
-- reading the new action will have.
