/* Invoices — stored, immutable legal documents.

   Unlike tickets, the app never writes an invoice row directly: issuing a tax
   document means having the provider (iCount) allocate its legal number, which
   only the issue-invoice Edge Function may do (it holds the garage's provider
   token, which no client can read). So this module has exactly two mutating
   calls — issue and cancel — and both are Edge Function invocations. Reads come
   straight from the invoices table, which RLS scopes to the caller's garage.

   See docs/PRODUCTION.md §4a and migration 20260727000000_invoices.sql. */

import { getClient } from './client';

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

/* An Edge Function returns a non-2xx with a JSON `{error}` body on failure;
   supabase-js surfaces that as a FunctionsHttpError whose real message is in
   error.context. Dig it out so the UI shows "invoicing not configured" rather
   than a generic "Edge Function returned a non-2xx status code". */
const invokeError = async (error: any): Promise<Error> => {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch { /* fall through to the generic message */ }
  return new Error(error?.message ?? 'invoice request failed');
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

/* Cancel an issued invoice by issuing a linked credit note. Returns the credit
   note; the original becomes status 'cancelled'. */
export const cancelInvoice = async (invoiceId: string, reason: string): Promise<Invoice> => {
  const { data, error } = await getClient().functions.invoke('issue-invoice', {
    body: { action: 'cancel', invoice_id: invoiceId, reason },
  });
  if (error) throw await invokeError(error);
  return rowToInvoice(data.credit_note);
};

/** Fires `onChange` whenever an invoice is issued or cancelled. */
export const subscribeToInvoices = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-invoices-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
