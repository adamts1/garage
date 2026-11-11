-- One receipt for every payment taken at one visit.
--
-- A customer paying part in cash and the rest on a card used to get a receipt
-- per part, because a document could name only one method (`pay_method`). The
-- parts are now gathered on screen and issued together, so the document has to
-- be able to say how each part arrived.
--
-- `payments` holds them: [{ "method": "cash", "amount": 500, "reference": null }, …].
-- Set only when there is more than one; a single-method document keeps using
-- `pay_method` exactly as before, and in that case `payments` is null. When
-- `payments` is set, `pay_method` is null — no one method names the document.
--
-- Adding a nullable column rewrites no row, so invoices_immutable (which guards
-- UPDATE and DELETE on issued documents) is not involved. The CHECK is
-- validated against existing rows, all of which are null.

alter table public.invoices
  add column payments jsonb;

alter table public.invoices
  add constraint invoices_payments_is_array
  check (payments is null or (jsonb_typeof(payments) = 'array' and jsonb_array_length(payments) > 0));

comment on column public.invoices.payments is
  'Every payment the document records when it records more than one: [{method, amount, reference}], method being a code (see PAY_METHODS in packages/shared/src/payment.ts), amount VAT-inclusive. NULL on a single-method document (that is pay_method) and on documents that record no payment.';
