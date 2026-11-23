#!/usr/bin/env node
/* Connect a garage to its card-clearing provider (Pelecard for the pilot).
 *
 *   npm run connect-payments -- --garage-id <uuid> [--shop-no <n> | --no-shop-no] [--inactive]
 *                               [--max-installments <1-36>] [--installments-min <₪>]
 *
 *   npm run connect-payments -- --garage-id <uuid> --settings-only
 *                               [--shop-no <n> | --no-shop-no] [--max-installments <n>]
 *                               [--installments-min <₪>] [--activate | --inactive]
 *
 * --settings-only changes the settings and nothing else: no credentials are
 * read or written, so no password is typed again to move a shop number. It
 * also gives installments limits to a garage with NO provider (a card taken
 * on its own terminal, recorded by hand). On/off changes only when said
 * (--activate / --inactive), and --activate needs stored credentials and no
 * suspension — a suspension is lifted only by reconnecting with credentials.
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
 * Re-running it also clears a suspension: when Pelecard rejected the
 * credentials, the card-payment function switched the garage's payments off
 * (migration 20261123090000); fix the credentials, then run this again.
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

/* The writes live in packages/ops (onboarding/payments.ts), shared with the
   admin console's onboarding form — including the test-terminal rules, which
   ops checks again before writing. This file is the command line. */
import {
  checkedClient,
  connectPayments,
  findGarage,
  PELECARD_TEST_TERMINAL as TEST_TERMINAL,
  PRODUCTION_PROJECT_REF,
  projectRefOf,
  updatePaymentSettings,
} from '../packages/ops/src/index.ts';

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
const settingsOnly = args.has('settings-only');
/* Connecting turns payments on unless --inactive. Settings-only leaves them
   as they are unless --activate or --inactive says otherwise. */
const active = settingsOnly
  ? (args.has('activate') ? true : args.has('inactive') ? false : undefined)
  : !args.has('inactive');
if (args.has('activate') && args.has('inactive')) {
  console.error('\x1b[31m✗\x1b[0m --activate and --inactive together?');
  process.exit(1);
}
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
if (!settingsOnly && (!terminal || !user || !password)) die('Set PELECARD_TERMINAL, PELECARD_USER and PELECARD_PASSWORD (or --settings-only).');
/* PELECARD_* may well be set — `npm run connect-payments` loads .env.local,
   which holds the sandbox ones. Settings-only simply does not read them. */

const projectRef = projectRefOf(url);
const isProd = projectRef === PRODUCTION_PROJECT_REF;
const isTest = !settingsOnly && terminal === TEST_TERMINAL;

/* The test terminal approves cards and moves no money. On a real garage that
   is "paid" for jobs nobody paid for, so production refuses it — unless it is
   said out loud, for a garage that exists only to test the production deploy
   (prod-test). */
if (isProd && isTest && !args.has('allow-test-terminal')) {
  die('Refusing to connect Pelecard\'s TEST terminal on production. For a test garage only: --allow-test-terminal.');
}
if (!settingsOnly && !isProd && !isTest && !args.has('real')) {
  die('That is not Pelecard\'s test terminal, and this is not production. Pass --real if you mean it.');
}

let db;
try {
  db = checkedClient({ url, serviceKey });
} catch (e) {
  die(e.message);
}

console.log(`\nProject   ${projectRef}${isProd ? '  \x1b[33m(PRODUCTION)\x1b[0m' : ''}`);
console.log(`Garage    ${garageId}`);
console.log(settingsOnly
  ? `Provider  ${provider}  (settings only — credentials untouched)`
  : `Provider  ${provider}  terminal ••••${terminal.slice(-4)}${isTest ? ' (test)' : ''}`);
if (isProd && isTest) console.log('\x1b[33m          TEST terminal on PRODUCTION — cards are approved, no money moves.\x1b[0m');
console.log(`Shop no   ${shopNo === undefined ? '(unchanged)' : shopNo ?? '(removed — card entry only)'}`);
if (maxInstallments !== undefined || installmentsMin !== undefined) {
  console.log(`Installm. ${maxInstallments ?? '(unchanged)'} max, from ₪${installmentsMin ?? '(unchanged)'}`);
}
console.log(`Payments  ${active === undefined ? '(unchanged)' : active ? 'ON' : 'off (payments disabled)'}\n`);

const attempt = async (work) => {
  try {
    return await work();
  } catch (e) {
    return die(e.message);
  }
};

const garage = await attempt(() => findGarage(db, garageId));
console.log(`\x1b[32m✓\x1b[0m garage found      ${garage.name}`);

const settings = { shopNo, maxInstallments, installmentsMin };

if (settingsOnly) {
  const cfg = await attempt(() => updatePaymentSettings(db, garageId, { ...settings, active }));
  console.log(`\x1b[32m✓\x1b[0m settings written   ${cfg.provider} · active ${cfg.active} · shop ${cfg.shopNo ?? '-'} · installments up to ${cfg.maxInstallments}, from ₪${cfg.installmentsMin}${cfg.suspended ? ' · SUSPENDED' : ''}\n`);
  process.exit(0);
}

/* Connecting (again) also lifts a suspension: whoever runs this has just put in
   credentials they checked. */
const cfg = await attempt(() => connectPayments(db, {
  garageId,
  env: isProd ? 'production' : 'staging',
  provider,
  credentials: { terminal, user, password },
  active,
  allowTestTerminal: args.has('allow-test-terminal'),
  realTerminal: args.has('real'),
  ...settings,
}));
console.log('\x1b[32m✓\x1b[0m credentials stored');
console.log('\x1b[32m✓\x1b[0m payment settings written');
console.log(`\n\x1b[32mConnected.\x1b[0m  ${cfg.provider} · active ${cfg.active} · shop ${cfg.shopNo ?? '-'}`);
console.log(`  installments up to ${cfg.maxInstallments}, from ₪${cfg.installmentsMin}\n`);
console.log('  Remember: the card-payment function needs PAYMENT_RETURN_ORIGINS set.\n');
