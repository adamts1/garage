#!/usr/bin/env node
/* Put a demo board into a garage: customers, their cars, and tickets.
 *
 *   npm run seed:board -- --garage "שרון"                # dry run
 *   npm run seed:board -- --garage "שרון" --yes
 *   npm run seed:board:prod -- --id <uuid> --append --yes
 *
 * WHAT IT WRITES
 *
 *   customers, vehicles          the people and the cars a ticket needs
 *   tickets, works, work_items   the board itself
 *   garage_counters              raised past the keys this run used
 *
 * The customers come with it rather than from a script of their own, because a
 * ticket carries a customer_id and there is no such thing as half a board. The
 * catalogue does not: that is seed-catalog.mjs. A ticket's works and parts are
 * copies of catalogue rows, not references to them, so this runs perfectly well
 * against a garage whose catalogue is its own — which is the usual case, and
 * the reason the two are separate commands.
 *
 * MODES
 *
 *   default    The garage must have no board yet. Tickets are numbered from
 *              101, which reads better on a demo screen than starting at one.
 *
 *   --append   Keep what is there and add what is missing. A customer already
 *              on file is matched and reused rather than duplicated, a car is
 *              matched on plate, and numbering continues from garage_counters
 *              so the demo lands after the real tickets instead of in a block
 *              above them: a garage on GAR-4 gets GAR-5 onwards.
 *
 *              This is also the mode for a garage whose tickets were cleared
 *              but whose customers were kept — every customer matches, nothing
 *              is duplicated, and only the board is written.
 *
 * WHAT IT NEVER TOUCHES
 *
 *   garage_workers   Real staff, each row binding a real login. The demo's
 *                    invented assignees are mapped onto whoever is actually
 *                    here instead, in position order.
 *
 *   invoices, and any ticket already on file. An issued invoice is a tax
 *                    document; this script has no reason to read one and no
 *                    means of changing one.
 *
 * Additive only: no DELETE, no UPDATE to operational data, plus one upsert of
 * the ticket counter. Safe to point at production.
 *
 * Runs under the service_role key, which bypasses RLS. Every row carries an
 * explicit garage_id because the column's default, current_garage_id(), reads a
 * JWT this client does not have.
 */

import { CUSTOMERS, TICKETS, amountOf, due, iso, work } from './demo-data.mjs';
import { connect, die, guardEmpty, insert, parseArgs, resolveGarage, skipped, stopUnlessConfirmed } from './seed-lib.mjs';

const args = parseArgs(process.argv.slice(2), ['garage', 'id', 'append', 'yes']);
const APPEND = args.has('append');
const CONFIRMED = args.has('yes');

const db = connect();
console.log(`mode    : ${APPEND ? 'append — existing rows are kept and worked around' : 'no board yet'}`);
const garage = await resolveGarage(db, { name: args.get('garage'), id: args.get('id') });
const G = garage.id;

/* invoices is in the list and is never written: a garage that has billed a
   customer is a garage in business, whatever else is empty. */
await guardEmpty(db, G, ['customers', 'vehicles', 'tickets', 'works', 'work_items', 'invoices'], {
  append: APPEND,
  label: 'a board',
});

/* ---------------- who the tickets go to ----------------

   TICKETS name invented staff, and tickets.assignee is a foreign key to
   garage_workers.code — codes this garage has never heard of. So they are
   mapped onto the workers actually here, in position order, round-robin. An
   unassigned ticket stays unassigned, and a garage with no staff at all gets a
   board with no assignees rather than a failed insert. */

const { data: staff, error: wErr } = await db.from('garage_workers')
  .select('code, name, position').eq('garage_id', G).eq('active', true).order('position');
if (wErr) die(wErr.message);

const demoCodes = [...new Set(TICKETS.map((t) => t.who).filter(Boolean))];
const assigneeOf = (who) => (who && staff.length ? staff[demoCodes.indexOf(who) % staff.length].code : null);
console.log(staff.length
  ? `staff   : ${staff.length} existing worker(s) — ${staff.map((s) => s.name).join(', ')}`
  : 'staff   : none — tickets will be left unassigned');

/* ---------------- what is already on file ---------------- */

