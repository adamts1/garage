#!/usr/bin/env node
/* List the customer records that look like the same person, and — only when
 * asked in as many words — merge them.
 *
 *   node scripts/duplicate-customers.mjs                       # report, per garage
 *   node scripts/duplicate-customers.mjs --garage-id <uuid>    # one garage
 *   node scripts/duplicate-customers.mjs --merge <a,b,c>       # merge, oldest wins
 *
 * These are the rows left behind by the create_ticket rule this replaces: a
 * ticket with a customer name but no ת״ז and no phone opened a fresh customer
 * every visit, and a phone typed with hyphens one week and without the next
 * made two more. The RPC no longer does either (migrations 20260802000000 and
 * 20260802010000), but nothing has cleaned up what it already wrote.
 *
 * Read the phone groups with the current rule in mind: a number is NOT an
 * identity any more (20260806000000), because a couple, a company and a parent
 * paying for a student's car all answer one line. Two records on one number are
 * a question now, not an answer — and where they carry different ת״ז they are
 * not even a question, so this stops asking it.
 *
 * The report is the whole point. Merging customers is not reversible — tickets,
 * vehicles and invoices are repointed and the losing rows are deleted — so it
 * happens only for ids named explicitly on the command line, never for a group
 * this script decided looked similar. Read the report, decide, then pass the
 * ids. There is no --merge-all and there should not be one: two people who
 * share a name and a garage are not a duplicate, and only you can tell.
 *
 * Runs under the service_role key like the other scripts here: it must see and
 * repoint rows across every garage, which is exactly what RLS is there to stop
 * a client from doing. Loads .env.local (staging); target production the same
 * way as onboard-garage.mjs, by exporting SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY inline.
 *
 * NEVER name the service key VITE_SUPABASE_SERVICE_ROLE_KEY — Vite bakes every
 * VITE_-prefixed variable into the browser bundle, and this key bypasses RLS.
 */

import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env.local ourselves — node does not read .env files, only Vite does.
// Values already in the environment win, so `SUPABASE_URL=… node scripts/…`
// still targets production without editing anything.
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
const garageFilter = args.get('garage-id');
const mergeIds = (args.get('merge') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const die = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
};

if (!url || !serviceKey) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
if (args.has('merge') && mergeIds.length < 2) die('--merge needs at least two comma-separated customer ids.');

/* A service_role key is a full-access credential and the anon key is a plausible
   paste mistake — both are JWTs from the same page, differing only in a claim. */
const looksLikeServiceRole = (key) => {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role';
  } catch {
    return false;
  }
};

if (!looksLikeServiceRole(serviceKey)) {
  die('SUPABASE_SERVICE_ROLE_KEY is not a service_role key — check you did not paste the anon key.');
}

/* The dangerous mistake is a production key with a staging URL, then reading the
   output as if it described the project you meant. */
// The subdomain for a hosted project; the host itself for a local stack, which
// has no ref and would otherwise print as "http://127".
const projectHost = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const projectRef = projectHost.includes('.supabase.') ? projectHost.split('.')[0] : projectHost;
try {
  const keyRef = serviceKey.startsWith('sb_secret_')
    ? null
    : JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url').toString()).ref ?? null;
  if (keyRef && keyRef !== projectRef) {
    die(`Key/URL mismatch: the key belongs to "${keyRef}" but the URL points at "${projectRef}".`);
  }
} catch { /* opaque key: the printed ref below is the only guard */ }

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`\nProject   ${projectRef}`);
console.log(`Scope     ${garageFilter ?? 'all garages'}`);
console.log(`Mode      ${mergeIds.length ? `MERGE ${mergeIds.length} ids` : 'report only (nothing is written)'}\n`);

const digits = (s) => (s ?? '').replace(/\D/g, '');

/* ---------- load ---------- */

let query = db
  .from('customers')
  .select('id,garage_id,name,phone,id_number,email,address,city,created_at')
  .order('created_at', { ascending: true });
if (garageFilter) query = query.eq('garage_id', garageFilter);

const { data: customers, error } = await query;
if (error) die(`Could not read customers: ${error.message}`);
if (!customers.length) die('No customers found for that scope.');

/* Ticket and vehicle counts, so the report can say what is actually attached to
   each row — a duplicate with fifty tickets is not the one to delete. */
