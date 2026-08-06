-- Crediting a customer part of what they paid.
--
-- A credit note already existed, and could only ever be one thing: the undo of
-- a whole invoice. `cancel` copied the original's lines and totals onto a new
-- refund document and flipped the original to 'cancelled'. All or nothing.
--
-- A garage credits part of a bill often: a part came back, a job was rebooked,
-- a customer was overcharged for an hour nobody worked. Under the old shape the
-- only way to record that was to cancel the whole invoice and issue a fresh one
-- for the difference — which is a lie about what happened, and gives the
-- customer two documents to reconcile instead of one correction.
--
-- What the accounting requires, and what this makes representable:
--
--   * an issued tax document is never edited or deleted. A correction is its
--     own document, referencing the original. That part was already right.
--   * a FULL credit voids the invoice — status 'cancelled', as today.
--   * a PARTIAL credit voids nothing. The original stays 'issued', and the note
--     stands beside it reducing the net. So one invoice may have SEVERAL credit
--     notes over time (₪300 today, ₪150 next week), and what may still be
--     credited is the original's total minus what those notes already came to.
--
-- The link is what was missing. `cancelled_by` points from an invoice to the
-- note that killed it, which exists only in the all-or-nothing case and only
-- ever holds one id. This adds the other direction: every credit note says
-- which invoice it credits, one invoice has many notes, and "how much of this
-- invoice is still creditable" becomes a sum the database can answer rather
-- than something a client keeps in its head.

ALTER TABLE "public"."invoices"
  ADD COLUMN IF NOT EXISTS "credits_invoice_id" "uuid" REFERENCES "public"."invoices"("id");

COMMENT ON COLUMN "public"."invoices"."credits_invoice_id" IS
  'For a credit_note: the invoice_receipt it credits. Several notes may credit one invoice (partial credits); their totals may not exceed it. NULL on an invoice_receipt. The reverse link, invoices.cancelled_by, is set only when a credit takes the whole remaining amount.';

-- Every credit note written so far was a full cancellation, so the original
-- already names it. Read that backwards to fill the new column in.
UPDATE "public"."invoices" AS note
   SET "credits_invoice_id" = original."id"
  FROM "public"."invoices" AS original
 WHERE original."cancelled_by" = note."id"
   AND note."doc_type" = 'credit_note'
   AND note."credits_invoice_id" IS NULL;

/* An invoice-receipt credits nothing — the column is meaningless on one, and a
   value there would make the "already credited" sum below count a sale as a
   refund. Not asserted in the other direction: a credit note with no parent is
   a row that predates this column, and refusing to load a garage's history is a
   worse answer than a note whose link we never recorded. */
ALTER TABLE "public"."invoices"
  DROP CONSTRAINT IF EXISTS "invoices_receipt_credits_nothing";
ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_receipt_credits_nothing"
  CHECK ("doc_type" <> 'invoice_receipt' OR "credits_invoice_id" IS NULL);

CREATE INDEX IF NOT EXISTS "invoices_credits_invoice_id_idx"
  ON "public"."invoices" ("credits_invoice_id")
  WHERE "credits_invoice_id" IS NOT NULL;

/* How much of an invoice has already been given back.
 *
 * In SQL rather than in each client because it decides what may still be
 * credited, and a client that computes it from a list it happens to be holding
 * computes it from a stale one. The Edge Function calls this before issuing, so
 * two advisors crediting the same invoice at once cannot between them return
 * more than the customer ever paid.
 *
 * SECURITY DEFINER with an explicit garage check: it reads invoices belonging
 * to the caller's garage and no other. */
CREATE OR REPLACE FUNCTION "public"."invoice_credited_total"("invoice" "uuid")
  RETURNS numeric
  LANGUAGE "sql" STABLE SECURITY DEFINER
  SET "search_path" TO ''
  AS $$
  select coalesce(sum(note.total), 0)::numeric
    from public.invoices note
    join public.invoices original on original.id = note.credits_invoice_id
   where note.credits_invoice_id = invoice
     and note.doc_type = 'credit_note'
     and original.garage_id = public.current_garage_id()
$$;

ALTER FUNCTION "public"."invoice_credited_total"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."invoice_credited_total"("uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."invoice_credited_total"("uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."invoice_credited_total"("uuid") TO "service_role";

COMMENT ON FUNCTION "public"."invoice_credited_total"("uuid") IS
  'Sum of the credit notes already issued against an invoice, 0 when none. Scoped to the caller''s garage. What may still be credited is the invoice total minus this.';
