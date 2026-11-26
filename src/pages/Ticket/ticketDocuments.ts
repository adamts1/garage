import { creditNotesFor, type Invoice } from '@garage/shared';

/* Which of a ticket's tax documents the panel leads with, and how the rest are
   listed beneath it.

   Two questions the panel answers separately, because they have different
   answers after a partial credit:

     - the PRIMARY document is the one that stands for the sale: the live bill,
       which a partial credit only reduces. Once a bill is cancelled by a full
       credit and not re-issued, nothing stands for the sale any more, and the
       credit note that cancelled it is what the customer holds.
     - the NEW document is the one the customer most likely has not been given
       yet: the latest issued, flagged for a few days when it is not the primary
       (a partial credit note is the usual case). */

/** How long the latest document keeps its "new" flag. */
export const NEW_FOR_DAYS = 7;

export interface TicketDocRow {
  doc: Invoice;
  isNew: boolean;
}

export interface TicketDocuments {
  primary: Invoice | null;
  /** Everything else on the ticket, newest first. Empty when there is one. */
  others: TicketDocRow[];
}

const newestFirst = (a: Invoice, b: Invoice) =>
  (b.issuedAt ?? '').localeCompare(a.issuedAt ?? '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');

export function ticketDocuments(
  docs: readonly Invoice[],
  bill: Invoice | null,
  now: Date = new Date(),
): TicketDocuments {
  const sorted = [...docs].sort(newestFirst);

  let primary: Invoice | null = bill;
  if (bill && bill.status === 'cancelled') {
    const notes = creditNotesFor(bill, docs).sort(newestFirst);
    const canceller = notes.find((n) => n.id === bill.cancelledBy) ?? notes[0];
    if (canceller) primary = canceller;
  }
  if (!primary) primary = sorted[0] ?? null;

  const latest = sorted[0];
  const fresh = (d: Invoice) => {
    const at = new Date(d.issuedAt).getTime();
    return !Number.isNaN(at) && now.getTime() - at < NEW_FOR_DAYS * 86_400_000;
  };

  const others = sorted
    .filter((d) => d.id !== primary?.id)
    .map((doc) => ({ doc, isNew: doc === latest && fresh(doc) }));

  return { primary, others };
}

/** A credit note gives money back, so it is listed below zero. */
export const signedTotal = (d: Invoice): number => (d.docType === 'credit_note' ? -d.total : d.total);
