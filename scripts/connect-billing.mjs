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

import { createClient } from '@supabase/supabase-js';
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

/* A service_role key is a full-access credential and the anon key is a plausible
   paste mistake — both are JWTs from the same page, differing only in a claim.
   Decode and check, unless it is an opaque sb_secret_ key (no readable claims;
   the anon equivalent is sb_publishable_ and cannot be confused with one). */
const looksLikeServiceRole = (key) => {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return payload.role === 'service_role';
  } catch {
    return false;
  }
};

if (!looksLikeServiceRole(serviceKey)) {
  die('SUPABASE_SERVICE_ROLE_KEY is not a service_role key — check you did not paste the anon key.');
}

/* The dangerous mistake is a production key with a staging URL (or the reverse),
   then reading the success as confirmation you hit the project you meant. A
   Supabase JWT carries its project in the `ref` claim, so the mismatch is
   detectable before anything is written. Opaque sb_secret_ keys carry no claims;
   the printed project ref below is the only guard for those. */
const projectRef = url.replace(/^https:\/\//, '').split('.')[0];

const keyProjectRef = (key) => {
  if (key.startsWith('sb_secret_')) return null;
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref ?? null;
  } catch {
    return null;
  }
};

const keyRef = keyProjectRef(serviceKey);
if (keyRef && keyRef !== projectRef) {
  die(
    `Key/URL mismatch: the key belongs to "${keyRef}" but the URL points at "${projectRef}". ` +
      'One of them is from the wrong project.',
  );
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// Printed before anything is written. For an opaque sb_secret_ key this line is
// the only indication of which database is about to be changed.
console.log(`\nProject   ${projectRef}`);
console.log(`Garage    ${garageId}`);
console.log(`Provider  ${provider}`);
console.log(`Issuing   ${active ? 'ON' : 'off (credentials stored, issuing disabled)'}\n`);

/* ---------- 0. the garage must exist ---------- */
// A typo'd garage-id would otherwise create billing rows for a garage that is
// not there (FKs would reject it, but the message is clearer here).
{
  const { data, error } = await db.from('garages').select('id,name').eq('id', garageId).maybeSingle();
  if (error) die(`Could not look up the garage: ${error.message}`);
  if (!data) die(`No garage with id ${garageId} in ${projectRef}.`);
  console.log(`\x1b[32m✓\x1b[0m garage found      ${data.name}`);
}

/* ---------- 1. the credentials bag (secret) ---------- */
// Provider-agnostic jsonb: iCount is { cid, token }; another provider is whatever
// its adapter reads (see supabase/functions/_shared/provider.ts).
const credentials = provider === 'icount' ? { cid, token } : { token };

{
  const { error } = await db
    .from('garage_billing_secrets')
    .upsert({ garage_id: garageId, credentials, updated_at: new Date().toISOString() },
      { onConflict: 'garage_id' });
  if (error) die(`Could not store the credentials: ${error.message}`);
  console.log(`\x1b[32m✓\x1b[0m credentials stored`);
}

/* ---------- 2. the operational settings (non-secret) ---------- */
{
  const row = { garage_id: garageId, provider, active, updated_at: new Date().toISOString() };
  if (vatRate !== undefined) row.vat_rate = vatRate;   // else keep the column default / existing value
  const { error } = await db
    .from('garage_billing')
    .upsert(row, { onConflict: 'garage_id' });
  if (error) die(`Could not write the billing settings: ${error.message}`);
  console.log(`\x1b[32m✓\x1b[0m billing settings written`);
}

/* ---------- 3. verify, rather than assume ---------- */
// Read both back through service_role. The token is confirmed present and its
// tail shown (never the whole thing), so a wrong paste is visible without the
// secret ever being logged in full.
{
  const { data: cfg, error: cfgErr } = await db
    .from('garage_billing').select('provider, vat_rate, active').eq('garage_id', garageId).single();
  if (cfgErr) die(`Verification failed reading garage_billing: ${cfgErr.message}`);

  const { data: sec, error: secErr } = await db
    .from('garage_billing_secrets').select('credentials').eq('garage_id', garageId).single();
  if (secErr) die(`Verification failed reading garage_billing_secrets: ${secErr.message}`);

  const c = sec.credentials ?? {};
  const tail = typeof c.token === 'string' && c.token.length >= 4 ? `••••${c.token.slice(-4)}` : '(missing!)';
  if (!c.token) die('Stored, but the token came back empty — check the value passed to --token.');

  console.log(`\n\x1b[32mConnected.\x1b[0m`);
  console.log(`  provider  ${cfg.provider}`);
  if (provider === 'icount') console.log(`  cid       ${c.cid}`);
  console.log(`  token     ${tail}`);
  console.log(`  vat_rate  ${cfg.vat_rate}`);
  console.log(`  active    ${cfg.active}`);
  console.log('\n  Test issuing from the ticket billing panel. Rotate the token after go-live.\n');
}
