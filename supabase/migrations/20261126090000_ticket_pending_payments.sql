/* Money taken at the counter that no document records yet.

   A visit paid in several parts (cash 400 + card 600) is billed by ONE
   document, issued after the last part. Until then the parts lived only on the
   screen. A card the clearing provider charged has its own row
   (card_payments), so a receipt that failed could be issued again later with
   the card on it. Cash, Bit, a cheque or a transfer had nothing: the retry
   found only the card, and issued a tax invoice with a receipt for the card
   alone, as though the cash had never arrived.

   So the parts that are not a provider charge are written here when the
   ticket is closed, and cleared once a document records them. The next
   document for the ticket (the retry, or "גבה תשלום") starts from them.

   A list of PaymentPart (packages/shared/src/payment.ts): method code, amount,
   reference. Null when nothing is waiting. Written by the garage's own
   members through the table's existing grant and policy. */

alter table public.tickets
  add column if not exists pending_payments jsonb;

comment on column public.tickets.pending_payments is
  'Payments taken for this visit (not card charges, which are in card_payments) that no document records yet. Set on close, cleared when the receipt is issued. See 20261126090000_ticket_pending_payments.sql.';
