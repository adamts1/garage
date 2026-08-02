import type { Invoice } from '@garage/shared';

/**
 * What one document contributes to a sum of money billed.
 *
 * A credit note is stored with the SAME positive total as the invoice it
 * cancels — see supabase/functions/issue-invoice, which copies `total: inv.total`
 * onto the note. It is a separate document, not a negative amount.
 *
 * So adding a column of `total`s counts a cancelled sale twice: the ₪1,000
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
  /** Issued invoice-receipts only — what was billed and not undone. */
  issued: number;
  issuedCount: number;
  receiptCount: number;
  cancelledCount: number;
}

/** The KPI row. Deliberately not the same arithmetic as the table footer: this
 *  answers "how much did we bill", the footer answers "what does this filtered
 *  view add up to". */
export function headline(invoices: readonly Invoice[]): InvoiceHeadline {
  const receipts = invoices.filter((i) => i.docType === 'invoice_receipt');
  const issued = receipts.filter((i) => i.status === 'issued');
  return {
    issued: issued.reduce((sum, i) => sum + i.total, 0),
    issuedCount: issued.length,
    receiptCount: receipts.length,
    cancelledCount: receipts.filter((i) => i.status === 'cancelled').length,
  };
}
