// card-payment — takes a card payment through the garage's clearing provider.
//
//   start  { ticket_id, amount, installments?, return_origin, claimed?, force? }
//          → { payment, url } — a hosted page opened for this amount; or
//          → { payment, url: null, recovered: true } — the customer already
//            paid on an earlier attempt that no document shows yet: that
//            payment, and no new charge.
//          Refused when the amount is above what the ticket still owes, and
//          (409 payment_open) while an earlier page may still be completed,
//          unless `force`.
//   verify { payment_id }                         → { payment }
//          Asks the provider what happened and records the verdict.
//
// Provider-agnostic: it picks the garage's adapter from PAYMENT_ADAPTERS and
// speaks only the PaymentProvider interface. A new clearing provider is a new
// folder in _shared/payments/ plus one line below.
//
// The browser is never believed. The hosted page sends it back to
// /pay-return.html, which only tells the screen "go and ask"; the screen calls
// verify, and verify asks the provider. A payment is 'paid' only when the
// provider's record says so, validated and for exactly the amount we asked for.
// No verdict → 'pending', never 'declined' (see the migration's header).
//
// Authorization is RLS: the ticket and the payment are read through the
// caller's JWT, so a session only ever reaches its own garage's rows. The
// service_role client reads the credentials and writes card_payments, which no
// client may write.
//
// Card numbers never pass through here: the customer types them on the
// provider's page, or taps the provider's terminal.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { garageProvider, PaymentsSuspended, tripOnAuth } from '../_shared/payments/registry.ts';
import type { Verdict } from '../_shared/payments/provider.ts';
import { priceTicket, round2, type Work } from '../_shared/billing.ts';

// The provider registry lives in _shared/payments/registry.ts, shared with
// issue-invoice (which refunds through it when it credits).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* What a client may see of a payment — the same columns its grant allows. */
const PUBLIC_COLUMNS =
  'id, garage_id, ticket_id, invoice_id, provider, mode, purpose, channel, entry, amount, installments, status, provider_tx_id, approval_number, card_last4, card_brand, card_type, message, created_at, updated_at, settled_at';

/* A sanity bound, not a business rule: no garage bill is a million shekels,
   and a typo that adds three zeros should be refused before a card sees it. */
const MAX_AMOUNT = 1_000_000;

/* How far the screen's total and the bill's may differ: VAT rounded with the
   total on screen, before it in the bill. Same tolerance issue-invoice allows. */
const ROUNDING = 0.02;

/* A hosted page expires within minutes (Pelecard error 0003). An attempt
   younger than this may still be completed, so a new one is not opened on
   top of it without the advisor saying so. */
const PAGE_TTL_MS = 15 * 60_000;
/* Attempts younger than this are asked about again before a new one starts;
   older ones are left as they are, unasked (their pages are long dead). */
const RECHECK_MS = 24 * 60 * 60_000;

/* Where the hosted page may send the browser back to. Comma-separated origins
   (the Netlify site, http://localhost:5173 for development). Without it there
   is nowhere safe to return to, so nothing starts. */
