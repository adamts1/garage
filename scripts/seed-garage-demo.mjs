#!/usr/bin/env node
/* Put the demo board into a garage. Additive only, production included.
 *
 *   npm run seed:garage:prod -- --garage "שרון"                    # dry run
 *   npm run seed:garage:prod -- --garage "שרון" --yes
 *   npm run seed:garage:prod -- --garage "prod-test" --append --yes
 *
 * WHY THIS EXISTS ALONGSIDE seed-demo.mjs
 *
 * seed-demo wipes a garage and rebuilds it, which is why it refuses production
 * outright: the distance between refreshing a demo and destroying a paying
 * garage's customer list is one wrong --env-file. This script cannot do that.
 * It issues no DELETE and no UPDATE against operational data — every statement
 * is an INSERT, plus one upsert of the ticket counter.
 *
 * TWO MODES
 *
 *   default    The garage must be EMPTY. A garage with a single customer,
 *              ticket, part or invoice in it is one somebody is using, and this
 *              refuses it. Tickets are numbered from 101, as seed-demo does.
 *
 *   --append   For a garage that already has rows: a scratch or test garage
 *              that wants a fuller board without losing what is in it. Nothing
 *              already there is touched. Demo rows that would collide with a
 *              real one are skipped instead — see COLLISIONS.
 *
 * COLLISIONS, in --append
 *
 *   items(garage_id, sku), work_defs(garage_id, code) and
 *   customers(garage_id, id_number) are unique, so a demo row whose key is
 *   already taken is dropped rather than inserted; the ticket that needed it
 *   attaches to the row already on file. Vehicles are matched on plate the same
 *   way, though nothing in the schema forces it — two records of one car is
 *   still a mess on the screen.
 *
 *   tickets(garage_id, key) is unique too, and the demo's 101…114 would sit
 *   above real tickets rather than after them. So in --append the numbering
 *   continues from garage_counters instead: a garage on GAR-4 gets GAR-5…GAR-18.
 *
 * WHAT IT NEVER TOUCHES
 *
 *   garage_workers   Real staff, each row carrying a user_id that binds a real
 *                    login. seed-demo renames these because on a scratch
 *                    project they are scratch rows; here they are the garage
 *                    owner and their mechanics, and demo tickets get mapped
 *                    onto whoever is actually there instead.
 *
 *   tickets, works and invoices that are already there. An issued invoice is a
 *                    tax document; this script has no reason to read one and no
 *                    means of changing one.
 *
 * Runs under the service_role key, which bypasses RLS. Every row is written
 * with an explicit garage_id because the column's default, current_garage_id(),
 * reads a JWT this client does not have.
 */

import { createClient } from '@supabase/supabase-js';
import { CATALOG, CUSTOMERS, PARTS, TICKETS, amountOf, due, iso, partBySku, work } from './demo-data.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const GARAGE_NAME = flag('garage');
const GARAGE_ID = flag('id');
const CONFIRMED = args.includes('--yes');
const APPEND = args.includes('--append');

