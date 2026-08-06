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

/* A line is priced BEFORE VAT and the provider adds the VAT, so the gross a
   customer sees is never chosen directly — it is whatever subtotal + round(
   subtotal × rate) lands on. At 18% those grosses step in jumps with gaps
   between them, and ₪100.00 is a gap: ₪84.75 grosses to ₪100.01, ₪84.74 to
   ₪99.99, and nothing prices to ₪100.00 exactly.

   Storing the amount asked for while the provider prints another is the one
   outcome worth ruling out — the row and the document would disagree, and every
   sum built on the row would be wrong by the difference. So a credit is snapped
   to a gross that can actually be issued: closest to what was asked, ties to
   the lower, and never above `cap`. An agora short is a rounding artefact; an
   agora over is money the garage did not agree to hand back, and on a final
   credit it is a sum of notes larger than the invoice they credit.

   Mirrored in packages/shared/src/invoices.ts so the dialog can name the real
   figure. This copy is the authoritative one: it works from the stored invoice,
   not from an amount a client sent. */
function issuableCredit(requested: number, vatRate: number, cap: number):
  { subtotal: number; vat: number; total: number } | null {
  const start = round2(requested / (1 + vatRate));
  let best: { subtotal: number; vat: number; total: number } | null = null;
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
}

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

    /* ======================= CANCEL / CREDIT =======================

       One path, because they are one act: giving money back with a document
       that says so. 'cancel' is 'credit' for the whole remaining amount, and
       is kept as its own action so older clients keep working.

       A credit for part of the bill leaves the original ISSUED — it corrects
       the invoice, it does not void it — and several may be issued against one
       invoice over time. A credit that takes the last of what is still owed
       back voids it, which is the case 'cancel' always was. */
    if (action === 'cancel' || action === 'credit') {
      const invoiceId = body.invoice_id as string;
      const reason = (body.reason as string) || 'ביטול חשבונית';
      if (!invoiceId) return json({ error: 'invoice_id required' }, 400);

      /* Money going back to a customer is an admin's call — the same line the
         database draws around repricing a work (save_ticket_works). Checked
         here rather than in the UI alone: this function is a URL, and a member
         who can read their own JWT can call it.

         is_garage_admin() runs under the caller's JWT, so it answers for the
         garage they are actually in. */
      const { data: isAdmin, error: roleErr } = await userClient.rpc('is_garage_admin');
      if (roleErr) return json({ error: roleErr.message }, 400);
      if (!isAdmin) return json({ error: 'only a garage admin may credit a customer' }, 403);

      // Caller's JWT -> RLS: they can only credit their own garage's invoice.
      const { data: inv, error: rErr } = await userClient.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
      if (rErr) return json({ error: rErr.message }, 400);
      if (!inv) return json({ error: 'invoice not found in your garage' }, 404);
      if (inv.status === 'cancelled') return json({ error: 'invoice is already cancelled' }, 409);
      if (inv.doc_type !== 'invoice_receipt') return json({ error: 'only an invoice-receipt can be credited' }, 400);

      /* What is still creditable, asked of the database rather than computed
         from what the client is holding: two advisors crediting the same
         invoice at once must not between them hand back more than was paid. */
      const { data: creditedSoFar, error: cErr } = await userClient.rpc('invoice_credited_total', { invoice: inv.id });
      if (cErr) return json({ error: cErr.message }, 400);
      const remaining = round2(Number(inv.total) - Number(creditedSoFar ?? 0));
      if (remaining <= 0) return json({ error: 'this invoice has already been credited in full' }, 409);

      /* The amount is what the CUSTOMER gets back — VAT included, the figure on
         the document they are holding. Absent (or 'cancel'), it is everything
         still outstanding. */
      const requested = action === 'cancel' || body.amount == null ? remaining : round2(Number(body.amount));
      if (!Number.isFinite(requested) || requested <= 0) return json({ error: 'amount must be a positive number' }, 400);
      if (requested > remaining) {
        return json({ error: `amount exceeds what is left to credit on this invoice (${remaining})`, remaining }, 400);
      }

      const full = requested >= remaining;
      const { adapter, credentials } = await billing(inv.garage_id);
      const vatRate = Number(inv.vat_rate);

      /* A full credit of an untouched invoice copies its own lines, so the two
         documents are the same money written twice — no rounding to argue
         about later. Anything else is one line for the amount agreed, with the
         reason on it, priced pre-VAT the way every other line is: the provider
         adds VAT, and what the customer gets back is the gross typed in. */
      const untouched = full && Number(creditedSoFar ?? 0) === 0;
      const priced = untouched
        ? { subtotal: Number(inv.subtotal), vat: Number(inv.vat), total: Number(inv.total) }
        : issuableCredit(requested, vatRate, remaining);
      if (!priced) return json({ error: 'no credit can be issued for that amount' }, 400);
      const { subtotal, vat, total } = priced;

      const items: InvoiceItem[] = untouched
        ? (inv.lines as Array<{ desc: string; qty: number; unit_price: number }>).map((l) => ({
            description: l.desc, unitprice: l.unit_price, quantity: l.qty,
          }))
        : [{ description: reason ? `זיכוי — ${reason}` : 'זיכוי', unitprice: subtotal, quantity: 1 }];

      const doc = await adapter.cancel({
        credentials,
        customer: { name: inv.customer_name || 'לקוח', idNo: inv.customer_id_number || undefined },
        items,
        reason,
        basedOnDocnum: inv.provider_docnum,
      });

      // Store the credit note as its own immutable row, naming what it credits...
      const { data: note, error: nErr } = await admin.from('invoices').insert({
        garage_id: inv.garage_id,
        ticket_id: inv.ticket_id,
        ticket_key: inv.ticket_key,
        doc_type: 'credit_note',
        credits_invoice_id: inv.id,
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
        lines: items.map((i) => ({ desc: i.description, qty: i.quantity, unit_price: i.unitprice, line_total: round2(i.unitprice * i.quantity) })),
        subtotal,
        vat_rate: vatRate,
        vat,
        total,
        status: 'issued',
      }).select().single();
      if (nErr) return json({ error: `credit note issued at provider (docnum ${doc.docnum}) but not stored: ${nErr.message}` }, 500);

      /* A partial credit ends here: the original is still a live invoice for
         what the customer keeps owing us, or kept paying. Only a credit that
         takes the last of it voids the document — and that is the one update
         the immutability trigger permits. */
      if (!full) return json({ credit_note: note, credited: total, remaining: round2(remaining - total) });

      const { data: cancelled, error: uErr } = await admin.from('invoices')
        .update({ status: 'cancelled', cancelled_by: note.id })
        .eq('id', inv.id).select().single();
      if (uErr) return json({ error: `credit note stored but original not marked cancelled: ${uErr.message}` }, 500);

      return json({ credit_note: note, cancelled, credited: total, remaining: 0 });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
