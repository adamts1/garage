#!/usr/bin/env node
/* Settle a card refund that has no clear answer.
 *
 *   npm run resolve-card-refund -- --refund-id <uuid>                      (show it)
 *   npm run resolve-card-refund -- --refund-id <uuid> --as refunded [--provider-refund-id <id>]
 *   npm run resolve-card-refund -- --refund-id <uuid> --as failed
 *
 * A refund whose answer never came back (a timeout, a dropped connection) is
 * stored as 'unknown' — the money MAY have gone back — and blocks every
 * further refund from that card until a person has looked. Look in the
 * provider's back office (Pelecard: the transactions report, a credit
 * transaction for this amount on this card), then record what you found:
 *
 *   refunded — the money went back. The next credit on the bill for exactly
 *              this amount issues its credit note without refunding again.
 *   failed   — nothing went back. Further refunds are possible again.
 *
 * Like the other scripts it loads .env.local (staging); use
 * `npm run resolve-card-refund:prod` for production.
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
const id = args.get('refund-id');
if (!id || id === true) die('Missing --refund-id.');
const as = args.get('as');
if (as !== undefined && as !== 'refunded' && as !== 'failed') die('--as must be refunded or failed.');

const db = createClient(url, key, { auth: { persistSession: false } });
const { data: r, error } = await db.from('card_refunds')
  .select('*, card_payments(amount, card_last4, provider_ref), invoices!card_refunds_invoice_id_fkey(provider_docnum, customer_name)')
  .eq('id', id).maybeSingle();
if (error) die(error.message);
if (!r) die(`No card refund ${id} in ${url.replace(/^https?:\/\//, '').split('.')[0]}.`);

console.log(`\nProject   ${url.replace(/^https?:\/\//, '').split('.')[0]}`);
console.log(`Refund    ${r.id}  ₪${r.amount}  status ${r.status}${r.kind ? ` (${r.kind})` : ''}`);
console.log(`Card      ****${r.card_payments?.card_last4 ?? '????'}  charged ₪${r.card_payments?.amount}  provider ref ${r.card_payments?.provider_ref ?? '-'}`);
console.log(`Bill      #${r.invoices?.provider_docnum ?? '-'}  ${r.invoices?.customer_name ?? ''}`);
console.log(`Asked     ${r.created_at}`);
if (r.message) console.log(`Message   ${r.message}`);

if (!as) { console.log('\n(Nothing changed. Pass --as refunded|failed to settle it.)\n'); process.exit(0); }
if (r.status !== 'unknown' && r.status !== 'pending') die(`It is already ${r.status}; only an unknown refund is settled here.`);

const patch = as === 'refunded'
  ? { status: 'refunded', kind: 'refund', provider_refund_id: args.get('provider-refund-id') ?? null, message: `settled by hand: refunded (${new Date().toISOString()})` }
  : { status: 'failed', message: `settled by hand: nothing returned (${new Date().toISOString()})` };
const { error: uErr } = await db.from('card_refunds').update(patch).eq('id', id);
if (uErr) die(uErr.message);
console.log(`\n\x1b[32m✓\x1b[0m settled as ${as}\n`);