if (!GARAGE_NAME && !GARAGE_ID) {
  console.error('usage: (--garage "<name>" | --id <uuid>) [--append] [--yes]');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — run through npm, which passes --env-file.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const PRODUCTION_PROJECT_REF = 'fdztfosbohiwskzfvwaj';
console.log(`project : ${url}${url.includes(PRODUCTION_PROJECT_REF) ? '   ← PRODUCTION' : ''}`);
console.log(`mode    : ${APPEND ? 'append — existing rows are kept and worked around' : 'empty garage only'}`);

/* A uuid identifies exactly; a name has to be unique among garages to mean
   anything, and the operator gets told which one they hit either way. */
const q = db.from('garages').select('id, name');
const { data: garages, error: gErr } = await (GARAGE_ID ? q.eq('id', GARAGE_ID) : q.eq('name', GARAGE_NAME));
if (gErr) die(gErr.message);
if (!garages?.length) die(`no garage ${GARAGE_ID ? GARAGE_ID : `named "${GARAGE_NAME}"`} in this project`);
if (garages.length > 1) die(`${garages.length} garages share that name — refusing to guess`);
const G = garages[0].id;
console.log(`garage  : ${garages[0].name}  [${G}]\n`);

/* ---------------- the guard ----------------

   Every table this script writes, plus invoices — which it does not write, but
   whose presence means this garage has billed a customer. Outside --append one
   non-zero count and nothing happens. */

const MUST_BE_EMPTY = ['customers', 'vehicles', 'tickets', 'works', 'work_items',
  'items', 'work_defs', 'work_def_items', 'invoices'];

const found = [];
for (const t of MUST_BE_EMPTY) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true }).eq('garage_id', G);
  if (error) die(`${t}: ${error.message}`);
  if (count) found.push([t, count]);
}
if (found.length && !APPEND) {
  console.error('✗ this garage is not empty — refusing to add demo data to a garage in use:\n');
  for (const [t, n] of found) console.error(`    ${String(n).padStart(5)}  ${t}`);
  console.error('\nSeeding on top would leave real rows and demo rows indistinguishable.');
  console.error('If that is what you want anyway, re-run with --append: existing rows are');
  console.error('then kept, and demo rows that would collide with them are skipped.');
  process.exit(1);
}
if (!found.length) console.log('guard   : empty — no customers, tickets, parts or invoices\n');
else {
  console.log('already here (none of it will be changed):');
  for (const [t, n] of found) console.log(`  ${String(n).padStart(5)}  ${t}`);
  console.log();
}

/* ---------------- who the tickets go to ----------------

   TICKETS name seed-demo's invented staff, and tickets.assignee is a foreign
   key to garage_workers.code — codes this garage has never heard of. So the
   demo codes are mapped onto the workers that are actually here, in position
   order, round-robin. An unassigned ticket in the data stays unassigned, and a
   garage with no workers at all gets a board with no assignees rather than a
   failed insert. */

const { data: staff, error: wErr } = await db.from('garage_workers')
  .select('code, name, position').eq('garage_id', G).eq('active', true).order('position');
if (wErr) die(wErr.message);

const demoCodes = [...new Set(TICKETS.map((t) => t.who).filter(Boolean))];
const assigneeOf = (who) => {
  if (!who || !staff.length) return null;
  return staff[demoCodes.indexOf(who) % staff.length].code;
};
console.log(staff.length
  ? `staff   : ${staff.length} existing worker(s) — ${staff.map((s) => s.name).join(', ')}`
  : 'staff   : none — tickets will be left unassigned');

/* ---------------- what is already on file ----------------

   Read once, up front, so the plan printed by a dry run is the plan that runs.
   Outside --append these all come back empty and every filter below is a no-op. */

const existing = { skus: new Set(), codes: new Set(), ids: new Set(), plates: new Set(), customers: [] };
if (APPEND) {
  const { data: exItems } = await db.from('items').select('sku').eq('garage_id', G);
  const { data: exDefs } = await db.from('work_defs').select('code').eq('garage_id', G);
  const { data: exCust } = await db.from('customers').select('id, name, phone, id_number').eq('garage_id', G);
  const { data: exVeh } = await db.from('vehicles').select('plate').eq('garage_id', G);
  exItems?.forEach((r) => existing.skus.add(r.sku));
  exDefs?.forEach((r) => existing.codes.add(r.code));
  exVeh?.forEach((r) => existing.plates.add(r.plate));
  existing.customers = exCust ?? [];
  exCust?.forEach((r) => r.id_number && existing.ids.add(r.id_number));
}

/* A demo customer is "already here" if a real row holds their ת״ז — which the
   unique index makes an identity — or, failing that, their name and phone
   together. Name alone is not enough: two people share one. */
const matchCustomer = (c) => existing.customers.find((x) =>
  (c.id_number && x.id_number === c.id_number) ||
  (x.name === c.name && (x.phone ?? null) === (c.phone ?? null)));

const newParts = PARTS.filter((p) => !existing.skus.has(p.sku));
const newDefs = CATALOG.filter((w) => !existing.codes.has(w.code));
const newCustomers = CUSTOMERS.filter((c) => !matchCustomer(c));
const newVehicles = CUSTOMERS.flatMap((c) => c.cars
  .filter((v) => !existing.plates.has(v.plate))
  .map((v) => ({ ...v, ref: c.ref })));