function returnUrl(origin: unknown): string {
  const allowed = (Deno.env.get('PAYMENT_RETURN_ORIGINS') ?? '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (!allowed.length) throw new Error('PAYMENT_RETURN_ORIGINS is not set');
  const o = String(origin ?? '').replace(/\/$/, '');
  if (!allowed.includes(o)) throw new Error(`return origin not allowed: ${o || '(none)'}`);
  return `${o}/pay-return.html`;
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

    const provider = (garageId: string) => garageProvider(admin, garageId);

    type Provider = Awaited<ReturnType<typeof provider>>;

    /* Asks the provider about one attempt and records the answer. Only the
       provider's record moves a row; see the header. */
    // deno-lint-ignore no-explicit-any
    async function settle(p: Provider, pay: any) {
      if (pay.status === 'paid') return pay;
      const direct = pay.channel === 'direct';
      /* A page attempt is looked up by its page; a direct one, which has no
         page, by its own reference in the provider's transactions report. */
      if (!direct && !pay.provider_tx_id) return pay;
      if (direct && !p.adapter.findAttempt) return pay;
      let verdict: Verdict;
      try {
        if (direct) {
          const { data: t } = await admin.from('tickets').select('key').eq('id', pay.ticket_id).maybeSingle();
          verdict = await p.adapter.findAttempt!({
            credentials: p.credentials,
            paymentId: pay.id,
            label: t?.key ?? '',
            amount: Number(pay.amount),
            installments: Number(pay.installments),
            at: pay.created_at,
          });
        } else {
          verdict = await p.adapter.verify({
            credentials: p.credentials,
            paymentId: pay.id,
            amount: Number(pay.amount),
            installments: Number(pay.installments),
            purpose: pay.purpose === 'check' ? 'check' : 'charge',
            providerTxId: pay.provider_tx_id,
            confirmationKey: pay.confirmation_key,
          });
        }
      } catch (e) {
        throw await tripOnAuth(admin, pay.garage_id, e);
      }
      return await record(pay, verdict);
    }

    /* Writes a verdict onto its attempt. Only the provider's answer moves a
       row (see the header): paid is final, declined may still be overturned
       to paid, and no answer changes nothing but the note. */
    // deno-lint-ignore no-explicit-any
    async function record(pay: any, verdict: Verdict) {
      const patch: Record<string, unknown> = { raw: verdict.raw };
      if (verdict.status === 'paid') {
        Object.assign(patch, {
          status: 'paid',
          approval_number: verdict.approvalNumber,
          card_last4: verdict.cardLast4,
          card_brand: verdict.cardBrand,
          card_type: verdict.cardType,
          provider_ref: verdict.providerRef,
          entry: verdict.entry,
          message: null,
          settled_at: new Date().toISOString(),
        });
      } else if (verdict.status === 'declined') {
        Object.assign(patch, { status: 'declined', message: verdict.message, settled_at: new Date().toISOString() });
      } else {
        /* Still pending. A row already read as declined is left declined — a
           lookup that fails now does not un-decide it — but the provider's
           record, read again, may still overturn it to paid above. */
        if (pay.status === 'pending') patch.message = verdict.message;
        if (verdict.raw == null) delete patch.raw;
      }
      const { data, error } = await admin.from('card_payments').update(patch).eq('id', pay.id).select('*').single();
      if (error) throw new Error(error.message);
      return data;
    }

    // deno-lint-ignore no-explicit-any
    const publicOf = (row: any) => Object.fromEntries(PUBLIC_COLUMNS.split(', ').map((k) => [k, row[k]]));

    // ============================ START ============================
    if (action === 'start') {
      const ticketId = body.ticket_id as string;
      if (!ticketId) return json({ error: 'ticket_id required' }, 400);
      let amount = round2(Number(body.amount));
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        return json({ error: 'amount must be a positive sum' }, 400);
      }
      const back = returnUrl(body.return_origin);
      /* At the counter the advisor chooses: the garage's terminal, or the card
         typed on the page. The terminal is offered only where one is set up. */
      const onTerminal = body.mode === 'terminal';
      /* Card payments this visit has already taken and the screen is holding
         for its receipt. Not "lost": they are not handed back below. */
      const claimed = new Set(Array.isArray(body.claimed) ? body.claimed.map(String) : []);

      // Caller's JWT → RLS: their garage's ticket, or nothing.
      const { data: ticket, error: tErr } = await userClient
        .from('tickets')
        .select('id, garage_id, key, final_price, works(name, labor, labor_discount, labor_vat_discount, work_items(name, qty, price, discount, vat_discount))')
        .eq('id', ticketId).maybeSingle();
      if (tErr) return json({ error: tErr.message }, 400);
      if (!ticket) return json({ error: 'ticket not found in your garage' }, 404);

      const p = await provider(ticket.garage_id);

      /* Installments within the garage's own limits — the drawer offers only
         these, and the server holds to them whatever a client sends. */
      const installments = body.installments == null ? 1 : Number(body.installments);
      if (!Number.isInteger(installments) || installments < 1 || installments > p.maxInstallments) {
        return json({ error: `installments must be 1–${p.maxInstallments}` }, 400);
      }
      if (installments > 1 && amount < p.installmentsMinAmount) {
        return json({ error: `installments start at ${p.installmentsMinAmount}` }, 400);
      }

      /* ---- earlier attempts on this ticket, before anything new ----
         A page the advisor walked away from may have been completed a moment
         later, and a charge whose ticket failed to save is money already
         taken. Either way the customer has paid: hand that payment back
         instead of charging the card again. */
      const { data: earlier, error: eErr } = await admin.from('card_payments').select('*')
        .eq('ticket_id', ticket.id).is('invoice_id', null).in('status', ['pending', 'paid'])
        .order('created_at', { ascending: true });
      if (eErr) return json({ error: eErr.message }, 500);
      const settled = [];
      for (const row of earlier ?? []) {
        const fresh = Date.now() - new Date(row.created_at).getTime() < RECHECK_MS;
        settled.push(row.status === 'pending' && fresh ? await settle(p, row) : row);
      }
      const unclaimed = settled.find((r) => r.status === 'paid' && !claimed.has(r.id));
      if (unclaimed) return json({ payment: publicOf(unclaimed), url: null, recovered: true });
      /* Still open: pending, recent, and not abandoned. An abandoned attempt
         was re-checked just above like any other — paid would have been
         handed back — but nobody is still paying on it, so it asks nothing. */
      const open = settled.find((r) => r.status === 'pending' && !r.abandoned_at
        && Date.now() - new Date(r.created_at).getTime() < PAGE_TTL_MS);
      if (open && body.force !== true) {
        return json({ error: 'an earlier payment page on this ticket may still be completed', code: 'payment_open', payment: publicOf(open) }, 409);
      }

      /* ---- what is still owed, computed here and not taken from the screen ---- */
      const { data: bill } = await admin.from('invoices').select('id, doc_type, total')
        .eq('ticket_id', ticket.id).eq('status', 'issued')
        .in('doc_type', ['invoice_receipt', 'tax_invoice']).maybeSingle();
      let owed: number;
      if (bill?.doc_type === 'invoice_receipt') {
        return json({ error: 'this ticket is already billed and paid', code: 'already_paid' }, 409);
      } else if (bill) {
        const [{ data: paid, error: pe }, { data: credited, error: ce }] = await Promise.all([
          userClient.rpc('invoice_paid_total', { invoice: bill.id }),
          userClient.rpc('invoice_credited_total', { invoice: bill.id }),
        ]);
        if (pe || ce) return json({ error: (pe ?? ce)!.message }, 500);
        owed = round2(Number(bill.total) - Number(paid ?? 0) - Number(credited ?? 0));
      } else {
        const { data: cfg } = await admin.from('garage_billing').select('vat_rate').eq('garage_id', ticket.garage_id).maybeSingle();
        const priced = priceTicket(ticket.works as unknown as Work[], ticket.final_price, Number(cfg?.vat_rate ?? 0.18));
        if (typeof priced === 'string') return json({ error: priced }, 400);
        owed = priced.total;
      }
      /* Taken on a card already and not yet on a document — this visit's
         earlier rounds. They count against what a card may still take. */
      const held = round2(settled.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0));
      const remaining = round2(owed - held);
      if (amount > round2(remaining + ROUNDING)) {
        return json({ error: `amount ${amount} is above what is still owed (${remaining})`, code: 'over_owed', remaining }, 400);
      }
      /* The screen and the bill can land an agora apart (VAT rounding). Paying
         the rest is paying the bill's own figure, so the card is charged that —
         never a sum the receipt will then have to disagree with. */
      if (Math.abs(amount - remaining) <= ROUNDING) amount = remaining;
      if (amount <= 0) return json({ error: 'nothing is owed on this ticket', code: 'nothing_owed' }, 409);

      const { data: me } = await userClient.auth.getUser();

      /* The row first, so the provider's record can carry our id from the
         start and a page that was opened is never one we have no row for. */
      const { data: row, error: iErr } = await admin.from('card_payments').insert({
        garage_id: ticket.garage_id,
        ticket_id: ticket.id,
        provider: p.name,
        mode: 'counter',
        amount,
        installments,
        created_by: me?.user?.id ?? null,
      }).select('id').single();
      if (iErr) return json({ error: iErr.message }, 500);

      /* ---- straight to the terminal, no page ----
         Where the garage has a terminal and the provider a direct route. The
         call waits for the customer at the terminal; its answer is the
         verdict. No answer → pending, found later in the provider's report by
         this attempt's own reference — never assumed either way. */
      if (onTerminal && body.via !== 'page' && p.posShopNo && p.adapter.chargeOnTerminal) {
        await admin.from('card_payments').update({ channel: 'direct', entry: 'terminal' }).eq('id', row.id);
        let verdict: Verdict;
        try {
          verdict = await p.adapter.chargeOnTerminal({
            credentials: p.credentials,
            paymentId: row.id,
            amount,
            installments,
            label: ticket.key,
            posShopNo: p.posShopNo,
          });
        } catch (e) {
          // Only a credential rejection is thrown: the provider refused to talk.
          const err = await tripOnAuth(admin, ticket.garage_id, e);
          const message = err instanceof Error ? err.message : String(err);
          await admin.from('card_payments').update({ status: 'declined', message }).eq('id', row.id);
          if (err instanceof PaymentsSuspended) return json({ error: message, code: 'payments_suspended' }, 423);
          return json({ error: message, code: 'terminal_failed' }, 502);
        }
        const { data: fresh } = await admin.from('card_payments').select('*').eq('id', row.id).single();
        const saved = await record(fresh, verdict);
        // deno-lint-ignore no-explicit-any
        const pub = Object.fromEntries(PUBLIC_COLUMNS.split(', ').map((k) => [k, (saved as any)[k]]));
        return json({ payment: pub, url: null, direct: true });
      }

      try {
        const started = await p.adapter.start({
          credentials: p.credentials,
          paymentId: row.id,
          amount,
          installments,
          label: ticket.key,
          returnUrl: back,
          posShopNo: onTerminal ? p.posShopNo : null,
          purpose: 'charge',
        });
        const { data: saved, error: uErr } = await admin.from('card_payments')
          .update({ provider_tx_id: started.providerTxId, confirmation_key: started.confirmationKey })
          .eq('id', row.id).select(PUBLIC_COLUMNS).single();
        if (uErr) throw new Error(uErr.message);
        return json({ payment: saved, url: started.url });
      } catch (e) {
        /* No page was opened (or we cannot hand it out), so nothing can have
           been charged on it: the attempt is closed as declined, with why. */
        const err = await tripOnAuth(admin, ticket.garage_id, e);
        const message = err instanceof Error ? err.message : String(err);
        await admin.from('card_payments').update({ status: 'declined', message }).eq('id', row.id);
        if (err instanceof PaymentsSuspended) return json({ error: message, code: 'payments_suspended' }, 423);
        return json({ error: message, ...(onTerminal ? { code: 'terminal_failed' } : {}) }, 502);
      }
    }

    // ============================ CHECK ============================
    /* Proves the set-up without moving money. Admin only, and each press is
       ONE call to the provider:
         credentials — opens a page and nothing else: the provider's answer
                       says whether it accepts the credentials;
         card        — a page that sends a card check (J2) to the terminal; the
                       customer's card is read and nothing is charged. Then
                       verify as for a payment.
       Either can trip the breaker, which is the point of trying it once,
       carefully, before a real customer is in front of the terminal. */
    if (action === 'check') {
      const { data: isAdmin, error: roleErr } = await userClient.rpc('is_garage_admin');
      if (roleErr) return json({ error: roleErr.message }, 400);
      if (!isAdmin) return json({ error: 'only a garage admin may check the terminal' }, 403);
      const { data: garageId, error: gErr } = await userClient.rpc('current_garage_id');
      if (gErr || !garageId) return json({ error: gErr?.message ?? 'no garage' }, 400);

      const onCard = body.mode === 'card';
      const back = returnUrl(body.return_origin);
      const p = await provider(garageId);
      if (onCard && !p.posShopNo) return json({ error: 'no terminal is set up for this garage', code: 'no_terminal' }, 400);

      const { data: me } = await userClient.auth.getUser();
      const { data: row, error: iErr } = await admin.from('card_payments').insert({
        garage_id: garageId, ticket_id: null, provider: p.name, mode: 'counter',
        purpose: 'check', amount: 1, installments: 1, created_by: me?.user?.id ?? null,
      }).select('id').single();
      if (iErr) return json({ error: iErr.message }, 500);

      try {
        const started = await p.adapter.start({
          credentials: p.credentials, paymentId: row.id, amount: 1, installments: 1,
          label: 'terminal check', returnUrl: back, posShopNo: onCard ? p.posShopNo : null, purpose: 'check',
        });
        if (!onCard) {
          // The page is never shown; it expires by itself. The answer was the point.
          await admin.from('card_payments').update({
            provider_tx_id: started.providerTxId, status: 'declined', message: 'credentials check only — no page shown',
          }).eq('id', row.id);
          return json({ ok: true });
        }
        const { data: saved, error: uErr } = await admin.from('card_payments')
          .update({ provider_tx_id: started.providerTxId, confirmation_key: started.confirmationKey })
          .eq('id', row.id).select(PUBLIC_COLUMNS).single();
        if (uErr) throw new Error(uErr.message);
        return json({ payment: saved, url: started.url });
      } catch (e) {
        const err = await tripOnAuth(admin, garageId, e);
        const message = err instanceof Error ? err.message : String(err);
        await admin.from('card_payments').update({ status: 'declined', message }).eq('id', row.id);
        if (err instanceof PaymentsSuspended) return json({ error: message, code: 'payments_suspended' }, 423);
        return json({ error: message }, 502);
      }
    }

    // ============================ ABANDON ============================
    /* The drawer left this attempt: cancelled on the provider's page, stopped
       by the advisor, or expired. Nothing about the money changes — it stays
       pending and is still checked with the provider before any new charge on
       the ticket. It only stops the "an earlier page may still be paid?"
       question, which the advisor has just answered. */
    if (action === 'abandon') {
      const paymentId = body.payment_id as string;
      if (!paymentId) return json({ error: 'payment_id required' }, 400);
      const { data: mine } = await userClient.from('card_payments').select('id').eq('id', paymentId).maybeSingle();
      if (!mine) return json({ error: 'payment not found in your garage' }, 404);
      const { error } = await admin.from('card_payments')
        .update({ abandoned_at: new Date().toISOString() })
        .eq('id', paymentId).eq('status', 'pending').is('abandoned_at', null);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ============================ VERIFY ============================
    if (action === 'verify') {
      const paymentId = body.payment_id as string;
      if (!paymentId) return json({ error: 'payment_id required' }, 400);

      // RLS read: only a payment of the caller's own garage resolves.
      const { data: mine } = await userClient.from('card_payments').select('id').eq('id', paymentId).maybeSingle();
      if (!mine) return json({ error: 'payment not found in your garage' }, 404);

      const { data: pay, error: pErr } = await admin.from('card_payments').select('*').eq('id', paymentId).single();
      if (pErr) return json({ error: pErr.message }, 500);
      if (pay.status === 'paid' || (pay.channel !== 'direct' && !pay.provider_tx_id)) return json({ payment: publicOf(pay) });

      const p = await provider(pay.garage_id);
      return json({ payment: publicOf(await settle(p, pay)) });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof PaymentsSuspended) return json({ error: e.message, code: 'payments_suspended' }, 423);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
