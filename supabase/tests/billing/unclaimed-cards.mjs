#!/usr/bin/env node
/* issue-invoice end to end: a card charged with no document behind it (the
 * receipt failed when the money was taken) is on the next receipt for the
 * ticket, and nothing records that visit's money without it. Local only.
 *
 *   npx supabase start
 *   node supabase/tests/billing/fake-icount.mjs &
 *   echo 'ICOUNT_BASE_URL=http://host.docker.internal:8787/api/v3.php' > /tmp/billing.env
 *   npx supabase functions serve issue-invoice --env-file /tmp/billing.env &
 *   SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/billing/unclaimed-cards.mjs
 *
 * The charges are written straight into card_payments as the card-payment
 * function would have left them: paid, on no document. Against the function
 * before this check, U1 issued a receipt that said only "card" and left the
 * charge unlinked (staging GAR-150, receipt 3103), and U3/U5 recorded the same
 * visit's money twice. */
import { createClient } from '@supabase/supabase-js';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Refusing to run against ${API}: this test creates garages and documents. Local only.`);
  process.exit(1);
}
if (!SERVICE || !ANON) { console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (npx supabase status).'); process.exit(1); }
const FAKE = 'http://127.0.0.1:8787';
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`); if (!ok) failures++; };
const reset = () => fetch(`${FAKE}/__mode`, { method: 'POST', body: JSON.stringify({ mode: 'ok' }) });
const creates = async () => (await fetch(`${FAKE}/__creates`)).json();
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---- setup: a garage, its admin, invoicing connected ----
const email = `e2e-u-${Date.now()}@test.local`, password = 'e2e-password-123';
const user = must(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
const garage = must(await admin.from('garages').insert({ name: 'E2E unclaimed' }).select().single());
must(await admin.from('garage_members').insert({ garage_id: garage.id, user_id: user.id, role: 'admin' }));
must(await admin.from('garage_billing').insert({ garage_id: garage.id, provider: 'icount', active: true }));
must(await admin.from('garage_billing_secrets').insert({ garage_id: garage.id, credentials: { cid: 'x', token: 'y' } }));
const me = createClient(API, ANON, { auth: { persistSession: false } });
must(await me.auth.signInWithPassword({ email, password }));

let n = 0;
/** A ticket of 100 pre-VAT: 118 to pay. Paid by card, as the close drawer saves it. */
const newTicket = async () => {
  const t = must(await admin.from('tickets').insert({
    garage_id: garage.id, key: `GAR-U${++n}`, title: 't', customer_name: 'לקוח', pay_method: 'card',
  }).select().single());
  must(await admin.from('works').insert({ ticket_id: t.id, uid: 'w1', name: 'עבודה', labor: 100 }));
  return t;
};
/** A card the provider charged for the ticket, on no document. */
const charge = async (ticketId, amount, over = {}) => must(await admin.from('card_payments').insert({
  garage_id: garage.id, ticket_id: ticketId, provider: 'pelecard', amount, status: 'paid',
  approval_number: '5310153', card_last4: '0772', card_type: 'mastercard', ...over,
}).select().single());
const call = async (body) => {
  const { data, error } = await me.functions.invoke('issue-invoice', { body });
  if (!error) return { status: 200, data };
  const res = error.context; let b = null; try { b = await res.json(); } catch { /* not json */ }
  return { status: res?.status ?? 0, data: b };
};
const cardRow = async (id) => must(await admin.from('card_payments').select('invoice_id').eq('id', id).single());
const openAttempts = async (target) => (must(await admin.from('billing_attempts').select('state').eq('target_id', target)))
  .filter((a) => a.state === 'pending' || a.state === 'unknown' || a.state === 'orphaned').length;

// U1. The receipt failed; "issue" with no list → the charge is the payment.
{
  const t = await newTicket(); const c = await charge(t.id, 118); await reset();
  const r = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt' });
  const [doc] = await creates();
  check('U1 issue, no list, card covers the bill: issued', r.status === 200, `${r.status} ${r.data?.error ?? ''}`);
  check('U1 … iCount was sent the card: last 4 and approval', doc?.cc?.card_number === '0772' && doc?.cc?.confirmation_code === '5310153', JSON.stringify(doc?.cc));
  check('U1 … the charge is tied to the receipt', (await cardRow(c.id)).invoice_id === r.data?.invoice?.id);
  check('U1 … the stored receipt names the charge', r.data?.invoice?.payments?.[0]?.card_payment_id === c.id, JSON.stringify(r.data?.invoice?.payments));
}

// U2. The card paid part of it; "issue" with no list → asked, never guessed.
{
  const t = await newTicket(); const c = await charge(t.id, 50); await reset();
  const r = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt' });
  check('U2 issue, no list, card paid part: refused card_unclaimed', r.status === 409 && r.data?.code === 'card_unclaimed', `${r.status} ${JSON.stringify(r.data)}`);
  check('U2 … says how much was charged', r.data?.charged?.[0]?.amount === 50 && r.data?.charged?.[0]?.card_payment_id === c.id);
  check('U2 … nothing created, the ticket is free again', (await creates()).length === 0 && await openAttempts(t.id) === 0);

  const ok = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt', payments: [
    { method: 'card', amount: 50, card_payment_id: c.id }, { method: 'cash', amount: 68 },
  ] });
  check('U2 … with the rest named: issued, card tied', ok.status === 200 && (await cardRow(c.id)).invoice_id === ok.data?.invoice?.id, `${ok.status} ${ok.data?.error ?? ''}`);
}

