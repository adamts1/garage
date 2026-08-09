-- Two things the reports need that the database cannot currently say.
--
-- 1. AN INVOICE THAT HAS NOT BEEN PAID
--
-- Every document this system issues is a חשבונית מס-קבלה: billed and settled in
-- the same breath, because it is only ever issued off a ticket already marked
-- paid. That is most of a garage's work and it was the right place to start.
--
-- It cannot express the other half. A fleet customer, a leasing company, an
-- insurer — they are invoiced and they pay in thirty days, and what they owe in
-- between is the single number an aging report exists to show. Under one
-- doc_type that number is not merely unreported, it is unrepresentable.
--
-- So: 'tax_invoice' is a bill, and 'receipt' is the money arriving against it.
-- Two documents, which is what the tax authority wants anyway — the receipt is
-- what the customer gets when they pay, and it names the invoice it settles.
-- 'invoice_receipt' stays exactly what it was, and stays the common case.
--
-- What is owed on an invoice is therefore a subtraction, not a flag: its total,
-- less the receipts against it, less the credit notes against it. Both sides
-- are sums over sibling rows and both are asked of the database, for the same
-- reason invoice_credited_total() is — a client computes them from the rows it
-- happens to be holding.
--
-- 2. WHEN A SUPPLIER'S CHEQUE COMES OUT OF THE ACCOUNT
--
-- supplier_expenses knows whether a bill was paid and nothing whatever about
-- how or when. A garage pays its suppliers in post-dated cheques, and "what am
-- I committed to, and on which day does each one land" is the question the
-- obligo report is for. `paid` as a boolean answers none of it.
--
-- due_date is when the bill is owed; cheque_date is when the cheque clears, and
-- they are not the same day — that gap is the whole point of a post-dated
-- cheque. One cheque per expense, which is the shape a garage writing one
-- cheque per supplier invoice actually has; several cheques against one bill
-- would need a payments table, and that can be a later migration if it turns
-- out to be needed.

-- ---------- documents that are bills, and documents that are payment ----------

ALTER TABLE "public"."invoices" DROP CONSTRAINT IF EXISTS "invoices_doc_type_check";
ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_doc_type_check"
  CHECK ("doc_type" = ANY (ARRAY['invoice_receipt'::"text", 'tax_invoice'::"text", 'receipt'::"text", 'credit_note'::"text"]));

-- The garage's default document. Which one a given ticket gets is decided at
-- issue time; this is what the UI offers first.
ALTER TABLE "public"."garage_billing" DROP CONSTRAINT IF EXISTS "garage_billing_doc_type_check";
ALTER TABLE "public"."garage_billing"
  ADD CONSTRAINT "garage_billing_doc_type_check"
  CHECK ("doc_type" = ANY (ARRAY['invoice_receipt'::"text", 'tax_invoice'::"text"]));

ALTER TABLE "public"."invoices"
  ADD COLUMN IF NOT EXISTS "pays_invoice_id" "uuid" REFERENCES "public"."invoices"("id");

COMMENT ON COLUMN "public"."invoices"."pays_invoice_id" IS
  'For a receipt: the tax_invoice it settles. Several receipts may pay one invoice; their totals may not exceed what is owed on it. NULL on every other document type.';

CREATE INDEX IF NOT EXISTS "invoices_pays_invoice_id_idx"
  ON "public"."invoices" ("pays_invoice_id")
  WHERE "pays_invoice_id" IS NOT NULL;

/* Each link belongs to exactly one kind of document. The old constraint said
   only that a receipt-invoice credits nothing; with four types the useful
   statement is the positive one — a credit link means a credit note, a payment
   link means a receipt, and nothing else carries either. */
ALTER TABLE "public"."invoices" DROP CONSTRAINT IF EXISTS "invoices_receipt_credits_nothing";
ALTER TABLE "public"."invoices" DROP CONSTRAINT IF EXISTS "invoices_links_match_doc_type";
ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_links_match_doc_type"
  CHECK (
    ("credits_invoice_id" IS NULL OR "doc_type" = 'credit_note')
    AND ("pays_invoice_id" IS NULL OR "doc_type" = 'receipt')
  );

/* How much of an invoice has been paid. The mirror of invoice_credited_total,
   and kept beside it deliberately: what a customer still owes is the invoice
   less BOTH of them, and two functions that answer half the question each are
   easier to keep honest than one that answers it whole. */