/* ---------------- ticket numbering ----------------

   Empty garage: the demo's own 101…114, which reads better than starting at
   one. Appending: straight on from the counter, so the demo lands after the
   real tickets rather than in a block above them. */

const { data: counter } = await db.from('garage_counters')
  .select('last_ticket, last_job').eq('garage_id', G).maybeSingle();
const base = APPEND ? Math.max(counter?.last_ticket ?? 0, counter?.last_job ?? 0) : 0;
const numberOf = (t, i) => (base ? base + i + 1 : t.n);
const lastNumber = numberOf(TICKETS.at(-1), TICKETS.length - 1);

/* ---------------- the plan ---------------- */

const skipped = (all, kept, what) =>
  all.length === kept.length ? '' : `   (${all.length - kept.length} ${what} already here, skipped)`;

console.log('\nwill insert:');
console.log(`  ${String(newParts.length).padStart(4)}  items${skipped(PARTS, newParts, 'skus')}`);
console.log(`  ${String(newDefs.length).padStart(4)}  work_defs${skipped(CATALOG, newDefs, 'codes')}`);
console.log(`  ${String(newDefs.reduce((n, w) => n + w.parts.length, 0)).padStart(4)}  work_def_items`);
console.log(`  ${String(newCustomers.length).padStart(4)}  customers${skipped(CUSTOMERS, newCustomers, 'on file')}`);
console.log(`  ${String(newVehicles.length).padStart(4)}  vehicles`);
console.log(`  ${String(TICKETS.length).padStart(4)}  tickets   (GAR-${numberOf(TICKETS[0], 0)} … GAR-${lastNumber})`);
console.log(`  ${String(TICKETS.reduce((n, t) => n + t.works.length, 0)).padStart(4)}  works`);
console.log('     0  deletes, 0 updates to existing rows');

if (!CONFIRMED) {
  console.log('\nDry run. Re-run with --yes to actually do it.');
  process.exit(0);
}

console.log('\ninserting…');

/* ---------------- catalogue ---------------- */

await insert('items', newParts.map((p) => ({ ...p, garage_id: G })));

const defs = await insert('work_defs', newDefs.map((w, i) => ({
  garage_id: G, code: w.code, name: w.name, labor: w.labor, hours: w.hours, position: i,
})));
const defIdByCode = Object.fromEntries(defs.map((d) => [d.code, d.id]));

/* Only for definitions this run created. A catalogue entry already on file
   belongs to the garage, and its parts list is not ours to add to. */
await insert('work_def_items', newDefs.flatMap((w) =>
  w.parts.map(([sku, qty], i) => ({
    work_def_id: defIdByCode[w.code], garage_id: G, sku,
    name: partBySku[sku].name, qty, price: partBySku[sku].price, position: i,
  }))));
console.log(`catalogue: ${defs.length} works, ${newParts.length} parts`);

/* ---------------- customers and their cars ---------------- */

const inserted = await insert('customers', newCustomers.map((c) => ({
  garage_id: G, name: c.name, phone: c.phone, kind: c.kind, city: c.city,
  address: c.address, email: c.email ?? null, id_number: c.id_number ?? null,
})));

/* ref -> id, drawn from whichever row now holds that customer: the one this run
   created, or the one that was already on file. A ticket must attach to the
   real record, not to a second copy of it. */
/* Matched back by name rather than by position: nothing promises an insert
   returns its rows in the order they were sent, and the demo names are distinct. */
const insertedByRef = Object.fromEntries(newCustomers.map((c) =>
  [c.ref, inserted.find((r) => r.name === c.name && (r.phone ?? null) === (c.phone ?? null)).id]));
const custIdByRef = Object.fromEntries(CUSTOMERS.map((c) =>
  [c.ref, insertedByRef[c.ref] ?? matchCustomer(c).id]));

await insert('vehicles', newVehicles.map((v) => {
  const { ref, ...car } = v;
  return { ...car, garage_id: G, customer_id: custIdByRef[ref] };
}));
console.log(`customers: ${inserted.length}, vehicles: ${newVehicles.length}`);

/* ---------------- tickets ---------------- */

const now = new Date().toISOString();
const rows = [];
const worksByKey = new Map();