// U3. A list that leaves the charge off → the visit's money twice. Refused.
{
  const t = await newTicket(); await charge(t.id, 50); await reset();
  const r = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt', payments: [{ method: 'cash', amount: 118 }] });
  check('U3 issue listing cash only while a card paid: refused', r.status === 409 && r.data?.code === 'card_unclaimed', `${r.status} ${r.data?.error}`);
  check('U3 … nothing created', (await creates()).length === 0);
}

// U4. A tax invoice records no payment; its receipt then carries the charge.
{
  const t = await newTicket(); const c = await charge(t.id, 50); await reset();
  const bill = await call({ action: 'issue', ticket_id: t.id, doc_type: 'tax_invoice' });
  check('U4 tax invoice issued, charge left for its receipt', bill.status === 200 && (await cardRow(c.id)).invoice_id === null, `${bill.status} ${bill.data?.error ?? ''}`);
  await reset();
  const col = await call({ action: 'collect', invoice_id: bill.data.invoice.id });
  const [doc] = await creates();
  check('U4 … collect with no list: a receipt for exactly the charge', col.status === 200 && col.data?.collected === 50 && col.data?.owed === 68, `${col.status} ${JSON.stringify(col.data?.error ?? col.data?.collected)}`);
  check('U4 … with the card on it, tied', doc?.cc?.card_number === '0772' && (await cardRow(c.id)).invoice_id === col.data?.receipt?.id);
}

// U5. Collecting the whole bill in cash while a card already paid part → refused.
{
  const t = await newTicket(); await reset();
  const bill = await call({ action: 'issue', ticket_id: t.id, doc_type: 'tax_invoice' });
  await charge(t.id, 50); await reset();
  const r = await call({ action: 'collect', invoice_id: bill.data.invoice.id, amount: 118, payments: [{ method: 'cash', amount: 118 }] });
  check('U5 collect cash only while a card paid: refused', r.status === 409 && r.data?.code === 'card_unclaimed', `${r.status} ${r.data?.error}`);
  const r2 = await call({ action: 'collect', invoice_id: bill.data.invoice.id, amount: 30 });
  check('U5 … a bare amount other than the charge: refused', r2.status === 409 && r2.data?.code === 'card_unclaimed', `${r2.status} ${r2.data?.error}`);
  check('U5 … nothing created', (await creates()).length === 0);
}

// U6. Only this ticket's own paid charges: never another's, or a decline. (A
//     terminal check carries no ticket — the database refuses one that does.)
{
  const other = await newTicket(); const theirs = await charge(other.id, 118);
  const t = await newTicket();
  await charge(t.id, 118, { status: 'declined' });
  await reset();
  const r = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt' });
  const [doc] = await creates();
  check('U6 issue with only others\' charges around: the ordinary receipt', r.status === 200 && !r.data?.invoice?.payments, `${r.status} ${r.data?.error ?? ''} ${JSON.stringify(r.data?.invoice?.payments)}`);
  check('U6 … no card details printed', !doc?.cc?.card_number, JSON.stringify(doc?.cc));
  check('U6 … the other ticket\'s charge untouched', (await cardRow(theirs.id)).invoice_id === null);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
