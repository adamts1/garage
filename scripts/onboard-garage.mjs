#!/usr/bin/env node
/* Create a garage and its first user, in one step.
 *
 *   node scripts/onboard-garage.mjs --garage "מוסך הרצל" --email avi@example.com
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

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

// VITE_SUPABASE_URL is a fine fallback: the project URL is already public, it
// ships in the browser bundle and the APK. Only the *key* must never carry a
// VITE_ prefix.
const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const garageName = args.get('garage');
const email = args.get('email')?.trim().toLowerCase();
// Supplying a password is for tests. Leave it out and one is generated, which
// is what you want for a real garage — it is printed once and not stored.
const password = args.get('password') ?? randomBytes(9).toString('base64url');
const existingGarageId = args.get('garage-id');

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (!email) die('Missing --email');
if (!garageName && !existingGarageId) die('Missing --garage (or --garage-id to join an existing one)');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`Not an email address: ${email}`);

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
console.log(`User     ${email}\n`);

/* ---------- 1. the garage ---------- */
let garageId = existingGarageId;
if (!garageId) {
  const { data, error } = await db
    .from('garages')
    .insert({ name: garageName })
    .select('id')
    .single();
  if (error) die(`Could not create the garage: ${error.message}`);
  garageId = data.id;
  console.log(`\x1b[32m✓\x1b[0m garage created   ${garageId}`);
} else {
  const { data, error } = await db.from('garages').select('id,name').eq('id', garageId).single();
  if (error || !data) die(`No garage with id ${garageId}`);
  console.log(`\x1b[32m✓\x1b[0m garage found     ${data.name}`);
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
const { error: memberErr } = await db
  .from('garage_members')
  .upsert({ garage_id: garageId, user_id: userId }, { onConflict: 'garage_id,user_id' });
if (memberErr) die(`User and garage exist but could not be linked: ${memberErr.message}`);
console.log(`\x1b[32m✓\x1b[0m membership linked\n`);

/* ---------- 4. verify, rather than assume ---------- */
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
if (!args.get('password')) {
  console.log(`  password  ${password}`);
  console.log('\n  Written down nowhere else. Hand it over, and have them change it.');
}
console.log();
