#!/usr/bin/env node
/* Set which software a garage's bookkeeper imports into — ריווחית or חשבשבת.
 *
 *   npm run bookkeeping-software -- --garage-id <uuid> --software rivhit
 *   npm run bookkeeping-software -- --garage-id <uuid> --software hashavshevet
 *   npm run bookkeeping-software -- --list
 *
 *   (production: npm run bookkeeping-software:prod -- ...)
 *
 * WHY THIS MATTERS
 *
 * The two need different files. The movement-type code at the start of every
 * line of movein.dat is numeric for ריווחית and Hebrew letters for חשבשבת, and
 * a file built for the wrong one imports without complaint — into the wrong
 * movement types. So there is no default: until this is set, the garage cannot
 * export at all. See supabase/functions/_shared/bookkeepingParts.ts.
 *
 * WHAT IT DOES
 *
 *   1. Checks the key is a service_role key and belongs to the project in the URL.
 *   2. Prints the project, the garage, the current value and the new one.
 *   3. Asks you to type "yes" (or pass --yes).
 *   4. Writes garage_billing.bookkeeping_software, then reads it back.
 *
 * The garage must already be connected to its accounting provider
 * (scripts/connect-billing.mjs) — this only adds a setting to that row.
 *
 * --list prints every garage with its current setting and changes nothing.
 */

/* The write lives in packages/ops (onboarding/billing.ts), shared with the
   admin console's onboarding form. This file is the command line. */
import { checkedClient, projectRefOf, setBookkeeping } from '../packages/ops/src/index.ts';
import { createInterface } from 'node:readline/promises';

const SOFTWARE = {
  rivhit: 'ריווחית — one order (rivhit): movein.dat, heshin.dat, heshin.prm',
  hashavshevet: 'חשבשבת — two orders: hash_dos_long (movein.dat) + hash_win_flexible (heshin.dat, heshin.prm)',
};

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i++; } else args.set(key, true);
}

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run through npm, which loads the env file).');

/* Same two guards as connect-billing.mjs: the anon key is a plausible paste
   mistake, and a production key with a staging URL (or the reverse) is the
   dangerous one. */
let db;
try {
  db = checkedClient({ url, serviceKey });
} catch (e) {
  die(e.message);
}
const projectRef = projectRefOf(url);
console.log(`\nProject   ${url.includes('.supabase.co') ? projectRef : url}\n`);

/* ---------- --list: look, change nothing ---------- */
if (args.has('list')) {
  const { data: garages, error: gErr } = await db.from('garages').select('id, name').order('name');
  if (gErr) die(gErr.message);
  const { data: billing, error: bErr } = await db.from('garage_billing').select('garage_id, active, bookkeeping_software');
  if (bErr) die(bErr.message);
  for (const g of garages) {
    const b = billing.find((r) => r.garage_id === g.id);
    const state = !b ? 'not connected to a provider'
      : b.bookkeeping_software ?? '\x1b[33mNOT SET — cannot export\x1b[0m';
    console.log(`  ${g.id}  ${g.name.padEnd(24)}  ${state}`);
  }
  console.log('');
  process.exit(0);
}

/* ---------- set ---------- */
const garageId = args.get('garage-id');
const software = args.get('software');
if (typeof garageId !== 'string') die('Missing --garage-id (see --list).');
if (!(software in SOFTWARE)) die(`--software must be one of: ${Object.keys(SOFTWARE).join(', ')}`);

const { data: garage, error: gErr } = await db.from('garages').select('id, name').eq('id', garageId).maybeSingle();
if (gErr) die(`Could not look up the garage: ${gErr.message}`);
if (!garage) die(`No garage with id ${garageId} in ${projectRef}.`);

const { data: billing, error: bErr } = await db.from('garage_billing')
  .select('bookkeeping_software').eq('garage_id', garageId).maybeSingle();
if (bErr) die(`Could not read garage_billing: ${bErr.message}`);
if (!billing) die(`${garage.name} is not connected to an accounting provider yet — run connect-billing first.`);

console.log(`Garage    ${garage.name} (${garage.id})`);
console.log(`Current   ${billing.bookkeeping_software ?? '(not set)'}`);
console.log(`New       ${software} — ${SOFTWARE[software]}\n`);

if (billing.bookkeeping_software === software) {
  console.log('Already set to that. Nothing to do.\n');
  process.exit(0);
}

if (!args.has('yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to write this: ')).trim();
  rl.close();
  if (answer !== 'yes') die('Not changed.');
}

try {
  await setBookkeeping(db, garageId, { software });
} catch (e) {
  die(e.message);
}

console.log(`\x1b[32m✓\x1b[0m ${garage.name}: bookkeeping software is now ${software}.\n`);