const counts = async (table) => {
  const { data, error: err } = await db.from(table).select('customer_id').not('customer_id', 'is', null);
  if (err) die(`Could not read ${table}: ${err.message}`);
  const byId = new Map();
  for (const row of data) byId.set(row.customer_id, (byId.get(row.customer_id) ?? 0) + 1);
  return byId;
};
const ticketCount = await counts('tickets');
const vehicleCount = await counts('vehicles');

const describe = (c) =>
  `${c.id}  ${(c.name ?? '').padEnd(22)} ${(c.phone ?? '—').padEnd(14)} ` +
  `ת״ז ${(c.id_number ?? '—').padEnd(11)} ` +
  `${ticketCount.get(c.id) ?? 0} כרטיסים, ${vehicleCount.get(c.id) ?? 0} רכבים  ` +
  `${(c.created_at ?? '').slice(0, 10)}`;

/* ---------- merge, if that is what was asked for ---------- */

if (mergeIds.length) {
  const rows = mergeIds.map((id) => {
    const found = customers.find((c) => c.id === id);
    if (!found) die(`No customer ${id} in ${projectRef}${garageFilter ? ' (within --garage-id)' : ''}.`);
    return found;
  });

  const garages = new Set(rows.map((r) => r.garage_id));
  if (garages.size > 1) {
    die('Those customers belong to different garages. Merging across garages is never right — check the ids.');
  }

  // Oldest wins: it is the one the garage has been living with, and the one
  // most likely to be referenced from anything outside this database.
  const [keep, ...drop] = rows;

  console.log('Keeping:');
  console.log(`  ${describe(keep)}`);
  console.log('\nMerging into it and then deleting:');
  for (const d of drop) console.log(`  ${describe(d)}`);

  const answer = await (async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question('\nThis cannot be undone. Type MERGE to proceed: ');
    rl.close();
    return a.trim();
  })();
  if (answer !== 'MERGE') die('Aborted. Nothing was written.');

  const dropIds = drop.map((d) => d.id);

  /* Fill the survivor's blanks from the rows being dropped before they go —
     the duplicate often holds the phone or the ת״ז that the original lacks,
     which is why it became a duplicate in the first place. Never overwrite a
     value the survivor already has. */
  const patch = {};
  for (const field of ['phone', 'id_number', 'email', 'address', 'city']) {
    if (keep[field]) continue;
    const donor = drop.find((d) => d[field]);
    if (donor) patch[field] = donor[field];
  }
  if (Object.keys(patch).length) {
    const { error: err } = await db.from('customers').update(patch).eq('id', keep.id);
    if (err) die(`Could not fill the survivor's blanks: ${err.message}`);
    console.log(`\x1b[32m✓\x1b[0m filled from the duplicates: ${Object.keys(patch).join(', ')}`);
  }

  /* Tickets first, vehicles second, customers last: repoint everything that
     references a row before deleting it. tickets.customer_id is ON DELETE SET
     NULL and vehicles.customer_id is ON DELETE CASCADE — deleting first would
     quietly orphan the tickets and destroy the cars. */
  {
    const { error: err, count } = await db
      .from('tickets')
      .update({ customer_id: keep.id }, { count: 'exact' })
      .in('customer_id', dropIds);
    if (err) die(`Could not repoint the tickets: ${err.message}`);
    console.log(`\x1b[32m✓\x1b[0m ${count ?? 0} tickets repointed`);
  }

  /* A vehicle is unique on (customer_id, plate), so a plate the survivor
     already has would collide. Those rows are dropped rather than moved: the
     survivor's row is the same car, and it is the one the tickets now point at. */
  {
    const { data: keepVehicles, error: kErr } = await db
      .from('vehicles').select('plate').eq('customer_id', keep.id);
    if (kErr) die(`Could not read the survivor's vehicles: ${kErr.message}`);
    const held = new Set((keepVehicles ?? []).map((v) => v.plate));

    const { data: moving, error: mErr } = await db
      .from('vehicles').select('id,plate').in('customer_id', dropIds);
    if (mErr) die(`Could not read the duplicates' vehicles: ${mErr.message}`);

    const collide = (moving ?? []).filter((v) => held.has(v.plate)).map((v) => v.id);
    const move = (moving ?? []).filter((v) => !held.has(v.plate)).map((v) => v.id);

    if (move.length) {
      const { error: err } = await db.from('vehicles').update({ customer_id: keep.id }).in('id', move);
      if (err) die(`Could not repoint the vehicles: ${err.message}`);
    }
    if (collide.length) {
      const { error: err } = await db.from('vehicles').delete().in('id', collide);
      if (err) die(`Could not drop the duplicate vehicle rows: ${err.message}`);
    }
    console.log(`\x1b[32m✓\x1b[0m ${move.length} vehicles repointed, ${collide.length} duplicate plates dropped`);
  }

  {
    const { error: err } = await db.from('customers').delete().in('id', dropIds);
    if (err) die(`Could not delete the merged customers: ${err.message}`);
    console.log(`\x1b[32m✓\x1b[0m ${dropIds.length} customer records deleted`);
  }

  console.log(`\n\x1b[32mMerged into ${keep.id}.\x1b[0m\n`);
  process.exit(0);
}

