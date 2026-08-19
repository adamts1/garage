#!/usr/bin/env node
/* Wipe a garage's operational data and replace it with a demo set.
 *
 *   npm run seed:demo -- --garage "מוסך אדם" --yes
 *
 * Without --yes it only prints what it would delete, which is the point: this
 * removes every customer, vehicle, ticket, work, part, catalogue entry and
 * supplier belonging to one garage, and none of it comes back.
 *
 * WHAT IT NEVER TOUCHES
 *
 *   garages, garage_members, garage_billing, garage_billing_secrets
 *     Deleting a membership locks the operator out of the garage they were
 *     demoing, with the service_role key as the only way back in.
 *
 *   garage_workers
 *     Renamed in place, never deleted — each row carries a user_id linking a
 *     real login, and tickets.assignee is a foreign key to its `code`.
 *
 *   invoices
 *     Cannot be deleted at all: invoices_are_immutable() raises on DELETE for
 *     every role, service_role included, because a tax document is not ours to
 *     retract. Demo tickets therefore start at GAR-101, above every ticket_key
 *     any existing invoice refers to, so no leftover document attaches itself
 *     to a demo ticket that has nothing to do with it.
 *
 *   the tickets those invoices point at
 *     Undeletable for the same reason once removed: invoices.ticket_id is ON
 *     DELETE SET NULL, and setting it fires an UPDATE that the immutability
 *     trigger rejects. So they are rewritten in place instead — see LEGACY,
 *     where each is given work that prices to exactly the document already
 *     issued against it, and parked in the archive.
 *
 * Runs under the service_role key, which bypasses RLS. Every row is written
 * with an explicit garage_id because the column's default, current_garage_id(),
 * reads a JWT this client does not have.
 */

import { createClient } from '@supabase/supabase-js';

/* The board itself. Shared with seed-board.mjs, which writes the same set
   into an empty garage instead of over an existing one. */
import { CATALOG, CUSTOMERS, PARTS, PAY, TICKETS, amountOf, due, iso, partBySku, work } from './demo-data.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const GARAGE_NAME = flag('garage');
const CONFIRMED = args.includes('--yes');

if (!GARAGE_NAME) {
  console.error('usage: --garage "<name>" [--yes]');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — run through npm, which passes --env-file.');
  process.exit(1);
}

/* Demo data is for local and staging. Never production — see supabase/README.md.
 *
 * This is the most destructive script in the repo: it empties ten tables for the
 * named garage and writes a made-up board over the top, with a service_role key
 * that no policy can stop. The garage is named on the command line, so the whole
 * distance between a demo refresh and a real garage losing its customers, works
 * catalogue and parts list is one wrong --env-file. */
const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';
if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error(
    `\nRefusing to run: this is PRODUCTION (${PRODUCTION_PROJECT_REF}).\n` +
      'seed-demo wipes a garage and writes demo data over it. There is no flag for this.\n',
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

console.log(`project : ${url}`);
console.log(`garage  : ${GARAGE_NAME}`);

const { data: garages, error: gErr } = await db.from('garages').select('id, name').eq('name', GARAGE_NAME);
if (gErr) die(gErr.message);
if (!garages?.length) die(`no garage named "${GARAGE_NAME}" in this project`);
if (garages.length > 1) die(`${garages.length} garages share that name — refusing to guess`);
const G = garages[0].id;
console.log(`id      : ${G}\n`);

/* ---------------- what is about to go ---------------- */

const WIPE = ['supplier_expenses', 'suppliers', 'ticket_photos', 'work_items', 'works',
  'vehicles', 'customers', 'work_def_items', 'work_defs', 'items'];

/* Which tickets an invoice still points at. These survive the wipe and are
   rewritten below; everything else on the board goes. */
const { data: invoiceRows, error: iErr } = await db.from('invoices')
  .select('ticket_id, ticket_key').eq('garage_id', G);
if (iErr) die(iErr.message);
const LOCKED = [...new Set(invoiceRows.map((i) => i.ticket_id).filter(Boolean))];

for (const t of WIPE) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true }).eq('garage_id', G);
  if (count) console.log(`  delete ${String(count).padStart(4)}  ${t}`);
}
const { count: allTickets } = await db.from('tickets').select('*', { count: 'exact', head: true }).eq('garage_id', G);
console.log(`  delete ${String((allTickets ?? 0) - LOCKED.length).padStart(4)}  tickets`);
console.log(`  keep   ${String(invoiceRows.length).padStart(4)}  invoices  (immutable — cannot be deleted)`);
console.log(`  rewrite${String(LOCKED.length).padStart(4)}  tickets   (an invoice points at them, so neither can go)`);

