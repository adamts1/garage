import { creditedTotal, type Invoice } from '@garage/shared';

/**
 * What one document contributes to a sum of money billed.
 *
 * A credit note is stored with a POSITIVE total — see supabase/functions/
 * issue-invoice, which writes the amount credited onto its own row. It is a
 * separate document, not a negative amount.
 *
 * So adding a column of `total`s counts a refunded sale twice: the ₪1,000
 * invoice, and the ₪1,000 note that undid it, for ₪2,000 billed on a ticket
 * that earned nothing. Signing the note negative is what makes a sum mean
 * "money actually billed", and makes an invoice and its own credit note cancel
 * to zero, which is the whole point of issuing one.
 */
export const signedTotal = (invoice: Invoice): number =>
  invoice.docType === 'credit_note' ? -invoice.total : invoice.total;

/** Net billed across any set of documents. */
export const netTotal = (invoices: readonly Invoice[]): number =>
  invoices.reduce((sum, invoice) => sum + signedTotal(invoice), 0);

export interface InvoiceHeadline {
  /** Issued invoice-receipts, less every credit note written against them. */
  issued: number;
  issuedCount: number;
  receiptCount: number;
  cancelledCount: number;
  /** Money handed back: every credit note in this set, cancellations included. */
  credited: number;
  /** Live invoices carrying a partial credit — the ones whose headline figure
   *  is no longer what the garage kept. */
  partiallyCreditedCount: number;
}

/** The KPI row. Deliberately not the same arithmetic as the table footer: this
 *  answers "how much did we bill", the footer answers "what does this filtered
 *  view add up to".
 *
 *  `issued` used to sum live receipts at their face value, which was right
 *  while a credit note could only ever cancel an invoice outright: a credited
 *  invoice was a cancelled one, and cancelled ones were already excluded. Once
 *  part of a bill can be given back, a live ₪1,000 invoice with ₪300 credited
 *  is ₪700 of takings, and the old sum overstated the garage's month by exactly
 *  what it had refunded. */
export function headline(invoices: readonly Invoice[]): InvoiceHeadline {
  const receipts = invoices.filter((i) => i.docType === 'invoice_receipt');
  const live = receipts.filter((i) => i.status === 'issued');
  const credits = live.map((i) => creditedTotal(i, invoices));

  return {
    issued: round2(live.reduce((sum, i, at) => sum + i.total - credits[at], 0)),
    issuedCount: live.length,
    receiptCount: receipts.length,
    cancelledCount: receipts.filter((i) => i.status === 'cancelled').length,
    credited: round2(
      invoices.filter((i) => i.docType === 'credit_note').reduce((sum, i) => sum + i.total, 0),
    ),
    partiallyCreditedCount: credits.filter((c) => c > 0).length,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
