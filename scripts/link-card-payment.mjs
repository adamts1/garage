#!/usr/bin/env node
/* Tie a card charge to the document that already records it.
 *
 *   npm run link-card-payment -- --payment-id <uuid>                        (show it)
 *   npm run link-card-payment -- --payment-id <uuid> --invoice-id <uuid> --link
 *
 * For charges taken before issue-invoice put unclaimed charges on the next
 * receipt by itself: the receipt failed when the card was charged, and the
 * receipt issued afterwards by hand said only "card" and was never tied to the
 * charge (staging GAR-150, receipt 3103). Such a charge keeps the ticket
 * warning that nothing records it, and the bill cannot be refunded to the card.
 *
 * The document itself is not touched — an issued document never is, and it
 * keeps printing what it printed. This only records which document the money
 * is on, which is what refunds and the warning read. Refused unless the
 * document is this ticket's issued מס-קבלה or קבלה, paid by card, for exactly
 * the charge's sum, with no charge on it already.
 *
 * Loads .env.local (staging); `npm run link-card-payment:prod` for production.
 */

import { createClient } from '@supabase/supabase-js';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1];
  if (v !== undefined && !v.startsWith('--')) { args.set(k, v); i++; } else args.set(k, true);
}
const die = (m) => { console.error(`\x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const project = url.replace(/^https?:\/\//, '').split('.')[0];
const id = args.get('payment-id');
if (!id || id === true) die('Missing --payment-id.');

const db = createClient(url, key, { auth: { persistSession: false } });
const { data: p, error } = await db.from('card_payments')
  .select('id, garage_id, ticket_id, invoice_id, amount, status, purpose, card_last4, approval_number, created_at')
  .eq('id', id).maybeSingle();
if (error) die(error.message);
if (!p) die(`No card payment ${id} in ${project}.`);
const { data: t } = p.ticket_id
  ? await db.from('tickets').select('key').eq('id', p.ticket_id).maybeSingle()
  : { data: null };

console.log(`\nProject   ${project}`);
console.log(`Charge    ${p.id}  ₪${p.amount}  ${p.status}  ****${p.card_last4 ?? '????'}  אישור ${p.approval_number ?? '-'}`);
console.log(`Ticket    ${t?.key ?? '-'}   taken ${p.created_at}`);
console.log(`On doc    ${p.invoice_id ?? '(none)'}`);

const { data: docs } = p.ticket_id
  ? await db.from('invoices').select('id, doc_type, provider_docnum, total, pay_method, payments, status')
    .eq('ticket_id', p.ticket_id).order('created_at')
  : { data: [] };
for (const d of docs ?? []) console.log(`  doc     ${d.id}  #${d.provider_docnum} ${d.doc_type} ₪${d.total} ${d.status} ${d.pay_method ?? (d.payments ? 'several' : '-')}`);

if (!args.get('link')) { console.log('\n(Nothing changed. Pass --invoice-id <uuid> --link to tie it.)\n'); process.exit(0); }

if (p.status !== 'paid' || p.purpose !== 'charge') die('Only a paid charge goes on a document.');
if (p.invoice_id) die('It is already on a document.');
const invoiceId = args.get('invoice-id');
if (!invoiceId || invoiceId === true) die('Missing --invoice-id.');
const d = (docs ?? []).find((x) => x.id === invoiceId);
if (!d) die('That document is not one of this ticket\'s.');
if (d.status !== 'issued') die(`The document is ${d.status}.`);
if (d.doc_type !== 'invoice_receipt' && d.doc_type !== 'receipt') die(`A ${d.doc_type} records no payment.`);
if (d.payments || d.pay_method !== 'card') die('Only a document paid by a single card is tied by hand; anything else, look at it first.');
if (Number(d.total) !== Number(p.amount)) die(`The document is for ₪${d.total}, the charge ₪${p.amount}.`);
const { count } = await db.from('card_payments').select('id', { count: 'exact', head: true }).eq('invoice_id', d.id);
if (count) die('Another charge is already on that document.');

const { error: uErr } = await db.from('card_payments').update({ invoice_id: d.id }).eq('id', p.id).is('invoice_id', null);
if (uErr) die(uErr.message);
console.log(`\n\x1b[32m✓\x1b[0m charge tied to #${d.provider_docnum}\n`);