if (!CONFIRMED) {
  console.log('\nDry run. Re-run with --yes to actually do it.');
  process.exit(0);
}

/* ---------------- delete ----------------

   In dependency order rather than relying on cascades, so a failure stops on
   the table that refused instead of half-way through a cascade nobody watched.
   supplier_expenses -> suppliers is RESTRICT; the rest cascade from tickets. */

console.log('\ndeleting…');

/* Tickets first, and only the ones no invoice names: works and parts cascade
   from them anyway, but deleting the children explicitly afterwards is what
   clears the rows belonging to the tickets that had to stay. */
const doomed = db.from('tickets').delete().eq('garage_id', G);
const { error: tErr } = await (LOCKED.length ? doomed.not('id', 'in', `(${LOCKED.join(',')})`) : doomed);
if (tErr) die(`tickets: ${tErr.message}`);

for (const t of WIPE) {
  const { error } = await db.from(t).delete().eq('garage_id', G);
  if (error) die(`${t}: ${error.message}`);
}

/* Photo rows are gone; their files are not. Storage is a separate service and
   deleting the objects is a different call — say so rather than leave the
   operator believing the bucket is empty. */
const { data: leftover } = await db.storage.from('ticket-photos').list(G, { limit: 100 }).catch(() => ({ data: null }));
if (leftover?.length) console.log(`  note: ${leftover.length} photo file(s) still in storage under ${G}/`);

/* ---------------- workers ----------------

   Renamed, not replaced. `code` is what tickets.assignee points at and what a
   login is bound to, so it stays exactly as it is; only what a customer would
   see over the advisor's shoulder changes. */

const WORKERS = [
  { code: 'adam-2', name: 'אדם ציטיאט', initials: 'אצ', color: '#3e5c76', position: 1 },
  { code: 'test-1', name: 'רועי בן שמעון', initials: 'רב', color: '#6b4f7a', position: 2 },
  { code: 'sarah-3', name: 'שרה כהן', initials: 'שכ', color: '#4f7a5b', position: 3 },
  { code: 'avi-4', name: 'אבי מזרחי', initials: 'אמ', color: '#748cab', position: 4 },
  { code: 'יוסי-אהר', name: 'יוסי אהרון', initials: 'יא', color: '#a9714b', position: 5 },
];
for (const w of WORKERS) {
  const { name, initials, color, position } = w;
  const { error } = await db.from('garage_workers')
    .update({ name, initials, color, position, active: true })
    .eq('garage_id', G).eq('code', w.code);
  if (error) die(`worker ${w.code}: ${error.message}`);
}
console.log(`workers  : ${WORKERS.length} renamed`);

/* ---------------- catalogue ----------------

   Parts first: a work definition's parts are stored by sku and name, and the
   price a ticket copies comes from here. */

await insert('items', PARTS.map((p) => ({ ...p, garage_id: G })));

/* A work definition and the parts it normally consumes. */
const defs = await insert('work_defs', CATALOG.map((w, i) => ({
  garage_id: G, code: w.code, name: w.name, labor: w.labor, hours: w.hours, position: i,
})));
const defIdByCode = Object.fromEntries(defs.map((d) => [d.code, d.id]));

await insert('work_def_items', CATALOG.flatMap((w) =>
  w.parts.map(([sku, qty], i) => ({
    work_def_id: defIdByCode[w.code], garage_id: G, sku,
    name: partBySku[sku].name, qty, price: partBySku[sku].price, position: i,
  }))));
console.log(`catalogue: ${CATALOG.length} works, ${PARTS.length} parts`);


/* ---------------- customers and their cars ---------------- */

const customers = await insert('customers', CUSTOMERS.map((c) => ({
  garage_id: G, name: c.name, phone: c.phone, kind: c.kind, city: c.city,
  address: c.address, email: c.email ?? null, id_number: c.id_number ?? null,
})));
const custIdByRef = Object.fromEntries(CUSTOMERS.map((c, i) => [c.ref, customers[i].id]));