/* ---------- report ---------- */

/* Two groupings, because the two causes leave different fingerprints — and
   neither is a verdict, which is why nothing here merges on its own.

   The phone groups used to be described as near-certain. They are not, and were
   only ever near-certain under the rule that one number meant one customer; a
   household and a fleet break it honestly. What survives below is "one number,
   several records" — worth reading, not worth merging unread. Records that hold
   DIFFERENT ת״ז are dropped from the report outright: the database keeps that
   number unique per garage, so two of them are two people, and no amount of
   shared telephone makes them one. */
const byPhone = new Map();
const byName = new Map();
for (const c of customers) {
  const d = digits(c.phone);
  if (d.length >= 7) {
    const key = `${c.garage_id}|${d}`;
    byPhone.set(key, [...(byPhone.get(key) ?? []), c]);
    continue;
  }
  // A ת״ז makes a record identifiable, so it is not one of these leftovers —
  // and two rows with *different* ת״ז are two different people who share a
  // name, which is precisely the case §3.6 exists to keep apart.
  if (c.id_number) continue;
  const key = `${c.garage_id}|${(c.name ?? '').trim()}`;
  if (key.endsWith('|')) continue;   // nameless and phoneless: nothing to group on
  byName.set(key, [...(byName.get(key) ?? []), c]);
}

/** Two distinct ת״ז in one group: known-different people, whatever the number. */
const holdsDifferentIdNumbers = (g) =>
  new Set(g.map((c) => (c.id_number ?? '').trim()).filter(Boolean)).size > 1;

const phoneCandidates = [...byPhone.values()].filter((g) => g.length > 1);
const phoneGroups = phoneCandidates.filter((g) => !holdsDifferentIdNumbers(g));
const sharedNumber = phoneCandidates.length - phoneGroups.length;
const nameGroups = [...byName.values()].filter((g) => g.length > 1);

const report = (title, groups, note) => {
  console.log(`\x1b[1m${title}\x1b[0m  (${groups.length})`);
  if (note) console.log(`${note}`);
  if (!groups.length) { console.log('  none\n'); return; }
  for (const g of groups) {
    console.log(`\n  garage ${g[0].garage_id}`);
    for (const c of g) console.log(`    ${describe(c)}`);
    console.log(`    → merge with: --merge ${g.map((c) => c.id).join(',')}`);
  }
  console.log('');
};

report(
  'Same phone, several records',
  phoneGroups,
  '  Candidates only. A number is shared by a couple, a company and a parent\n' +
  '  paying for a student\'s car — read the tickets before merging anything.',
);
if (sharedNumber) {
  console.log(
    `  (${sharedNumber} group(s) on one number carry different ת״ז and are not listed:\n` +
    '   the ת״ז is unique per garage, so those are different people.)\n',
  );
}
report(
  'Same name, no phone on file',
  nameGroups,
  '  Candidates only — a garage can have two customers with one name. Check the\n' +
  '  tickets before merging.',
);

const total = phoneGroups.length + nameGroups.length;
console.log(
  total
    ? `${total} group(s) to look at. Nothing was written — pass --merge with the ids you want joined.\n`
    : 'No duplicate groups found.\n',
);
