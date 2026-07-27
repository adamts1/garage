// issue-invoice — the only path that turns a billed ticket into a real tax
// document. It runs server-side for two reasons the client cannot satisfy:
//
//   * the provider credentials live in garage_billing_secrets, which no client
//     may read;
//   * an invoice must be computed from the ticket's OWN works, not from numbers a
//     client hands us — otherwise a client could bill any amount it liked.
//
// It is provider-agnostic: it picks the garage's provider adapter from a registry
// and speaks only the InvoiceProvider interface. Adding a provider is a new
// adapter module plus one line in ADAPTERS — nothing else here changes.
//
// Authorization is RLS, not a role check: we read the ticket (and later the
// invoice) through the CALLER'S JWT, so they can only ever act on their own
// garage's rows. The privileged service_role client is used only to read the
// credentials and to write the invoices row (which authenticated cannot insert).
//
// Issuing a tax document is effectively irreversible — the only undo is a credit
// note. So issue is idempotent per ticket: a second call returns the invoice that
// already exists rather than issuing a duplicate.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { icountAdapter } from '../_shared/icount.ts';
import type { InvoiceProvider, InvoiceItem, ProviderCredentials } from '../_shared/provider.ts';

// The provider registry. One entry per supported accounting service.
const ADAPTERS: Record<string, InvoiceProvider> = {
  icount: icountAdapter,
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface WorkItem { name: string; qty: number; price: number }
interface Work { name: string; labor: number; work_items: WorkItem[] }

/** Build invoice lines from the ticket's OWN works: one line per work's labour,
 *  one per part. Prices are pre-VAT (as stored). Returns lines + pre-VAT subtotal. */
function linesFromWorks(works: Work[]): { items: InvoiceItem[]; subtotal: number } {
  const items: InvoiceItem[] = [];
  for (const w of works ?? []) {
    if (Number(w.labor) > 0) {
      items.push({ description: w.name || 'עבודה', unitprice: Number(w.labor), quantity: 1 });
    }
    for (const p of w.work_items ?? []) {
      if (Number(p.price) !== 0) {
        items.push({ description: p.name || 'חלק', unitprice: Number(p.price), quantity: Number(p.qty) || 1 });
      }
    }
  }
  const subtotal = items.reduce((s, i) => s + i.unitprice * i.quantity, 0);
  return { items, subtotal };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ---- a garage's provider + credentials, service_role only ----
    async function billing(garageId: string): Promise<{ provider: string; adapter: InvoiceProvider; credentials: ProviderCredentials; vatRate: number }> {
      const { data: cfg } = await admin.from('garage_billing').select('*').eq('garage_id', garageId).maybeSingle();
      if (!cfg || !cfg.active) throw new Error('invoicing is not configured for this garage');
      const adapter = ADAPTERS[cfg.provider];
      if (!adapter) throw new Error(`unknown invoicing provider: ${cfg.provider}`);
      const { data: sec } = await admin.from('garage_billing_secrets').select('credentials').eq('garage_id', garageId).maybeSingle();
      if (!sec?.credentials) throw new Error('invoicing credentials missing for this garage');
      return { provider: cfg.provider, adapter, credentials: sec.credentials as ProviderCredentials, vatRate: Number(cfg.vat_rate) };
    }

    // ============================ ISSUE ============================
    if (action === 'issue') {
      const ticketId = body.ticket_id as string;
      if (!ticketId) return json({ error: 'ticket_id required' }, 400);

      // Caller's JWT -> RLS guarantees this is their garage's ticket, or nothing.
      const { data: ticket, error: tErr } = await userClient
        .from('tickets')
        .select('id, garage_id, key, customer_name, id_number, address, phone, pay_method, reference, works(name, labor, work_items(name, qty, price))')
        .eq('id', ticketId)
        .maybeSingle();
      if (tErr) return json({ error: tErr.message }, 400);
      if (!ticket) return json({ error: 'ticket not found in your garage' }, 404);

      // Idempotent: if this ticket already has a live invoice, return it.
      const { data: existing } = await admin
        .from('invoices').select('*')
        .eq('ticket_id', ticketId).eq('doc_type', 'invoice_receipt').eq('status', 'issued')
        .maybeSingle();
      if (existing) return json({ invoice: existing, reused: true });

      const { provider, adapter, credentials, vatRate } = await billing(ticket.garage_id);

      const { items, subtotal } = linesFromWorks(ticket.works as unknown as Work[]);
      if (items.length === 0) return json({ error: 'nothing to invoice — the ticket has no priced works' }, 400);
      const vat = round2(subtotal * vatRate);
      const total = round2(subtotal + vat);

      const doc = await adapter.issue({
        credentials,
        customer: { name: ticket.customer_name || 'לקוח', idNo: ticket.id_number || undefined, address: ticket.address || undefined },
        items,
        payMethod: ticket.pay_method,
        total,
      });

      const row = {
        garage_id: ticket.garage_id,
        ticket_id: ticket.id,
        ticket_key: ticket.key,
        doc_type: 'invoice_receipt',
        provider,
        provider_docnum: doc.docnum,
        allocation_number: doc.allocationNumber,
        provider_doc_id: doc.docId,
        pdf_url: doc.pdfUrl,
        issued_at: doc.issueDate ? new Date(doc.issueDate).toISOString() : new Date().toISOString(),
        customer_name: ticket.customer_name,
        customer_id_number: ticket.id_number,
        customer_address: ticket.address,
        customer_phone: ticket.phone,
        lines: items.map((i) => ({ desc: i.description, qty: i.quantity, unit_price: i.unitprice, line_total: round2(i.unitprice * i.quantity) })),
        subtotal,
        vat_rate: vatRate,
        vat,
        total,
        pay_method: ticket.pay_method,
        pay_reference: ticket.reference,
        status: 'issued',
      };
      const { data: inserted, error: iErr } = await admin.from('invoices').insert(row).select().single();
      if (iErr) return json({ error: `invoice issued at provider (docnum ${doc.docnum}) but not stored: ${iErr.message}` }, 500);
      return json({ invoice: inserted });
    }

    // ============================ CANCEL ============================
    if (action === 'cancel') {
      const invoiceId = body.invoice_id as string;
      const reason = (body.reason as string) || 'ביטול חשבונית';
      if (!invoiceId) return json({ error: 'invoice_id required' }, 400);

      // Caller's JWT -> RLS: they can only cancel their own garage's invoice.
      const { data: inv, error: rErr } = await userClient.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
      if (rErr) return json({ error: rErr.message }, 400);
      if (!inv) return json({ error: 'invoice not found in your garage' }, 404);
      if (inv.status === 'cancelled') return json({ error: 'invoice is already cancelled' }, 409);
      if (inv.doc_type !== 'invoice_receipt') return json({ error: 'only an invoice-receipt can be cancelled' }, 400);

      const { adapter, credentials } = await billing(inv.garage_id);

      const items: InvoiceItem[] = (inv.lines as Array<{ desc: string; qty: number; unit_price: number }>).map((l) => ({
        description: l.desc, unitprice: l.unit_price, quantity: l.qty,
      }));

      const doc = await adapter.cancel({
        credentials,
        customer: { name: inv.customer_name || 'לקוח', idNo: inv.customer_id_number || undefined },
        items,
        reason,
        basedOnDocnum: inv.provider_docnum,
      });

      // Store the credit note as its own immutable row...
      const { data: note, error: nErr } = await admin.from('invoices').insert({
        garage_id: inv.garage_id,
        ticket_id: inv.ticket_id,
        ticket_key: inv.ticket_key,
        doc_type: 'credit_note',
        provider: inv.provider,
        provider_docnum: doc.docnum,
        allocation_number: doc.allocationNumber,
        provider_doc_id: doc.docId,
        pdf_url: doc.pdfUrl,
        issued_at: doc.issueDate ? new Date(doc.issueDate).toISOString() : new Date().toISOString(),
        customer_name: inv.customer_name,
        customer_id_number: inv.customer_id_number,
        customer_address: inv.customer_address,
        customer_phone: inv.customer_phone,
        lines: inv.lines,
        subtotal: inv.subtotal,
        vat_rate: inv.vat_rate,
        vat: inv.vat,
        total: inv.total,
        status: 'issued',
      }).select().single();
      if (nErr) return json({ error: `credit note issued at provider (docnum ${doc.docnum}) but not stored: ${nErr.message}` }, 500);

      // ...then mark the original cancelled and link it. The immutability trigger
      // permits exactly this one transition.
      const { data: cancelled, error: uErr } = await admin.from('invoices')
        .update({ status: 'cancelled', cancelled_by: note.id })
        .eq('id', inv.id).select().single();
      if (uErr) return json({ error: `credit note stored but original not marked cancelled: ${uErr.message}` }, 500);

      return json({ credit_note: note, cancelled });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
