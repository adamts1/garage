#!/usr/bin/env node
/* Create a garage and its first user, in one step.
 *
 *   node scripts/onboard-garage.mjs --garage "מוסך הרצל" --email avi@example.com --admin
 *
 * The garage's printed letterhead is set here too, and only here — the app has
 * no editor for it, the same way it has no editor for a role:
 *
 *   node scripts/onboard-garage.mjs --garage-id <uuid> \\
 *     --print-name 'אי-תן שירותי רכב בע"מ' --motto "✡ ישראל חי" \\
 *     --services "מכונאות לכל סוגי הרכב * מדיאגנוסטיקה * שירותי חשמל ומיזוג אויר" \\
 *     --address "רח׳ בית הדפוס, ירושלים" --phone 02-6522306 --fax 02-6522307 \\
 *     --license-no 40677 --tax-id 514123456
 *
 * Only the fields passed are written, so correcting a phone number does not
 * blank the address. Pass an empty string to clear one.
 *
 * That form asks for no email and no role, and touches neither the user table
 * nor the membership: it is a letterhead edit, not an onboarding.
 *
 * --admin or --member is REQUIRED, with no default. Only an admin may change
 * the name or the price of a work already on a ticket; a member does every
 * other thing the app can do. This script is the only place a role is set —
 * there is deliberately no in-app editor, so the sole admin of a garage cannot
 * demote themselves out of their own price list.
 *
 * The requirement is not pedantry. The membership row is written with an
 * upsert, so re-running this for somebody who already exists rewrites their
 * role; a default would mean an omitted flag quietly demoting a garage's only
 * admin, with the service_role key as the only way back.
 *
 * This is the only way accounts come into existence. There is no self-signup,
 * no invite code and no join RPC — which is what makes the "signed in but
 * belongs to no garage" state unreachable rather than merely unlikely. A user
 * and their membership are written together here, or not at all.
 *
 * Runs under the service_role key, which bypasses RLS and every grant. That is
 * why garage_members has no INSERT policy: nothing else needs to write it, so
 * nothing else may.
 *
 *   npm run onboard -- --garage "מוסך הרצל" --email avi@example.com
 *
 * That wrapper passes --env-file=.env.local, because node does not read .env
 * files on its own — only Vite does, and only for its own prefixed variables.
 *
 * NEVER name the service key VITE_SUPABASE_SERVICE_ROLE_KEY. Vite bakes every
 * VITE_-prefixed variable into the browser bundle, and this key bypasses RLS
 * and every grant. The missing prefix is what keeps it out of the bundle, so
 * the naming here is load-bearing rather than stylistic.
 *
 * SUPABASE_URL is preferred and VITE_SUPABASE_URL is accepted, since the URL is
 * public either way. Which project is being written to is printed before
 * anything happens, and checked against the key — see below.
 */

/* The writes themselves live in packages/ops (onboarding/garage.ts), shared
   with the admin console's onboarding form. This file is the command line:
   flags, the checks on them, and what gets printed. */
import {
  checkedClient,
  createGarage,
  ensureUser,
  findGarage,
  generatePassword,
  linkMember,
  projectRefOf,
  seedStarterCatalog,
  updateLetterhead,
  verifyMembership,
} from '../packages/ops/src/index.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Load .env.local ourselves rather than relying on how we were invoked.

   Node does not read .env files — only Vite does, and only for VITE_-prefixed
   names. `npm run onboard` passes --env-file, but the obvious thing to type is
   `node scripts/onboard-garage.mjs ...`, and that form failed with a message
   about unset variables that were, from the operator's point of view, plainly
   set: they are sitting in .env.local.

   Values already in the environment win, so an explicit
   `SUPABASE_URL=... node scripts/...` still overrides the file — which is how
   production is targeted without editing anything. */
try {
  const here = dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(join(here, '..', '.env.local'));
} catch {
  // Absent or unreadable is fine — the variables may come from the environment,
  // as they do in CI. The checks below report what is actually missing.
}

