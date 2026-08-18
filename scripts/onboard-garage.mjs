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

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

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
const password = valued('password') ?? randomBytes(9).toString('base64url');
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
  'print-name': 'print_name',
  motto: 'motto',
  services: 'services',
  address: 'address',
  phone: 'phone',
  fax: 'fax',
  'license-no': 'license_no',
  // Already a column, and until now nothing wrote it or read it.
  'tax-id': 'tax_id',
};

const letterhead = {};
for (const [flag, column] of Object.entries(LETTERHEAD)) {
  const v = valued(flag);
  // An explicit empty string clears the field; an absent flag leaves it alone.
  if (v !== undefined) letterhead[column] = v.trim() || null;
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

/* A service_role key is a full-access credential, and the anon key is a
   plausible thing to paste by mistake — both are JWTs from the same dashboard
   page, differing only in a claim. Running with the anon key would fail later,
   confusingly, at the first insert.

   The role lives in the JWT payload, so it has to be decoded; the literal
   string is not present in the encoded token. Newer projects issue opaque
   sb_secret_ keys instead, which carry no readable claims — those are taken at
   face value, since the anon equivalent is prefixed sb_publishable_ and cannot
   be confused with one. */
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

/* The URL and the key arrive from different places — the URL often from
   .env.local, the key exported by hand — so nothing stops them naming different
   projects. A key from the wrong project simply fails to authenticate, which is
   survivable. The dangerous direction is subtler: exporting a production key
   while .env.local still points at staging, or the reverse, then reading the
   resulting success as confirmation you hit the project you meant.

   A Supabase JWT carries its project in the `ref` claim, so the mismatch is
   detectable before anything is written rather than after. Opaque sb_secret_
   keys carry no claims and cannot be checked this way; the printed project ref
   below is the only guard for those. */
const projectRef = url.replace(/^https:\/\//, '').split('.')[0];

/** The `ref` claim, or null for opaque keys and anything unparseable. */
const keyProjectRef = (key) => {
  if (key.startsWith('sb_secret_')) return null;
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref ?? null;
  } catch {
    // Not a reason to refuse on its own — a genuinely wrong key fails at the
    // first request anyway.
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
// the only indication of which database is about to gain a user.
console.log(`\nProject  ${projectRef}`);
console.log(`Garage   ${garageName ?? existingGarageId}`);
console.log(letterheadOnly ? 'Letterhead only\n' : `User     ${email}\n`);

/* ---------- 1. the garage ---------- */
let garageId = existingGarageId;
if (!garageId) {
  const { data, error } = await db
    .from('garages')
    .insert({ name: garageName, ...letterhead })
    .select('id')
    .single();
  if (error) die(`Could not create the garage: ${error.message}`);
  garageId = data.id;
  console.log(`\x1b[32m✓\x1b[0m garage created   ${garageId}`);
  // Said out loud here as well as on the update path below. A letterhead that
  // was quietly not written looks exactly like one that was.
  if (Object.keys(letterhead).length) {
    console.log(`\x1b[32m✓\x1b[0m letterhead set   ${Object.keys(letterhead).join(', ')}`);
  }
} else {
  const { data, error } = await db.from('garages').select('id,name').eq('id', garageId).single();
  if (error || !data) die(`No garage with id ${garageId}`);
  console.log(`\x1b[32m✓\x1b[0m garage found     ${data.name}`);

  /* Only when something was actually passed. An unconditional update would
     rewrite the letterhead to nothing every time somebody is added to an
     existing garage, which is the common use of --garage-id. */
  if (Object.keys(letterhead).length) {
    const { error: lhErr } = await db.from('garages').update(letterhead).eq('id', garageId);
    if (lhErr) die(`Could not update the letterhead: ${lhErr.message}`);
    console.log(`\x1b[32m✓\x1b[0m letterhead set   ${Object.keys(letterhead).join(', ')}`);
  }
}

/* The letterhead was the whole errand. Stop before the account and the
   membership, both of which this run was given nothing to act on. */
if (letterheadOnly) {
  console.log('\n\x1b[32mDone.\x1b[0m Nothing else was touched — no account, no membership.');
  process.exit(0);
}

/* ---------- 2. the user ---------- */
// email_confirm: true because there is no inbox in this flow — the operator
// hands over the password directly. Without it the account exists but cannot
// sign in, which looks exactly like a wrong password.
let userId;
const { data: created, error: createErr } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createErr) {
  // Already registered is not a failure: this script must be safe to re-run
  // when it fell over halfway through, which is precisely when a user exists
  // and a membership does not.
  if (!/already been registered|already exists/i.test(createErr.message)) {
    die(`Could not create the user: ${createErr.message}`);
  }
  const { data: list, error: listErr } = await db.auth.admin.listUsers();
  if (listErr) die(`User exists but could not be looked up: ${listErr.message}`);
  const found = list.users.find((u) => u.email?.toLowerCase() === email);
  if (!found) die(`User ${email} reported as existing but was not found.`);
  userId = found.id;
  console.log(`\x1b[33m!\x1b[0m user exists      ${userId} (password unchanged)`);
} else {
  userId = created.user.id;
  console.log(`\x1b[32m✓\x1b[0m user created     ${userId}`);
}

/* ---------- 3. the membership ---------- */
// The step that matters. A user without this row can sign in and then see
// nothing — the state AuthGate exists to catch.
//
// The role rides along, because this is the only place it is ever set: there is
// no in-app role editor, which is what makes it impossible for the one admin a
// garage has to demote themselves and lock the prices away from everybody.
// Which one it is was demanded up front — see the argument checks.
const { error: memberErr } = await db
  .from('garage_members')
  .upsert({ garage_id: garageId, user_id: userId, role }, { onConflict: 'garage_id,user_id' });
if (memberErr) die(`User and garage exist but could not be linked: ${memberErr.message}`);
console.log(`\x1b[32m✓\x1b[0m membership linked  role ${role}\n`);

/* ---------- 4. a starter catalog, only when asked ----------

   Off by default: a garage starts empty and builds its own catalog. The earlier
   default was to hand every new garage a copy of the standard ten works and
   twenty-four parts, on the reasoning that an empty picker cannot write a
   ticket. In practice that inverted the work — a garage's first job became
   deleting two dozen parts it does not stock and re-pricing works it does not
   offer, and a part left behind reads as real stock at a price nobody chose.

   Pass --catalog to seed it anyway, which is useful for demos and smoke tests.

   A copy, not a reference: from here on the two diverge, which is the entire
   point of making the catalog per-garage. Editing one garage's oil-change price
   must never touch another's.

   Never seeded when joining someone to a garage that already exists
   (--garage-id), since that garage has its own catalog and duplicating it would
   be a mess of conflicting SKUs. */
if (!existingGarageId && args.has('catalog')) {
  const starterPath = join(dirname(fileURLToPath(import.meta.url)), 'starter-catalog.json');
  let starter = null;
  try {
    starter = JSON.parse(readFileSync(starterPath, 'utf8'));
  } catch {
    console.log('\x1b[33m!\x1b[0m starter catalog not found — garage created with an empty catalog');
  }

  if (starter) {
    // Parts first: they are what a work's items refer to by SKU.
    const parts = (starter.parts ?? []).map((p) => ({ ...p, stock: 0, garage_id: garageId }));
    if (parts.length) {
      const { error } = await db.from('items').upsert(parts, { onConflict: 'garage_id,sku' });
      if (error) die(`Could not seed the parts catalog: ${error.message}`);
    }

    for (const w of starter.works ?? []) {
      const { data: row, error } = await db
        .from('work_defs')
        .insert({
          garage_id: garageId,
          code: w.code,
          name: w.name,
          labor: w.labor,
          hours: w.hours,
          position: w.position ?? 0,
        })
        .select('id')
        .single();
      // A duplicate code means this garage was already seeded; skip rather than
      // fail, so a half-finished run can be repeated.
      if (error) {
        if (/duplicate key/i.test(error.message)) continue;
        die(`Could not seed work ${w.code}: ${error.message}`);
      }
      if (w.items?.length) {
        const { error: itemErr } = await db.from('work_def_items').insert(
          w.items.map((p, i) => ({ work_def_id: row.id, ...p, position: i })),
        );
        if (itemErr) die(`Could not seed parts for work ${w.code}: ${itemErr.message}`);
      }
    }
    console.log(
      `\x1b[32m✓\x1b[0m catalog seeded    ${(starter.works ?? []).length} works, ${parts.length} parts`,
    );
  }
}

/* ---------- 5. verify, rather than assume ---------- */
// Reading it back through the same path the app uses is the difference between
// "the inserts returned no error" and "this account can actually sign in".
const probe = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data: check, error: checkErr } = await probe
  .from('garage_members')
  .select('garage_id, garages(name)')
  .eq('user_id', userId);
if (checkErr || !check?.length) die(`Verification failed: ${checkErr?.message ?? 'no membership found'}`);

console.log('\x1b[32mReady.\x1b[0m Sign in with:');
console.log(`  email     ${email}`);
if (!valued('password')) {
  console.log(`  password  ${password}`);
  console.log('\n  Written down nowhere else. Hand it over, and have them change it.');
}
console.log();