await insert('vehicles', CUSTOMERS.flatMap((c) =>
  c.cars.map((v) => ({ ...v, garage_id: G, customer_id: custIdByRef[c.ref] }))));
console.log(`customers: ${CUSTOMERS.length}, vehicles: ${CUSTOMERS.reduce((n, c) => n + c.cars.length, 0)}`);

/* ---------------- tickets ----------------

   Numbering starts at 101 deliberately — see the note about invoices at the
   top, and a garage on its hundredth job reads better in a demo than one on
   its third. */


const now = new Date().toISOString();
const rows = [];
const worksByKey = new Map();

for (const t of TICKETS) {
  const c = CUSTOMERS.find((x) => x.ref === t.cust);
  const car = c.cars[t.car];
  const works = t.works.map((code, i) => work(code, `w${i + 1}`));
  const settled = t.st === 'paid';
  const finished = settled || t.st === 'done';
  const key = `GAR-${t.n}`;
  worksByKey.set(key, works);

  rows.push({
    garage_id: G,
    key, job: `W-${t.n}`,
    status: t.st, type: 'job', epic: t.epic, priority: t.prio,
    assignee: t.who, points: Math.min(8, Math.max(1, works.length * 3)),
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
    paid_at: settled ? (t.paidToday ? now : iso(t.paidOn)) : null,
    created_at: iso(t.created),
    updated_at: iso(t.due),
  });
}

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
const partRows = [];
for (const sw of savedWorks) {
  const key = Object.keys(ticketIdByKey).find((k) => ticketIdByKey[k] === sw.ticket_id);
  const src = worksByKey.get(key).find((w) => w.uid === sw.uid);
  src.items.forEach((p, i) => partRows.push({
    garage_id: G, work_id: sw.id, sku: p.sku, name: p.name, qty: p.qty, price: p.price, position: i,
  }));
}
await insert('work_items', partRows);
console.log(`tickets  : ${rows.length} (${count(rows, 'todo')} todo, ${count(rows, 'appr')} appr, ${count(rows, 'done')} done, ${count(rows, 'paid')} paid)`);
console.log(`           ${savedWorks.length} works, ${partRows.length} parts`);

/* ---------------- the tickets an invoice holds down ----------------

   Rewritten rather than deleted, and given work that adds up to exactly the
   document already issued against them: an invoice for ₪7,998.04 on a ticket
   showing ₪808 is the one thing a prospect would notice.

   `net` is that document's total divided by 1.18 — 130.98 -> 111, 7998.04 ->
   6778, and so on. It comes out whole every time because the document was
   priced from whole-shekel lines in the first place.

   All five are marked paid and dated back, so they age into the archive and
   leave the board to the demo. Three of them were credited in full, which by
   the rule in useTicketPage would put a live ticket back into מוכן — that rule
   governs the moment a credit is issued, and these are closed history. */

const LEGACY = [
  { key: 'GAR-17', cust: 'dana', car: 0, epic: 'service', paidOn: '2026-05-14', payMethod: PAY.cash,
    work: { name: 'החלפת ערכת מגבים', labor: 26, items: [{ sku: 'WPR', name: 'ערכת מגבים', qty: 1, price: 85 }] } },
  { key: 'GAR-15', cust: 'bendavid', car: 0, epic: 'engine', paidOn: '2026-05-27', payMethod: PAY.transfer,
    work: { name: 'שיפוץ מנוע — פירוק, אטמים והרכבה', labor: 3800, items: [{ sku: null, name: 'ערכת שיפוץ מנוע', qty: 1, price: 2978 }] } },
  { key: 'GAR-7', cust: 'omer', car: 0, epic: 'engine', paidOn: '2026-06-03', payMethod: PAY.card,
    work: { name: 'החלפת משאבת מים ורצועה', labor: 620, items: [{ sku: null, name: 'משאבת מים', qty: 1, price: 603 }] } },
  { key: 'GAR-16', cust: 'eli', car: 0, epic: 'engine', paidOn: '2026-06-18', payMethod: PAY.transfer,
    work: { name: 'החלפת גיר אוטומטי (מחודש)', labor: 1500, items: [{ sku: null, name: 'גיר אוטומטי מחודש', qty: 1, price: 5278 }] } },
  { key: 'GAR-4', cust: 'ester', car: 0, epic: 'elec', paidOn: '2026-06-29', payMethod: PAY.cash,
    work: { name: 'החלפת נורת לוחית רישוי', labor: 11, items: [] } },
];