/* Flags are `--name value`, `--name=value`, or bare `--name` for a
   presence-only switch such as --catalog. The earlier version stepped two
   tokens at a time, which meant a bare flag swallowed the next flag's name as
   its value and every argument after it was read one position out of phase — so
   `--catalog --email x@y.com` silently lost the email. Stepping one token at a
   time and only consuming the next one when it is not itself a flag keeps order
   irrelevant.

   The `=` form is here because it was typed and it did not work. Without it
   `--motto=X` parsed as a flag literally named `motto=X` carrying no value, and
   an unrecognised flag was dropped without a word — so the field simply was not
   written, and the first sign of it was a garage whose printed sheet had no
   motto on it. Both halves of that are fixed: the form is understood, and the
   check below refuses anything that still is not.

   A value that begins with `--` is therefore not expressible in the spaced
   form. Nothing here takes one — and `--name=--value` says it if it ever does. */
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const eq = token.indexOf('=');
  if (eq > 2) {
    args.set(token.slice(2, eq), token.slice(eq + 1));
    continue;
  }
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) {
    args.set(token.slice(2), true);
  } else {
    args.set(token.slice(2), next);
    i++;
  }
}

// VITE_SUPABASE_URL is a fine fallback: the project URL is already public, it
// ships in the browser bundle and the APK. Only the *key* must never carry a
// VITE_ prefix.
const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

/* Reads a flag that must carry a value. A bare `--email` parses as the boolean
   true, and true would travel on to become a garage name or a password — so it
   is refused here rather than written to the database. */
const valued = (name) => {
  const v = args.get(name);
  if (v === true) die(`--${name} needs a value`);
  return v;
};

const garageName = valued('garage');
const email = valued('email')?.trim().toLowerCase();
// Supplying a password is for tests. Leave it out and one is generated, which
// is what you want for a real garage — it is printed once and not stored.
const password = valued('password') ?? generatePassword();
const existingGarageId = valued('garage-id');

/* The garage's letterhead: what the top of its printed work order says.
 *
 * Optional, every one of them. A garage that passes none prints the header it
 * printed before these existed — its name, and nothing else. There is no
 * default for any of them on purpose: a placeholder address on a customer's
 * copy is worse than no address at all.
 *
 * Settable on an existing garage too, which is the case that actually matters:
 * a phone number changes, and re-running this with --garage-id and the new
 * --phone is how it changes on the paper. Only the fields passed are written,
 * so updating one does not blank the other five. */
const LETTERHEAD = {
  // The name on paper, when the garage goes by a shorter one in the app.
  'print-name': 'printName',
  motto: 'motto',
  services: 'services',
  address: 'address',
  phone: 'phone',
  fax: 'fax',
  'license-no': 'licenseNo',
  // Already a column, and until now nothing wrote it or read it.
  'tax-id': 'taxId',
};

const letterhead = {};
for (const [flag, field] of Object.entries(LETTERHEAD)) {
  const v = valued(flag);
  // An explicit empty string clears the field; an absent flag leaves it alone.
  if (v !== undefined) letterhead[field] = v;
}

/* A flag this script does not know is a typo, and until now a typo was silence:
   the run reported success, the account was created, and the field the operator
   thought they had set was never written. Nothing here is a pass-through to
   another tool, so there is no such thing as an argument this script should
   accept and ignore. */
const KNOWN_FLAGS = new Set([
  'garage', 'garage-id', 'email', 'password', 'admin', 'member', 'catalog',
  ...Object.keys(LETTERHEAD),
]);
for (const name of args.keys()) {
  if (!KNOWN_FLAGS.has(name)) {
    die(
      `Unknown flag --${name}. Known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(' ')}`,
    );
  }
}

/* Setting a letterhead on a garage that already exists is not onboarding
   anybody, so this mode asks for neither an email nor a role and touches
   neither the user table nor the membership.

   Requiring them was worse than clumsy. Correcting a phone number meant naming
   somebody and stating their role, and --admin against the wrong address
   promotes that person — a live way to hand out price-editing rights while
   trying to change a fax number. */
const letterheadOnly =
  Boolean(existingGarageId) && !args.has('email') && Object.keys(letterhead).length > 0;

/* The role has to be said out loud — there is no default.

   It was `--admin, or member if you say nothing`, and the membership row is
   written with an upsert, so re-running this for an existing admin without the
   flag silently demoted them. That is a real way to lose a garage's only admin,
   and since there is no in-app role editor the way back is the service_role
   key. Requiring the word removes the failure mode instead of documenting it:
   you cannot forget to type something the script refuses to run without. */
const wantsAdmin = args.has('admin');
const wantsMember = args.has('member');
const role = wantsAdmin ? 'admin' : 'member';

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (!garageName && !existingGarageId) die('Missing --garage (or --garage-id to join an existing one)');
if (!email && !letterheadOnly) {
  die(
    'Missing --email. Pass --garage-id with letterhead flags and no --email to set a ' +
      'letterhead without touching any account.',
  );
}
/* A role stated with nobody to give it to. Ignoring it would be the silent kind
   of failure this script has already been bitten by once. */
