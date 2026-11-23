#!/usr/bin/env node
/* Connect a garage to its invoicing provider (iCount for the pilot).
 *
 *   node scripts/connect-billing.mjs --garage-id <uuid> --cid <icount-cid> --token <icount-token>
 *
 * This is the second onboarding step, separate from creating the garage and its
 * users (scripts/onboard-garage.mjs). It writes the two service_role-only tables
 * the issue-invoice Edge Function reads:
 *
 *   * garage_billing          — provider + vat_rate + active. The garage's own
 *     members may READ this (so the UI can show "invoicing connected"), but not
 *     write it. Turning issuing on is an admin action, which is this script.
 *
 *   * garage_billing_secrets  — the provider credentials bag, with NO grant to
 *     authenticated/anon at all. Only service_role writes or reads it, so the
 *     token never enters a client bundle or a PostgREST response.
 *
 * Like onboard-garage.mjs this runs under the service_role key, loads .env.local
 * (which points at staging), and is targeted at production the same way — by
 * exporting SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY inline, which override the
 * file. The project it is about to write to is printed and checked against the
 * key before anything happens.
 *
 * NEVER name the service key VITE_SUPABASE_SERVICE_ROLE_KEY — Vite bakes every
 * VITE_-prefixed variable into the browser bundle, and this key bypasses RLS.
 *
 * The token is a secret: it is never printed back, only confirmed as stored.
 * Per docs/PRODUCTION.md §4a, rotate the token after go-live — it is pasted in
 * plaintext here at setup time.
 */

/* The writes live in packages/ops (onboarding/billing.ts), shared with the
   admin console's onboarding form. This file is the command line. */
import { checkedClient, connectBilling, findGarage, projectRefOf } from '../packages/ops/src/index.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env.local ourselves — node does not read .env files, only Vite does.
// Values already in the environment win, so `SUPABASE_URL=… node scripts/…`
// still targets production without editing anything. Same as onboard-garage.mjs.
try {
  const here = dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(join(here, '..', '.env.local'));
} catch {
  // Absent or unreadable is fine — the variables may come from the environment.
}

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const garageId = args.get('garage-id');
const provider = (args.get('provider') ?? 'icount').trim();
const cid = args.get('cid');
const token = args.get('token');
// VAT is stored per invoice, so this is only the default applied to new
// documents. Omit to keep the column's own default (0.18) / the existing value.
const vatRate = args.has('vat-rate') ? Number(args.get('vat-rate')) : undefined;
// Issuing is written ON by default — connecting is the point at which it turns
// on. Pass --inactive to store the credentials but leave issuing disabled until
// they are verified.
const active = !args.has('inactive');

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (!garageId) die('Missing --garage-id (the garage to connect; from onboard-garage.mjs output)');
if (provider === 'icount' && (!cid || !token)) die('iCount needs --cid and --token');
if (vatRate !== undefined && !(vatRate >= 0 && vatRate < 1)) {
  die(`--vat-rate must be a fraction between 0 and 1 (e.g. 0.18), got "${args.get('vat-rate')}"`);
}

/* A service_role key (the anon key is a plausible paste mistake), and one that
   belongs to the project in the URL (a production key with a staging URL is
   the dangerous direction). Opaque sb_secret_ keys carry no claims; the
   printed project ref below is the only guard for those. */
let db;
try {
  db = checkedClient({ url, serviceKey });
} catch (e) {
  die(e.message);
}
const projectRef = projectRefOf(url);

// Printed before anything is written. For an opaque sb_secret_ key this line is
// the only indication of which database is about to be changed.
console.log(`\nProject   ${projectRef}`);
console.log(`Garage    ${garageId}`);
console.log(`Provider  ${provider}`);
console.log(`Issuing   ${active ? 'ON' : 'off (credentials stored, issuing disabled)'}\n`);

const attempt = async (work) => {
  try {
    return await work();
  } catch (e) {
    return die(e.message);
  }
};

/* ---------- 0. the garage must exist ---------- */
// A typo'd garage-id would otherwise fail on a foreign key, less clearly.
const garage = await attempt(() => findGarage(db, garageId));
console.log(`\x1b[32m✓\x1b[0m garage found      ${garage.name}`);

/* ---------- 1–3. credentials, settings, and a read-back ----------
   Provider-agnostic credentials: iCount is { cid, token }; another provider is
   whatever its adapter reads (see supabase/functions/_shared/provider.ts). The
   token comes back as its last four characters only. */
const summary = await attempt(() => connectBilling(db, {
  garageId,
  provider,
  credentials: provider === 'icount' ? { cid, token } : { token },
  vatRate,
  active,
}));

console.log(`\n\x1b[32mConnected.\x1b[0m`);
console.log(`  provider  ${summary.provider}`);
if (provider === 'icount') console.log(`  cid       ${summary.cid}`);
console.log(`  token     ${summary.tokenTail}`);
console.log(`  vat_rate  ${summary.vatRate}`);
console.log(`  active    ${summary.active}`);
console.log('\n  Test issuing from the ticket billing panel. Rotate the token after go-live.\n');