const legacyWorkRows = [];
for (const L of LEGACY) {
  const c = CUSTOMERS.find((x) => x.ref === L.cust);
  const car = c.cars[L.car];
  const w = { uid: 'w1', code: null, custom: true, ...L.work };

  const { data: updated, error } = await db.from('tickets').update({
    status: 'paid', type: 'job', epic: L.epic, priority: 'med', assignee: 'adam-2', points: 3,
    title: w.name,
    plate: car.plate,
    car: [car.manufacturer, car.model, car.year].filter(Boolean).join(' '),
    customer_id: custIdByRef[L.cust], customer_name: c.name,
    phone: c.phone, email: c.email ?? null,
    address: [c.address, c.city].filter(Boolean).join(', '),
    id_number: c.id_number ?? null,
    km: car.km, year: car.year, vehicle_code: car.vehicle_code,
    amount: amountOf([w]),
    done: 1, subtasks: [w.name], due: due(L.paidOn),
    flags: ['key_received'], blocked: null, notes: null,
    paid: true, pay_method: L.payMethod, paid_at: iso(L.paidOn),
    created_at: iso(L.paidOn), updated_at: iso(L.paidOn),
  }).eq('garage_id', G).eq('key', L.key).select();
  if (error) die(`${L.key}: ${error.message}`);
  if (!updated.length) die(`${L.key}: no such ticket — an invoice named it a moment ago`);

  /* stamp_paid_at overwrites paid_at with now() for a ticket ENTERING 'paid',
     which is every one of these that was not already settled — and a ticket
     stamped today stays on the board instead of ageing into the archive. A
     second write with the status unchanged falls through every branch of that
     trigger, so the back-date sticks. */
  const { error: pErr } = await db.from('tickets')
    .update({ paid_at: iso(L.paidOn) }).eq('id', updated[0].id);
  if (pErr) die(`${L.key} paid_at: ${pErr.message}`);

  legacyWorkRows.push({ row: { garage_id: G, ticket_id: updated[0].id, uid: w.uid, code: null, name: w.name, labor: w.labor, custom: true, position: 0 }, items: w.items });
}

/* Matched back by ticket_id rather than by position — one work per ticket here,
   and nothing promises an insert returns rows in the order they were sent. */
const legacyWorks = await insert('works', legacyWorkRows.map((x) => x.row));
await insert('work_items', legacyWorks.flatMap((sw) => {
  const src = legacyWorkRows.find((x) => x.row.ticket_id === sw.ticket_id);
  return src.items.map((p, j) => ({
    garage_id: G, work_id: sw.id, sku: p.sku, name: p.name, qty: p.qty, price: p.price, position: j,
  }));
}));
console.log(`legacy   : ${LEGACY.length} rewritten to match their invoices, archived`);

/* ---------------- suppliers ---------------- */

await insert('suppliers', [
  { garage_id: G, name: 'חלפים צפון בע״מ', tax_id: '512338901', phone: '048612340', email: 'orders@halafim-tzafon.co.il', address: 'אזור התעשייה, קריית אתא' },
  { garage_id: G, name: 'שמנים ומסננים ג.ל.', tax_id: '514902117', phone: '049551122', email: 'gl.oils@gmail.com', address: 'המלאכה 6, חיפה' },
  { garage_id: G, name: 'מוסך ציוד ומכשור', tax_id: '511774203', phone: '047723344', address: 'ההסתדרות 210, חיפה' },
]);
console.log('suppliers: 3');

/* ---------------- the counter ----------------

   create_ticket takes the next number from here, so leaving it at the old
   value would hand the next real ticket a key one of these already holds. */

const { error: cErr } = await db.from('garage_counters')
  .upsert({ garage_id: G, last_ticket: 114, last_job: 114 }, { onConflict: 'garage_id' });
if (cErr) die(`garage_counters: ${cErr.message}`);
console.log('counter  : next ticket is GAR-115');

console.log('\ndone.');

/* ---------------- helpers ---------------- */

function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

function count(rows, status) { return rows.filter((r) => r.status === status).length; }

/** Insert and return the rows as stored, so generated ids can be referenced. */
async function insert(table, values) {
  if (!values.length) return [];
  const { data, error } = await db.from(table).insert(values).select();
  if (error) die(`${table}: ${error.message}`);
  return data;
}