if (letterheadOnly && (wantsAdmin || wantsMember)) {
  die('--admin and --member need an --email. A letterhead-only run grants nothing.');
}
if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`Not an email address: ${email}`);
if (wantsAdmin && wantsMember) die('Pass --admin or --member, not both.');
if (!wantsAdmin && !wantsMember && !letterheadOnly) {
  die(
    'Missing --admin or --member. Only an admin can change the name or price of a work ' +
      'on a ticket; a member does everything else. This is the only place the role is set, ' +
      'and re-running writes it — so it has to be stated every time, including when adding ' +
      'somebody to a garage that already exists.',
  );
}

/* The key must be a service_role key (the anon key is a plausible paste
   mistake), and it must belong to the project in the URL (a production key
   with a staging URL, or the reverse, is the dangerous one). Opaque sb_secret_
   keys carry no claims; the project printed below is the only guard for those. */
let db;
try {
  db = checkedClient({ url, serviceKey });
} catch (e) {
  die(e.message);
}
const projectRef = projectRefOf(url);

// Printed before anything is written. For an opaque sb_secret_ key this line is
// the only indication of which database is about to gain a user.
console.log(`\nProject  ${projectRef}`);
console.log(`Garage   ${garageName ?? existingGarageId}`);
console.log(letterheadOnly ? 'Letterhead only\n' : `User     ${email}\n`);

const attempt = async (work) => {
  try {
    return await work();
  } catch (e) {
    return die(e.message);
  }
};

/* ---------- 1. the garage ---------- */
let garageId = existingGarageId;
if (!garageId) {
  garageId = await attempt(() => createGarage(db, garageName, letterhead));
  console.log(`\x1b[32m✓\x1b[0m garage created   ${garageId}`);
  // Said out loud here as well as on the update path below. A letterhead that
  // was quietly not written looks exactly like one that was.
  if (Object.keys(letterhead).length) {
    console.log(`\x1b[32m✓\x1b[0m letterhead set   ${Object.keys(letterhead).join(', ')}`);
  }
} else {
  const garage = await attempt(() => findGarage(db, garageId));
  console.log(`\x1b[32m✓\x1b[0m garage found     ${garage.name}`);

  /* Only when something was actually passed. An unconditional update would
     rewrite the letterhead to nothing every time somebody is added to an
     existing garage, which is the common use of --garage-id. */
  const written = await attempt(() => updateLetterhead(db, garageId, letterhead));
  if (written.length) console.log(`\x1b[32m✓\x1b[0m letterhead set   ${written.join(', ')}`);
}

/* The letterhead was the whole errand. Stop before the account and the
   membership, both of which this run was given nothing to act on. */
if (letterheadOnly) {
  console.log('\n\x1b[32mDone.\x1b[0m Nothing else was touched — no account, no membership.');
  process.exit(0);
}

/* ---------- 2. the user ---------- */
const user = await attempt(() => ensureUser(db, email, password));
const userId = user.userId;
console.log(user.existing
  ? `\x1b[33m!\x1b[0m user exists      ${userId} (password unchanged)`
  : `\x1b[32m✓\x1b[0m user created     ${userId}`);

/* ---------- 3. the membership ---------- */
// The role rides along, because this is the only place it is ever set — and it
// was demanded up front, see the argument checks.
await attempt(() => linkMember(db, garageId, userId, role));
console.log(`\x1b[32m✓\x1b[0m membership linked  role ${role}\n`);

/* ---------- 4. a starter catalog, only when asked ----------
   Off by default, and never when joining someone to an existing garage — see
   seedStarterCatalog() in packages/ops for why. */
if (!existingGarageId && args.has('catalog')) {
  const seeded = await attempt(() => seedStarterCatalog(db, garageId));
  console.log(`\x1b[32m✓\x1b[0m catalog seeded    ${seeded.works} works, ${seeded.parts} parts`);
}

/* ---------- 5. verify, rather than assume ---------- */
await attempt(() => verifyMembership(db, userId, garageId));

console.log('\x1b[32mReady.\x1b[0m Sign in with:');
console.log(`  email     ${email}`);
if (!valued('password') && !user.existing) {
  console.log(`  password  ${password}`);
  console.log('\n  Written down nowhere else. Hand it over, and have them change it.');
}
console.log();
