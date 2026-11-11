#!/usr/bin/env node
/* Bring a garage's records over from the Metal / Ricbi program it used before.
 *
 *   python3 -I scripts/ricbi/decode.py <ricbi dir> <ricbi/edit dir> <out dir>
 *   python3 -I scripts/ricbi/select.py <out dir> <since YYYY-MM-DD> <out dir>/import.json
 *   npm run import:ricbi -- --garage "richbi-test" --data <out dir>/import.json          # dry run
 *   npm run import:ricbi -- --garage "richbi-test" --data <out dir>/import.json --yes
 *
 * decode.py reads the old program's binary files; select.py applies what the
 * garage chose to bring (2026-11-10: customers with a phone and a car, their
 * cars, five years of work cards, the supplier list — no invoices). This file
 * only writes what select.py chose.
 *
 * WHAT IT WRITES
 *
 *   customers, vehicles (→ cars)  the people and their cars
 *   suppliers                     names and contact details only
 *   tickets, works, work_items    each old work card, as history: key RB-<old
 *                                 number>, legacy_source 'ricbi', status done,
 *                                 never paid, off the board. One work per card
 *                                 named after it, its lines as parts, prices
 *                                 before VAT as the old program kept them.
 *
 * garage_counters is NOT touched: the old cards are not the garage's numbers,
 * and the garage's own GAR- sequence goes on as if they were not there.
 *
 * Re-runnable. A customer already on file (same name and phone, compared as
 * the app compares them), a car already linked to them, a supplier with the
 * same name and a card whose old number is already in are all skipped, so a
 * second run adds only what the first one did not.
 *
 * Additive only: no DELETE, no UPDATE. Runs under the service_role key, which
 * the ticket number lock lets write its own keys. Refuses production until a
 * garage has signed off on a staging run — pass --production to mean it.
 */

import { readFileSync } from 'node:fs';
import { PRODUCTION_PROJECT_REF, connect, die, parseArgs, resolveGarage, stopUnlessConfirmed } from '../seed-lib.mjs';

const args = parseArgs(process.argv.slice(2), ['garage', 'id', 'data', 'yes', 'production']);
const dataPath = args.get('data');
if (!dataPath || dataPath === true) die('pass --data <import.json> (written by scripts/ricbi/select.py)');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
if (url.includes(PRODUCTION_PROJECT_REF) && !args.has('production')) {
  die('this is PRODUCTION. Import into staging first; pass --production only once the garage has checked it.');
}

const db = connect();
const garage = await resolveGarage(db, { name: args.get('garage'), id: args.get('id') });
const G = garage.id;

/* ---------------- helpers ---------------- */

const BATCH = 500;
const nameKey = (n) => (n ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const digits = (p) => (p ?? '').replace(/\D/g, '');
const custKey = (name, phone) => `${nameKey(name)}|${digits(phone)}`;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

async function insertAll(table, rows, select = '*') {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data: got, error } = await db.from(table).insert(rows.slice(i, i + BATCH)).select(select);
    if (error) die(`${table}: ${error.message}`);
    out.push(...got);
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return out;
}

async function selectAll(table, columns, filter = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data: got, error } = await filter(db.from(table).select(columns).eq('garage_id', G))
      .range(from, from + 999);
    if (error) die(`${table}: ${error.message}`);
    out.push(...got);
    if (got.length < 1000) return out;
  }
}

/* ---------------- what is already here ---------------- */

const existingCustomers = await selectAll('customers', 'id, name, phone');
const custIdByKey = new Map(existingCustomers.map((c) => [custKey(c.name, c.phone), c.id]));
const existingLinks = new Set((await selectAll('vehicles', 'customer_id, plate')).map((v) => `${v.customer_id}|${v.plate}`));
const existingSuppliers = new Set((await selectAll('suppliers', 'name')).map((s) => nameKey(s.name)));
const existingCards = new Set((await selectAll('tickets', 'legacy_number', (q) => q.eq('legacy_source', 'ricbi')))
  .map((t) => t.legacy_number));

const keyOf = (k) => custKey(k[0], k[1]);   // select.py's [name, phone digits]
const newCustomers = data.customers.filter((c) => !custIdByKey.has(keyOf(c.key)));
const newSuppliers = data.suppliers.filter((s) => !existingSuppliers.has(nameKey(s.name)));
const newCards = data.cards.filter((c) => !existingCards.has(String(c.number)));
const linkedAlready = data.cars.filter((car) => {
  const id = custIdByKey.get(keyOf(car.owner));
  return id && existingLinks.has(`${id}|${car.plate}`);
}).length;

/* ---------------- the plan ---------------- */

console.log('will insert:');
console.log(`  ${String(newCustomers.length).padStart(6)}  customers   (${data.customers.length - newCustomers.length} already here)`);
console.log(`  ${String(data.cars.length - linkedAlready).padStart(6)}  cars        (${linkedAlready} already here; two spellings of one plate become one car)`);
console.log(`  ${String(newSuppliers.length).padStart(6)}  suppliers   (${data.suppliers.length - newSuppliers.length} already here)`);
console.log(`  ${String(newCards.length).padStart(6)}  history tickets RB-…  (${data.cards.length - newCards.length} already here)`);
console.log('       0  invoices, 0 deletes, 0 updates, garage_counters untouched');

