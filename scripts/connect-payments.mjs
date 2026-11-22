#!/usr/bin/env node
/* Connect a garage to its card-clearing provider (Pelecard for the pilot).
 *
 *   npm run connect-payments -- --garage-id <uuid> [--shop-no <n> | --no-shop-no] [--inactive]
 *                               [--max-installments <1-36>] [--installments-min <₪>]
 *
 * Installments default to the columns' own (up to 12, no minimum) and are kept
 * as they are when the flags are omitted on a re-run. --max-installments 1
 * turns them off.
 *
 * The credentials are read from the environment, NOT the command line, so they
 * never land in shell history:
 *
 *   PELECARD_TERMINAL, PELECARD_USER, PELECARD_PASSWORD   (and optionally
 *   PELECARD_SHOP_NO — the physical terminal's shop number; --shop-no wins)
 *
 * It writes the two tables the card-payment Edge Function reads, the same way
 * connect-billing.mjs does for invoicing:
 *
 *   * garage_payments         — provider, active, pos_shop_no. Members read it.
 *   * garage_payment_secrets  — { terminal, user, password }. service_role only.
 *
 * It does NOT call Pelecard. A wrong password tried against Pelecard counts
 * toward locking the account — it happened to the pilot garage once — so the
 * first real call is a deliberate payment from the app, made once.
 *
 * Like the other scripts it loads .env.local (staging) and is pointed at
 * production with `npm run connect-payments:prod`. Pelecard's public TEST
 * terminal is refused on production (unless --allow-test-terminal, for a
 * garage that exists only to test production), and a non-test terminal on
 * anything else needs --real, so a sandbox and a live account cannot be
 * swapped by accident.
 */

import { createClient } from '@supabase/supabase-js';

const TEST_TERMINAL = '0882577012';
const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1];
  if (v !== undefined && !v.startsWith('--')) { args.set(k, v); i++; } else args.set(k, true);
}

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const garageId = args.get('garage-id');
const provider = String(args.get('provider') ?? 'pelecard');
const active = !args.has('inactive');
/* The terminal is changed only when said: --shop-no <n> sets it,
   --no-shop-no removes it, and neither leaves it as it is — so a re-run to
   change installments does not disconnect the terminal. PELECARD_SHOP_NO
   counts as saying it. */
const shopArg = args.get('shop-no');
const shopNo = args.has('no-shop-no')
  ? null
  : (typeof shopArg === 'string' ? shopArg : process.env.PELECARD_SHOP_NO ?? '').trim() || undefined;

const maxInstallments = args.has('max-installments') ? Number(args.get('max-installments')) : undefined;
const installmentsMin = args.has('installments-min') ? Number(args.get('installments-min')) : undefined;
if (maxInstallments !== undefined && !(Number.isInteger(maxInstallments) && maxInstallments >= 1 && maxInstallments <= 36)) {
  console.error('\x1b[31m✗\x1b[0m --max-installments must be a whole number from 1 to 36');
  process.exit(1);
}
if (installmentsMin !== undefined && !(installmentsMin >= 0)) {
  console.error('\x1b[31m✗\x1b[0m --installments-min must be a sum of 0 or more');
  process.exit(1);
}

const terminal = process.env.PELECARD_TERMINAL?.trim();
const user = process.env.PELECARD_USER?.trim();
const password = process.env.PELECARD_PASSWORD;

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (!garageId || garageId === true) die('Missing --garage-id.');
if (provider !== 'pelecard') die(`Unknown provider "${provider}".`);
if (!terminal || !user || !password) die('Set PELECARD_TERMINAL, PELECARD_USER and PELECARD_PASSWORD.');

const projectRef = url.replace(/^https?:\/\//, '').split('.')[0];
const isProd = projectRef === PRODUCTION_PROJECT_REF;
const isTest = terminal === TEST_TERMINAL;

/* The test terminal approves cards and moves no money. On a real garage that
   is "paid" for jobs nobody paid for, so production refuses it — unless it is
   said out loud, for a garage that exists only to test the production deploy
   (prod-test). */
if (isProd && isTest && !args.has('allow-test-terminal')) {
  die('Refusing to connect Pelecard\'s TEST terminal on production. For a test garage only: --allow-test-terminal.');
}
if (!isProd && !isTest && !args.has('real')) {
  die('That is not Pelecard\'s test terminal, and this is not production. Pass --real if you mean it.');
}

const looksLikeServiceRole = (key) => {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role';
  } catch {
    return false;
  }
};
if (!looksLikeServiceRole(serviceKey)) die('SUPABASE_SERVICE_ROLE_KEY is not a service_role key.');

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`\nProject   ${projectRef}${isProd ? '  \x1b[33m(PRODUCTION)\x1b[0m' : ''}`);
console.log(`Garage    ${garageId}`);
console.log(`Provider  ${provider}  terminal ••••${terminal.slice(-4)}${isTest ? ' (test)' : ''}`);
if (isProd && isTest) console.log('\x1b[33m          TEST terminal on PRODUCTION — cards are approved, no money moves.\x1b[0m');
console.log(`Shop no   ${shopNo === undefined ? '(unchanged)' : shopNo ?? '(removed — card entry only)'}`);
console.log(`Payments  ${active ? 'ON' : 'off (credentials stored, payments disabled)'}\n`);

{
  const { data, error } = await db.from('garages').select('id,name').eq('id', garageId).maybeSingle();
  if (error) die(`Could not look up the garage: ${error.message}`);
  if (!data) die(`No garage with id ${garageId} in ${projectRef}.`);
  console.log(`\x1b[32m✓\x1b[0m garage found      ${data.name}`);
}

{
  const { error } = await db.from('garage_payment_secrets').upsert(
    { garage_id: garageId, credentials: { terminal, user, password }, updated_at: new Date().toISOString() },
    { onConflict: 'garage_id' },
  );
  if (error) die(`Could not store the credentials: ${error.message}`);
  console.log('\x1b[32m✓\x1b[0m credentials stored');
}

{
  const row = { garage_id: garageId, provider, active, updated_at: new Date().toISOString() };
  if (shopNo !== undefined) row.pos_shop_no = shopNo;
  if (maxInstallments !== undefined) row.max_installments = maxInstallments;
  if (installmentsMin !== undefined) row.installments_min_amount = installmentsMin;
  const { error } = await db.from('garage_payments').upsert(row, { onConflict: 'garage_id' });
  if (error) die(`Could not write the payment settings: ${error.message}`);
  console.log('\x1b[32m✓\x1b[0m payment settings written');
}

{
  const { data: cfg, error } = await db.from('garage_payments')
    .select('provider, active, pos_shop_no, max_installments, installments_min_amount').eq('garage_id', garageId).single();
  if (error) die(`Verification failed: ${error.message}`);
  const { data: sec } = await db.from('garage_payment_secrets').select('credentials').eq('garage_id', garageId).single();
  if (!sec?.credentials?.password) die('Stored, but the password came back empty.');
  console.log(`\n\x1b[32mConnected.\x1b[0m  ${cfg.provider} · active ${cfg.active} · shop ${cfg.pos_shop_no ?? '-'}`);
  console.log(`  installments up to ${cfg.max_installments}, from ₪${cfg.installments_min_amount}\n`);
  console.log('  Remember: the card-payment function needs PAYMENT_RETURN_ORIGINS set.\n');
}
