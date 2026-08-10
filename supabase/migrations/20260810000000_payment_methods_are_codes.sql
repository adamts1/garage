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

COMMENT ON COLUMN "public"."invoices"."pay_method" IS
  'A code, not a label: cash | card | bit | bank_transfer | cheque | other. NULL on a document that records no payment. Mirrors tickets.pay_method; see PAY_METHODS in packages/shared/src/payment.ts.';