TICKETS.forEach((t, i) => {
  const c = CUSTOMERS.find((x) => x.ref === t.cust);
  const car = c.cars[t.car];
  const works = t.works.map((code, j) => work(code, `w${j + 1}`));
  const settled = t.st === 'paid';
  const finished = settled || t.st === 'done';
  const n = numberOf(t, i);
  const key = `GAR-${n}`;
  worksByKey.set(key, works);

  rows.push({
    garage_id: G,
    key, job: `W-${n}`,
    status: t.st, type: 'job', epic: t.epic, priority: t.prio,
    assignee: assigneeOf(t.who), points: Math.min(8, Math.max(1, works.length * 3)),
    title: works.map((w) => w.name).join(' + '),
    plate: car.plate,
    car: [car.manufacturer, car.model, car.year].filter(Boolean).join(' '),
    customer_id: custIdByRef[t.cust],
    customer_name: c.name,
    phone: c.phone, email: c.email ?? null,
    address: [c.address, c.city].filter(Boolean).join(', '),
    id_number: c.id_number ?? null,
    km: car.km, year: car.year, vehicle_code: car.vehicle_code,
    amount: amountOf(works),
    /* The progress bar counts finished subtasks, and a subtask is a work. */
    done: finished ? works.length : (t.doneWorks ?? 0),
    subtasks: works.map((w) => w.name),
    due: due(t.due),
    flags: t.st === 'todo' ? ['key_received', 'new'] : ['key_received'],
    blocked: t.blocked ?? null,
    notes: t.notes ?? null,
    paid: settled,
    pay_method: settled ? t.payMethod : null,
    /* stamp_paid_at coalesces on INSERT rather than overwriting, so a
       back-dated paid_at survives and these age into the archive as intended. */
    paid_at: settled ? (t.paidToday ? now : iso(t.paidOn)) : null,
    created_at: iso(t.created),
    updated_at: iso(t.due),
  });
});

const tickets = await insert('tickets', rows);
const ticketIdByKey = Object.fromEntries(tickets.map((t) => [t.key, t.id]));

const workRows = [];
for (const [key, works] of worksByKey) {
  works.forEach((w, i) => workRows.push({
    garage_id: G, ticket_id: ticketIdByKey[key], uid: w.uid, code: w.code,
    name: w.name, labor: w.labor, custom: w.custom, position: i,
  }));
}
const savedWorks = await insert('works', workRows);

/* Match each saved work back to its parts by (ticket, uid) — the pair the app
   itself treats as a work's identity within a ticket. */
const keyById = Object.fromEntries(Object.entries(ticketIdByKey).map(([k, id]) => [id, k]));
const partRows = [];
for (const sw of savedWorks) {
  const src = worksByKey.get(keyById[sw.ticket_id]).find((w) => w.uid === sw.uid);
  src.items.forEach((p, i) => partRows.push({
    garage_id: G, work_id: sw.id, sku: p.sku, name: p.name, qty: p.qty, price: p.price, position: i,
  }));
}
await insert('work_items', partRows);
console.log(`tickets  : ${rows.length} (${count(rows, 'todo')} todo, ${count(rows, 'appr')} appr, ${count(rows, 'done')} done, ${count(rows, 'paid')} paid)`);
console.log(`           ${savedWorks.length} works, ${partRows.length} parts`);

/* ---------------- the counter ----------------

   create_ticket takes the next number from here, so leaving it behind hands the
   next real ticket a key one of these already holds. Raised, never lowered:
   winding it back would reissue keys that a deleted ticket's paperwork may
   still name. */

const nextLast = Math.max(lastNumber, counter?.last_ticket ?? 0);
const nextJob = Math.max(lastNumber, counter?.last_job ?? 0);
const { error: cErr } = await db.from('garage_counters')
  .upsert({ garage_id: G, last_ticket: nextLast, last_job: nextJob }, { onConflict: 'garage_id' });
if (cErr) die(`garage_counters: ${cErr.message}`);
console.log(`counter  : next ticket is GAR-${nextLast + 1}`);

console.log('\ndone.');

/* ---------------- helpers ---------------- */

function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

function count(rows, status) { return rows.filter((r) => r.status === status).length; }

async function insert(table, values) {
  if (!values.length) return [];
  const { data, error } = await db.from(table).insert(values).select();
  if (error) die(`${table}: ${error.message}`);
  return data;
}