const existing = { plates: new Set(), customers: [] };
if (APPEND) {
  const { data: cust } = await db.from('customers').select('id, name, phone, id_number').eq('garage_id', G);
  const { data: veh } = await db.from('vehicles').select('plate').eq('garage_id', G);
  existing.customers = cust ?? [];
  veh?.forEach((r) => existing.plates.add(r.plate));
}

/* A demo customer is "already here" if a real row holds their ת״ז — which the
   unique index makes an identity — or, failing that, their name and phone
   together. Name alone is not enough: two people share one. */
const matchCustomer = (c) => existing.customers.find((x) =>
  (c.id_number && x.id_number === c.id_number) ||
  (x.name === c.name && (x.phone ?? null) === (c.phone ?? null)));

const newCustomers = CUSTOMERS.filter((c) => !matchCustomer(c));
const newVehicles = CUSTOMERS.flatMap((c) => c.cars
  .filter((v) => !existing.plates.has(v.plate))
  .map((v) => ({ ...v, ref: c.ref })));

/* ---------------- ticket numbering ----------------

   A fresh board gets the demo's own 101 onwards. Appending continues from the
   counter, so the demo lands after whatever is already there. */

const { data: counter } = await db.from('garage_counters')
  .select('last_ticket, last_job').eq('garage_id', G).maybeSingle();
const base = APPEND ? Math.max(counter?.last_ticket ?? 0, counter?.last_job ?? 0) : 0;
const numberOf = (t, i) => (base ? base + i + 1 : t.n);
const lastNumber = numberOf(TICKETS.at(-1), TICKETS.length - 1);

/* ---------------- the plan ---------------- */

console.log('\nwill insert:');
console.log(`  ${String(newCustomers.length).padStart(4)}  customers${skipped(CUSTOMERS, newCustomers, 'on file')}`);
console.log(`  ${String(newVehicles.length).padStart(4)}  vehicles`);
console.log(`  ${String(TICKETS.length).padStart(4)}  tickets   (GAR-${numberOf(TICKETS[0], 0)} … GAR-${lastNumber})`);
console.log(`  ${String(TICKETS.reduce((n, t) => n + t.works.length, 0)).padStart(4)}  works`);
console.log('     0  catalogue rows   (that is seed-catalog)');
console.log('     0  deletes, 0 updates to existing rows');

stopUnlessConfirmed(CONFIRMED);

/* ---------------- customers and their cars ---------------- */

const inserted = await insert(db, 'customers', newCustomers.map((c) => ({
  garage_id: G, name: c.name, phone: c.phone, kind: c.kind, city: c.city,
  address: c.address, email: c.email ?? null, id_number: c.id_number ?? null,
})));

/* ref -> id, drawn from whichever row now holds that customer: the one this run
   created, or the one already on file. A ticket must attach to the real record,
   not to a second copy of it.

   Matched back by name and phone rather than by position: nothing promises an
   insert returns its rows in the order they were sent. */
const insertedByRef = Object.fromEntries(newCustomers.map((c) =>
  [c.ref, inserted.find((r) => r.name === c.name && (r.phone ?? null) === (c.phone ?? null)).id]));
const custIdByRef = Object.fromEntries(CUSTOMERS.map((c) =>
  [c.ref, insertedByRef[c.ref] ?? matchCustomer(c).id]));

await insert(db, 'vehicles', newVehicles.map((v) => {
  const { ref, ...car } = v;
  return { ...car, garage_id: G, customer_id: custIdByRef[ref] };
}));
console.log(`customers: ${inserted.length}, vehicles: ${newVehicles.length}`);

/* ---------------- the board ---------------- */

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

const tickets = await insert(db, 'tickets', rows);
const ticketIdByKey = Object.fromEntries(tickets.map((t) => [t.key, t.id]));

const workRows = [];
for (const [key, works] of worksByKey) {
  works.forEach((w, i) => workRows.push({
    garage_id: G, ticket_id: ticketIdByKey[key], uid: w.uid, code: w.code,
    name: w.name, labor: w.labor, custom: w.custom, position: i,
  }));
}
const savedWorks = await insert(db, 'works', workRows);

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
await insert(db, 'work_items', partRows);
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

function count(rows, status) { return rows.filter((r) => r.status === status).length; }
