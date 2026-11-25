#!/usr/bin/env node
/* Turn a garage's invoicing off or on. Provider and credentials are kept.
 *
 *   npm run invoicing -- --list
 *   npm run invoicing -- --garage-id <uuid>                 (show it)
 *   npm run invoicing -- --garage-id <uuid> --off [--yes]
 *   npm run invoicing -- --garage-id <uuid> --on  [--yes]
 *
 *   (production: npm run invoicing:prod -- ...)
 *
 * Off is what the app reads as "no invoicing connected": closing a ticket
 * issues no document, and a document asked for is refused. Used to pause a
 * garage — and on staging, to make a receipt fail on purpose: open the card
 * payment page, switch off, pay, switch back on. That is how "a card charged
 * with no receipt" is reproduced (see docs/SCRIPTS.md).
 *
 * The screen reads the switch when the close drawer OPENS, so switching off
 * before that hides the receipt instead of failing it.
 *
 * Asks you to type "yes" unless --yes is passed. The same switch is in the
 * admin console (npm run admin → מוסכים → the garage → חשבוניות).
 */

import { createInterface } from 'node:readline/promises';
import { checkedClient, projectRefOf, setInvoicingActive } from '../packages/ops/src/index.ts';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i++; } else args.set(key, true);
}
const die = (msg) => { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exit(1); };

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run through npm, which loads the env file).');

let db;
try {
  db = checkedClient({ url, serviceKey });
} catch (e) {
  die(e.message);
}
const projectRef = projectRefOf(url);
console.log(`\nProject   ${url.includes('.supabase.co') ? projectRef : url}\n`);

const state = (b) => (!b ? 'not connected' : b.active ? '\x1b[32mon\x1b[0m' : '\x1b[33moff\x1b[0m');

/* ---------- --list ---------- */
if (args.has('list')) {
  const { data: garages, error: gErr } = await db.from('garages').select('id, name').order('name');
  if (gErr) die(gErr.message);
  const { data: billing, error: bErr } = await db.from('garage_billing').select('garage_id, provider, active');
  if (bErr) die(bErr.message);
  for (const g of garages) {
    const b = billing.find((r) => r.garage_id === g.id);
    console.log(`  ${g.id}  ${g.name.padEnd(24)}  ${b ? `${b.provider} · ` : ''}${state(b)}`);
  }
  console.log('');
  process.exit(0);
}

/* ---------- one garage ---------- */
const garageId = args.get('garage-id');
if (typeof garageId !== 'string') die('Missing --garage-id (see --list).');
if (args.has('on') && args.has('off')) die('Pass --on or --off, not both.');

const { data: garage, error: gErr } = await db.from('garages').select('id, name').eq('id', garageId).maybeSingle();
if (gErr) die(`Could not look up the garage: ${gErr.message}`);
if (!garage) die(`No garage with id ${garageId} in ${projectRef}.`);
const { data: billing, error: bErr } = await db.from('garage_billing').select('provider, active').eq('garage_id', garageId).maybeSingle();
if (bErr) die(`Could not read garage_billing: ${bErr.message}`);

console.log(`Garage    ${garage.name} (${garage.id})`);
console.log(`Invoicing ${billing ? `${billing.provider} · ` : ''}${state(billing)}`);

if (!args.has('on') && !args.has('off')) { console.log('\n(Nothing changed. Pass --off or --on.)\n'); process.exit(0); }
if (!billing) die('Not connected to an accounting provider — there is nothing to switch.');

const active = args.has('on');
if (Boolean(billing.active) === active) { console.log(`\nAlready ${active ? 'on' : 'off'}. Nothing to do.\n`); process.exit(0); }

if (!args.has('yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nType "yes" to switch invoicing ${active ? 'ON' : 'OFF'}: `)).trim();
  rl.close();
  if (answer !== 'yes') die('Not changed.');
}

try {
  await setInvoicingActive(db, garageId, active);
} catch (e) {
  die(e.message);
}
console.log(`\n\x1b[32m✓\x1b[0m ${garage.name}: invoicing is now ${active ? 'ON' : 'OFF'}.\n`);
