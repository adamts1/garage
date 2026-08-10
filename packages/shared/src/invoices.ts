/* Invoices — stored, immutable legal documents.

   Unlike tickets, the app never writes an invoice row directly: issuing a tax
   document means having the provider (iCount) allocate its legal number, which
   only the issue-invoice Edge Function may do (it holds the garage's provider
   token, which no client can read). So this module has exactly two mutating
   calls — issue and cancel — and both are Edge Function invocations. Reads come
   straight from the invoices table, which RLS scopes to the caller's garage.

   See docs/PRODUCTION.md §4a and migration 20260727000000_invoices.sql. */

import { getClient, invokeError } from './client';

/* Four documents, two of which are bills.
 *
 *   invoice_receipt  חשבונית מס-קבלה — billed and paid at once
 *   tax_invoice      חשבונית מס      — billed, to be paid later
 *   receipt          קבלה            — money arriving against a tax_invoice
 *   credit_note      חשבונית זיכוי   — a correction to either bill
 */
export type InvoiceDocType = 'invoice_receipt' | 'tax_invoice' | 'receipt' | 'credit_note';
export type InvoiceStatus = 'issued' | 'cancelled';

/** The two documents that bill a ticket. A receipt and a credit note are both
 *  written against one of these, never on their own. */
export type BillDocType = 'invoice_receipt' | 'tax_invoice';

export const isBill = (i: Invoice): boolean =>
  i.docType === 'invoice_receipt' || i.docType === 'tax_invoice';

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
  /** On a receipt: the tax invoice it settles. One invoice may have several,
   *  because a customer may pay in instalments. NULL on everything else. */
  paysInvoiceId: string | null;
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
  paysInvoiceId: r.pays_invoice_id ?? null,
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
export const issueInvoice = async (
  ticketKey: string,
  docType: BillDocType = 'invoice_receipt',
): Promise<Invoice> => {
  const { data: t, error: tErr } = await getClient()
    .from('tickets').select('id').eq('key', ticketKey).single();
  if (tErr) throw tErr;

  const { data, error } = await getClient().functions.invoke('issue-invoice', {
    body: { action: 'issue', ticket_id: t.id, doc_type: docType },
  });
  if (error) throw await invokeError(error);
  return rowToInvoice(data.invoice);
};

/* Record money arriving against a חשבונית מס, as a קבלה of its own.
 *
 * `amount` is what the customer paid, VAT included — a receipt records a sum
 * that arrived, it does not price anything. Absent, it is everything still
 * owed, which is how most bills are settled.
 *
 * The invoice is not edited: an issued document never is. What is still owed is
 * the bill less the receipts and credits against it, so this only ever inserts.
 */
export const collectInvoice = async (
  invoiceId: string,
  amount?: number,
  payMethod?: string,
  reference?: string,
): Promise<{ receipt: Invoice; owed: number }> => {
  const { data, error } = await getClient().functions.invoke('issue-invoice', {
    body: { action: 'collect', invoice_id: invoiceId, amount, pay_method: payMethod, reference },
  });
  if (error) throw await invokeError(error);
  return { receipt: rowToInvoice(data.receipt), owed: Number(data.owed ?? 0) };
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
  if (!isBill(invoice) || invoice.status !== 'issued') return 0;
  return Math.max(0, round2(invoice.total - creditedTotal(invoice, all)));
};

/* ---------- what an invoice is still owed ----------

   The mirror of the credit arithmetic above, and separate from it on purpose:
   money handed back and money never collected are different facts about a bill,
   and a garage acts on them differently. One is a refund it made; the other is a
   debt somebody owes it.

   A מס-קבלה was paid the moment it was issued, so it is never owed anything —
   which is why every function here answers zero for one. */

/** The receipts issued against a tax invoice, newest first. */
export const receiptsFor = (invoice: Invoice, all: readonly Invoice[]): Invoice[] =>
  all.filter((i) => i.docType === 'receipt' && i.paysInvoiceId === invoice.id);

/** How much of a tax invoice has been collected. */
export const paidTotal = (invoice: Invoice, all: readonly Invoice[]): number =>
  round2(receiptsFor(invoice, all).reduce((sum, r) => sum + r.total, 0));

/** What the customer still owes on a bill: its total, less what was collected,
 *  less what was credited. Zero for anything that is not a live tax invoice.
 *
 *  Credits come off because money written off is not money owed — an invoice for
 *  ₪1,000 with ₪200 credited is settled by ₪800, and a report that says
 *  otherwise sends somebody chasing a debt that does not exist. */
export const owedRemainder = (invoice: Invoice, all: readonly Invoice[]): number => {
  if (invoice.docType !== 'tax_invoice' || invoice.status !== 'issued') return 0;
  return Math.max(0, round2(invoice.total - paidTotal(invoice, all) - creditedTotal(invoice, all)));
};

/* ---------- what a credit note can actually be issued for ----------

   Every line on every document is priced BEFORE VAT, and the provider adds the
   VAT itself. So the gross a customer sees is never chosen directly: it is
   whatever `subtotal + round(subtotal × rate)` lands on, and at 18% the reachable
   grosses step in jumps of one or two agorot with gaps between them.

   ₪100.00 is one of the gaps. Divide it out and you get ₪84.75, whose VAT rounds
   to ₪15.26 and whose gross is ₪100.01 — a document for an agora more than was
   agreed. ₪84.74 undershoots to ₪99.99. Nothing prices to exactly ₪100.00.

   Storing ₪100.00 while the provider prints ₪100.01 is the worse answer: the
   ledger and the document in the customer's hand disagree, and every sum built
   on the row is wrong by the difference. So the amount is snapped to a gross
   that can actually be issued, and the dialog shows the advisor which one before
   they confirm.

   Ties go to the lower amount, and `cap` is never exceeded: an agora too little
   back is a rounding artefact, an agora too much is money the garage did not
   agree to return — and, on a last credit, a sum of notes larger than the
   invoice they credit. */

export interface CreditAmounts {
  /** Pre-VAT, the figure the provider is given. */
  subtotal: number;
  vat: number;
  /** What the customer gets back, and what the document will say. */
  total: number;
}

/** The issuable credit closest to `requested`, never above `cap`, or null when
 *  nothing at or below the cap is worth issuing.
 *
 *  Mirrored in supabase/functions/issue-invoice, which is authoritative — it
 *  re-derives this from the stored invoice rather than trusting the amount a
 *  client sends. This copy exists so the dialog can name the real figure instead
 *  of one the server will quietly change. */
export const issuableCredit = (
  requested: number,
  vatRate: number,
  cap: number,
): CreditAmounts | null => {
  const start = round2(requested / (1 + vatRate));
  let best: CreditAmounts | null = null;

  /* Two agorot either side of the naive answer is more than enough room: one
     step of subtotal moves the gross by about 1.18 agorot, so the bracket
     around any reachable gross is at most a step wide. Ascending, so an equal
     distance never displaces the lower total already held. */
  for (let step = -2; step <= 2; step++) {
    const subtotal = round2(start + step / 100);
    if (subtotal <= 0) continue;
    const vat = round2(subtotal * vatRate);
    const total = round2(subtotal + vat);
    if (total <= 0 || total > cap) continue;
    if (!best || Math.abs(total - requested) < Math.abs(best.total - requested) - 1e-9) {
      best = { subtotal, vat, total };
    }
  }
  return best;
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
