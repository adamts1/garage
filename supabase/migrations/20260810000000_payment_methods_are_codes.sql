-- How a garage was paid stops being a Hebrew label.
--
-- `tickets.pay_method` and `invoices.pay_method` were free text, and what went
-- into them was the text a screen displayed. The close-and-charge drawer wrote
-- `t('close.methods.card')` — the translated label out of the locale file — so
-- rewording a screen would have changed the meaning of rows already written,
-- and a second interface language would have made the column say different
-- things depending on which counter took the money. The collect dialog carried
-- its own list of four Hebrew words that was not the drawer's list of five:
-- 'אשראי' and 'כרטיס אשראי' were one payment that no query could group.
--
-- After this they are codes: cash | card | bit | bank_transfer | cheque | other.
-- What a user reads is looked up per app from the code, which is the only
-- arrangement where a wording change is a wording change. This is the same move
-- 20260805010000 made for customers.kind and tickets.flags.
--
-- 'חיוב פתוח' is not in the mapping, because it was never a payment method. The
-- drawer wrote it on tickets nobody had paid — a value in the column that
-- answers "how did the money arrive" for money that had not arrived. Those rows
-- are cleared.
--
-- No CHECK constraint, unlike customers.kind. That column had two values and a
-- known history; this one has years of imported free text behind it in the
-- garages' own data, and a constraint would refuse a backfill it cannot name.
-- The apps read it through payMethod() in packages/shared/src/payment.ts, which
-- resolves the legacy Hebrew and shows anything else as itself rather than as a
-- missing translation key.
--
-- Written to be safe to run twice: every UPDATE matches the old value only and
-- leaves an already-migrated row alone.
--
-- ONE THING HERE STEPS AROUND A GUARANTEE, AND IT IS DELIBERATE.
--
-- `invoices_immutable` refuses every UPDATE on an issued document except the
-- one transition to cancelled, because an invoice is a tax document and what it
-- says is what was reported. This migration turns that trigger off for the
-- length of one statement and back on immediately.
--
-- The justification, and the limit of it: this rewrite does not change what any
-- document SAYS. 'מזומן' and 'cash' both print as מזומן — payMethodHe resolves
-- them to the same word, so a re-print of a migrated invoice is
-- character-for-character what it was. What changes is the encoding, not the
-- statement. A migration that altered a sum, a line or a docnum would not get
-- this excuse and must not borrow it.
--
-- Turning it off is transactional: if anything below raises, the rollback
-- restores the trigger with everything else, so there is no path that leaves
-- the table unguarded. It is disabled by name rather than with
-- session_replication_role, which would silence every trigger on the table —
-- including the two that refuse an over-credit and an over-collect.

-- ---------------------------------------------------------------- tickets

UPDATE "public"."tickets"
   SET "pay_method" = CASE "btrim"("pay_method")
                        WHEN 'מזומן'          THEN 'cash'
                        WHEN 'אשראי'          THEN 'card'
                        WHEN 'כרטיס אשראי'    THEN 'card'
                        WHEN 'ביט'            THEN 'bit'
                        WHEN 'ביט / פייבוקס'  THEN 'bit'
                        WHEN 'העברה בנקאית'   THEN 'bank_transfer'
                        WHEN 'העברה'          THEN 'bank_transfer'
                        WHEN 'צ׳ק'            THEN 'cheque'
                        WHEN 'צ''ק'           THEN 'cheque'
                        -- Not a method. The ticket keeps `paid = false`, which
                        -- is what actually said this one was never paid.
                        WHEN 'חיוב פתוח'      THEN NULL
                      END
 WHERE "btrim"("pay_method") IN ('מזומן', 'אשראי', 'כרטיס אשראי', 'ביט', 'ביט / פייבוקס',
                                 'העברה בנקאית', 'העברה', 'צ׳ק', 'צ''ק', 'חיוב פתוח');

COMMENT ON COLUMN "public"."tickets"."pay_method" IS
  'A code, not a label: cash | card | bit | bank_transfer | cheque | other. NULL when no money has arrived. The apps translate it for display; see PAY_METHODS in packages/shared/src/payment.ts.';

-- ---------------------------------------------------------------- invoices

-- The same words, from the same two dialogs — a receipt carries the method the
-- payment was collected with, and an invrec the method the ticket was closed on.
--
-- Off, and on again four statements later. See the note at the top of the file
-- for why this one rewrite is allowed to and no other is.
ALTER TABLE "public"."invoices" DISABLE TRIGGER "invoices_immutable";

UPDATE "public"."invoices"
   SET "pay_method" = CASE "btrim"("pay_method")
                        WHEN 'מזומן'          THEN 'cash'
                        WHEN 'אשראי'          THEN 'card'
                        WHEN 'כרטיס אשראי'    THEN 'card'
                        WHEN 'ביט'            THEN 'bit'
                        WHEN 'ביט / פייבוקס'  THEN 'bit'
                        WHEN 'העברה בנקאית'   THEN 'bank_transfer'
                        WHEN 'העברה'          THEN 'bank_transfer'
                        WHEN 'צ׳ק'            THEN 'cheque'
                        WHEN 'צ''ק'           THEN 'cheque'
                        WHEN 'חיוב פתוח'      THEN NULL
                      END
 WHERE "btrim"("pay_method") IN ('מזומן', 'אשראי', 'כרטיס אשראי', 'ביט', 'ביט / פייבוקס',
                                 'העברה בנקאית', 'העברה', 'צ׳ק', 'צ''ק', 'חיוב פתוח');

ALTER TABLE "public"."invoices" ENABLE TRIGGER "invoices_immutable";

/* The guarantee is back, and this proves it rather than assuming it: if the
   ALTER above were ever dropped in an edit, every later deploy would run with
   issued invoices editable and nothing would say so. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_trigger"
     WHERE "tgrelid" = '"public"."invoices"'::"regclass"
       AND "tgname" = 'invoices_immutable'
       AND "tgenabled" <> 'D'
  ) THEN
    RAISE EXCEPTION 'invoices_immutable was left disabled — refusing to finish';
  END IF;
END $$;

COMMENT ON COLUMN "public"."invoices"."pay_method" IS
  'A code, not a label: cash | card | bit | bank_transfer | cheque | other. NULL on a document that records no payment. Mirrors tickets.pay_method; see PAY_METHODS in packages/shared/src/payment.ts.';