stopUnlessConfirmed(args.has('yes'));

/* ---------------- customers ---------------- */

const savedCustomers = await insertAll('customers', newCustomers.map((c) => ({
  garage_id: G,
  name: c.name,
  phone: c.phone,
  email: c.email || null,
  address: c.address || null,
  city: c.city || null,
  id_number: c.id_number || null,
  kind: c.kind,
})), 'id, name, phone');
for (const c of savedCustomers) custIdByKey.set(custKey(c.name, c.phone), c.id);

/* ---------------- cars, through the customer↔car link ----------------
   vehicles_follow_car makes the cars row from the first link's details. */

const links = data.cars
  .map((car) => ({ car, customer_id: custIdByKey.get(keyOf(car.owner)) }))
  .filter(({ car, customer_id }) => customer_id && !existingLinks.has(`${customer_id}|${car.plate}`));
await insertAll('vehicles', links.map(({ car, customer_id }) => ({
  garage_id: G,
  customer_id,
  plate: car.plate,
  manufacturer: car.manufacturer || null,
  model: car.model || null,
  year: car.year || null,
  km: car.km || null,
})), 'id');

/* ---------------- suppliers ---------------- */

await insertAll('suppliers', newSuppliers.map((s) => ({
  garage_id: G,
  name: s.name,
  tax_id: s.tax_id || null,
  phone: s.phone || null,
  email: s.email || null,
  address: s.address || null,
  notes: `ממערכת קודמת, חשבון ${s.legacy_id}`,
})), 'id');

/* ---------------- work cards, as history ---------------- */

/* VAT as it was on the day: 17% until the end of 2024, 18% from 2025. */
const vatOn = (date) => (date < '2025-01-01' ? 0.17 : 0.18);

/* A priced line becomes a part. The price is kept positive and the sign goes
   on the quantity, so the line comes to what the old program charged — which
   multiplied them as written: a "discount" entered as −1 × −76.92 was charged
   as +76.92, and the card's total to pay says so. */
function partOf(l, i) {
  let qty = num(l.qty) ?? 1;
  let price = num(l.unit_price);
  const total = num(l.line_total);
  if (price === null) price = total !== null && qty ? total / qty : 0;
  if (price < 0) { price = -price; qty = -qty; }
  const discount = Math.min(Math.max(num(l.discount_pct) ?? 0, 0), 100);
  return { sku: l.sku || null, name: l.description || '—', qty, price: round2(price), discount, position: i };
}

const lineNet = (p) => p.qty * round2(p.price * (1 - p.discount / 100));

const cards = newCards.map((c) => {
  const parts = c.lines.filter((l) => l.kind === 'item').map(partOf);
  const notes = c.lines.filter((l) => l.kind === 'text').map((l) => l.description).filter(Boolean);
  const headings = c.lines.filter((l) => l.kind === 'heading').map((l) => l.description).filter(Boolean);
  const title = headings.join(' ') || c.title || 'כרטיס עבודה';
  const net = parts.reduce((s, p) => s + lineNet(p), 0);
  return { c, parts, notes, title, net };
});

const ticketRows = cards.map(({ c, title, net }) => {
  const customerId = c.customer ? custIdByKey.get(keyOf(c.customer)) ?? null : null;
  const opened = `${c.date_in}T09:00:00+02:00`;
  return {
    garage_id: G,
    key: `RB-${c.number}`,
    job: null,
    legacy_source: 'ricbi',
    legacy_number: String(c.number),
    status: 'done',
    title,
    plate: c.plate,
    customer_id: customerId,
    customer_name: c.customer_name || null,
    phone: c.phone || null,
    km: c.km || null,
    amount: round2(net * (1 + vatOn(c.date_in))),
    paid: false,
    board_hidden: true,
    notes: c.invoice ? `נסגר לחשבונית ${Number(c.invoice.slice(3))} במערכת הקודמת` : null,
    created_at: opened,
    updated_at: opened,
    closed_at: `${c.date_out || c.date_in}T17:00:00+02:00`,
  };
});
const savedTickets = await insertAll('tickets', ticketRows, 'id, legacy_number');
const ticketId = new Map(savedTickets.map((t) => [t.legacy_number, t.id]));

const savedWorks = await insertAll('works', cards.map(({ c, title, notes }) => ({
  garage_id: G,
  ticket_id: ticketId.get(String(c.number)),
  uid: 'legacy',
  code: null,
  name: title,
  labor: 0,
  custom: true,
  position: 0,
  notes: notes.join('\n') || null,
})), 'id, ticket_id');
const workIdByTicket = new Map(savedWorks.map((w) => [w.ticket_id, w.id]));

await insertAll('work_items', cards.flatMap(({ c, parts }) => {
  const work_id = workIdByTicket.get(ticketId.get(String(c.number)));
  return parts.map((p) => ({ garage_id: G, work_id, ...p }));
}), 'id');

console.log('\ndone.');