CREATE OR REPLACE FUNCTION "public"."invoice_paid_total"("invoice" "uuid")
  RETURNS numeric
  LANGUAGE "sql" STABLE SECURITY DEFINER
  SET "search_path" TO ''
  AS $$
  select coalesce(sum(payment.total), 0)::numeric
    from public.invoices payment
    join public.invoices original on original.id = payment.pays_invoice_id
   where payment.pays_invoice_id = invoice
     and payment.doc_type = 'receipt'
     and original.garage_id = public.current_garage_id()
$$;

ALTER FUNCTION "public"."invoice_paid_total"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."invoice_paid_total"("uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."invoice_paid_total"("uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."invoice_paid_total"("uuid") TO "service_role";

COMMENT ON FUNCTION "public"."invoice_paid_total"("uuid") IS
  'Sum of the receipts issued against a tax invoice, 0 when none. Scoped to the caller''s garage. What is still owed is the invoice total, less this, less invoice_credited_total().';

/* A receipt may not collect more than is owed, for the same reason a credit
   note may not hand back more than was paid, and by the same mechanism: lock
   the invoice, then sum. Written as its own trigger rather than folded into
   credit_note_within_invoice() because they guard different columns against
   different totals, and one function doing both would have to ask which case it
   was in before every line of it. */
CREATE OR REPLACE FUNCTION "public"."receipt_within_invoice"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  invoice_total numeric(12,2);
  invoice_type text;
  collected numeric(12,2);
  credited numeric(12,2);
begin
  if new.doc_type <> 'receipt' or new.pays_invoice_id is null then
    return new;
  end if;

  select total, doc_type into invoice_total, invoice_type
    from public.invoices
   where id = new.pays_invoice_id
     for update;

  if invoice_total is null then
    raise exception 'receipt names an invoice that does not exist: %', new.pays_invoice_id
      using errcode = 'foreign_key_violation';
  end if;

  -- A מס-קבלה was already paid when it was issued, and a receipt against a
  -- credit note or another receipt is meaningless.
  if invoice_type <> 'tax_invoice' then
    raise exception 'only a tax invoice can be settled by a receipt, not a %', invoice_type
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(total), 0) into collected
    from public.invoices
   where pays_invoice_id = new.pays_invoice_id and doc_type = 'receipt';

  -- Credited money was never collected and never will be, so it is not still
  -- owed: an invoice for 1,000 with 200 credited is settled by 800.
  select coalesce(sum(total), 0) into credited
    from public.invoices
   where credits_invoice_id = new.pays_invoice_id and doc_type = 'credit_note';

  if collected + new.total > invoice_total - credited then
    raise exception
      'receipts against invoice % would come to %, more than the % still owed on it',
      new.pays_invoice_id, collected + new.total, invoice_total - credited
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."receipt_within_invoice"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."receipt_within_invoice"() IS
  'Refuses a receipt that would collect more than its tax invoice still owes, credits included. Locks that invoice, so two receipts issued at the same instant cannot both pass.';

DROP TRIGGER IF EXISTS "receipts_within_invoice" ON "public"."invoices";
CREATE TRIGGER "receipts_within_invoice"
  BEFORE INSERT ON "public"."invoices"
  FOR EACH ROW EXECUTE FUNCTION "public"."receipt_within_invoice"();

-- ---------- what the garage owes, and when the cheque lands ----------

ALTER TABLE "public"."supplier_expenses"
  ADD COLUMN IF NOT EXISTS "due_date" "date",
  ADD COLUMN IF NOT EXISTS "cheque_number" "text",
  ADD COLUMN IF NOT EXISTS "cheque_date" "date";

COMMENT ON COLUMN "public"."supplier_expenses"."due_date" IS
  'When the supplier is owed. NULL means on receipt — the expense date is the due date. This is what ages an unpaid bill, not expense_date.';
COMMENT ON COLUMN "public"."supplier_expenses"."cheque_number" IS
  'The cheque written for this bill, when it was paid by one. One cheque per expense; several against one bill would need a payments table.';
COMMENT ON COLUMN "public"."supplier_expenses"."cheque_date" IS
  'The date ON the cheque, which for a post-dated one is not the day it was written and not the day the bill was due. This is the day the money leaves the account, and the day the obligo report groups by.';

-- The obligo report reads exactly this slice: what is still owed, oldest first.
CREATE INDEX IF NOT EXISTS "supplier_expenses_unpaid_idx"
  ON "public"."supplier_expenses" ("garage_id", "due_date")
  WHERE NOT "paid";

CREATE INDEX IF NOT EXISTS "supplier_expenses_cheque_date_idx"
  ON "public"."supplier_expenses" ("garage_id", "cheque_date")
  WHERE "cheque_date" IS NOT NULL;
