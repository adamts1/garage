-- A credit note may never take back more than the invoice was issued for.
--
-- 20260806010000 made "how much of this invoice has already been given back" a
-- sum the database can answer, and issue-invoice asks it before issuing. That
-- is a check, and a check is not a guarantee: the function reads the sum, then
-- calls the provider over the network, then writes the row. Two advisors
-- crediting the same invoice at the same moment both read the same total, both
-- pass, and both write — and the provider call sitting between the read and the
-- write holds that window open for seconds at a time.
--
-- What is being defended is not a tidy invariant. It is a customer being handed
-- back more than they ever paid, on real tax documents that cannot be deleted.
--
-- A CHECK constraint cannot express it: the rule is about a SUM across sibling
-- rows, and CHECK sees one row. So it is a trigger, and the lock is the point of
-- it — SELECT ... FOR UPDATE on the invoice being credited makes the second
-- inserter wait for the first to commit, and read-committed then shows it the
-- row that just landed. Concurrent credits against the SAME invoice serialise;
-- credits against different invoices never touch each other.
--
-- The invoice row is only locked, never written, so invoices_are_immutable() is
-- not involved: FOR UPDATE takes a lock, it does not fire an UPDATE trigger.
--
-- This is a backstop, not the primary path. issue-invoice still checks first,
-- because failing before the provider is called is far better than failing
-- after: a rejected insert here leaves a real refund document at the provider
-- with no row against it, which is a mess a human has to unpick. Rare and loud
-- beats silent and wrong.

CREATE OR REPLACE FUNCTION "public"."credit_note_within_invoice"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  invoice_total numeric(12,2);
  already numeric(12,2);
begin
  -- Only a credit note that names its parent is bounded by anything. A note
  -- written before 20260806010000 carries no link and is not re-litigated here.
  if new.doc_type <> 'credit_note' or new.credits_invoice_id is null then
    return new;
  end if;

  select total into invoice_total
    from public.invoices
   where id = new.credits_invoice_id
     for update;

  if invoice_total is null then
    raise exception 'credit note names an invoice that does not exist: %', new.credits_invoice_id
      using errcode = 'foreign_key_violation';
  end if;

  -- After the lock, so this sees anything a competing transaction committed
  -- while we waited for it.
  select coalesce(sum(total), 0) into already
    from public.invoices
   where credits_invoice_id = new.credits_invoice_id
     and doc_type = 'credit_note';

  if already + new.total > invoice_total then
    raise exception
      'credit notes against invoice % would come to %, more than the % it was issued for',
      new.credits_invoice_id, already + new.total, invoice_total
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."credit_note_within_invoice"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."credit_note_within_invoice"() IS
  'Refuses a credit note that would take the total credited past the invoice it credits. Locks that invoice, so two credits issued at the same instant cannot both pass the check.';

DROP TRIGGER IF EXISTS "credit_notes_within_invoice" ON "public"."invoices";
CREATE TRIGGER "credit_notes_within_invoice"
  BEFORE INSERT ON "public"."invoices"
  FOR EACH ROW EXECUTE FUNCTION "public"."credit_note_within_invoice"();
