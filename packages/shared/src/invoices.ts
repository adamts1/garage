/* Invoices — stored, immutable legal documents.

   Unlike tickets, the app never writes an invoice row directly: issuing a tax
   document means having the provider (iCount) allocate its legal number, which
   only the issue-invoice Edge Function may do (it holds the garage's provider
   token, which no client can read). So this module has exactly two mutating
   calls — issue and cancel — and both are Edge Function invocations. Reads come
   straight from the invoices table, which RLS scopes to the caller's garage.

   See docs/PRODUCTION.md §4a and migration 20260727000000_invoices.sql. */

import { getClient, invokeError } from './client';

export type InvoiceDocType = 'invoice_receipt' | 'credit_note';
export type InvoiceStatus = 'issued' | 'cancelled';

export interface InvoiceLine {
  desc: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

/** One issued document, exactly as stored — a frozen snapshot, never recomputed. */
export interface Invoice {
  id: string;
  ticketId: string | null;
  ticketKey: string | null;
  docType: InvoiceDocType;
  provider: string;
  /** iCount's legal document number. */
  docnum: string;
  /** מספר הקצאה; null below the threshold or when not connected to רשות המסים. */
  allocationNumber: string | null;
  pdfUrl: string | null;
  issuedAt: string;               // ISO
  customerName: string | null;
  customerIdNumber: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
  payMethod: string | null;
  payReference: string | null;
  status: InvoiceStatus;
  /** the credit note that cancelled this one, if any */
  cancelledBy: string | null;
  /** On a credit note: the invoice-receipt it credits. One invoice may have
   *  several, because a credit can be for part of the bill. NULL on a receipt,
   *  and on credit notes written before the column existed. */
  creditsInvoiceId: string | null;
  createdAt: string;
}

const rowToInvoice = (r: any): Invoice => ({
  id: r.id,
  ticketId: r.ticket_id ?? null,
  ticketKey: r.ticket_key ?? null,
  docType: r.doc_type,
  provider: r.provider,
  docnum: r.provider_docnum,
  allocationNumber: r.allocation_number ?? null,
  pdfUrl: r.pdf_url ?? null,
  issuedAt: r.issued_at,
  customerName: r.customer_name ?? null,
  customerIdNumber: r.customer_id_number ?? null,
  customerAddress: r.customer_address ?? null,
  customerPhone: r.customer_phone ?? null,
  lines: (r.lines ?? []) as InvoiceLine[],
  subtotal: Number(r.subtotal),
  vatRate: Number(r.vat_rate),
  vat: Number(r.vat),
  total: Number(r.total),
  payMethod: r.pay_method ?? null,
  payReference: r.pay_reference ?? null,
  status: r.status,
  cancelledBy: r.cancelled_by ?? null,
  creditsInvoiceId: r.credits_invoice_id ?? null,
  createdAt: r.created_at,
});

/** The garage's invoices, newest first. RLS scopes this to the caller's garage. */
export const listInvoices = async (): Promise<Invoice[]> => {
  const { data, error } = await getClient()
    .from('invoices')
    .select('*')
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToInvoice);
};

/* Issue a חשבונית מס-קבלה for a ticket. Irreversible — the only undo is a
   credit note. The Edge Function is idempotent per ticket, so a double click
   returns the invoice that already exists rather than issuing two. */
export const issueInvoice = async (ticketKey: string): Promise<Invoice> => {
  const { data: t, error: tErr } = await getClient()
    .from('tickets').select('id').eq('key', ticketKey).single();
  if (tErr) throw tErr;

  const { data, error } = await getClient().functions.invoke('issue-invoice', {
    body: { action: 'issue', ticket_id: t.id },
  });
  if (error) throw await invokeError(error);
  return rowToInvoice(data.invoice);
};

/* Give a customer back part of what they paid — or all of it.
 *
 * There was a `cancelInvoice(id, reason)` beside this, for the all-or-nothing
 * case. It is this call with the amount left at the full remainder — the same
 * request, the same document, the same effect on the original — so keeping both
 * meant two names for one act and two buttons a user had to choose between. The
 * Edge Function still answers `action: 'cancel'` for anything not yet
 * redeployed; nothing here sends it.
 *
 * `amount` is what the CUSTOMER receives: VAT included, the figure on the
 * document in their hand. The server prices the credit line pre-VAT from it,
 * the way every other line on a document is priced.
 *
 * A credit for less than what is outstanding leaves the invoice issued and
 * standing; one for the rest of it cancels the invoice, which is what
 * cancelInvoice above has always been. The server decides which happened —
 * `cancelled` comes back only in the second case — because only it knows what
 * other credits landed in the meantime.
 *
 * Admin only, refused with 403 at the function itself and not merely hidden in
 * the UI: money going back to a customer is the same call as repricing a work.
 */
export const creditInvoice = async (
  invoiceId: string,
  amount: number,
  reason: string,
): Promise<{ note: Invoice; cancelled: boolean; remaining: number }> => {
  const { data, error } = await getClient().functions.invoke('issue-invoice', {
    body: { action: 'credit', invoice_id: invoiceId, amount, reason },
  });
  if (error) throw await invokeError(error);
  return {
    note: rowToInvoice(data.credit_note),
    cancelled: Boolean(data.cancelled),
    remaining: Number(data.remaining ?? 0),
  };
};

/* ---------- what an invoice is still worth ----------

   A credit note is stored as a positive total on its own document — it is a
   second piece of paper, not a negative number on the first. So "what did this
   invoice actually earn" is the invoice minus the notes against it, and every
   figure a garage acts on has to be computed that way or it overstates the
   takings by exactly the amount that was handed back.

   Kept here, next to the row shape, because both the invoices page and the
   ticket page ask it and the answer must not differ between them. */

/** The credit notes issued against an invoice, newest first. */
export const creditNotesFor = (invoice: Invoice, all: readonly Invoice[]): Invoice[] =>
  all.filter((i) => i.docType === 'credit_note' && i.creditsInvoiceId === invoice.id);

/** How much of an invoice has already been given back. */
export const creditedTotal = (invoice: Invoice, all: readonly Invoice[]): number =>
  round2(creditNotesFor(invoice, all).reduce((sum, note) => sum + note.total, 0));

/** What may still be credited: the total, less what already was.
 *
 *  Zero for anything that is not a live invoice-receipt — a credit note cannot
 *  be credited, and a cancelled invoice has nothing left in it. The server
 *  checks this again against the database, which is where it is authoritative;
 *  this is what lets the UI offer a sane maximum and refuse before a round trip. */
export const creditableRemainder = (invoice: Invoice, all: readonly Invoice[]): number => {
  if (invoice.docType !== 'invoice_receipt' || invoice.status !== 'issued') return 0;
  return Math.max(0, round2(invoice.total - creditedTotal(invoice, all)));
};

/** Money is stored to the agora; JS addition is not. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fires `onChange` whenever an invoice is issued or cancelled. */
export const subscribeToInvoices = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-invoices-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
