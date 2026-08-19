#!/usr/bin/env node
/* Put a catalogue into a garage: the works it sells and the parts they use.
 *
 *   npm run seed:catalog -- --garage "שרון"              # dry run
 *   npm run seed:catalog -- --garage "שרון" --yes
 *   npm run seed:catalog:prod -- --id <uuid> --append --yes
 *
 * WHAT IT WRITES
 *
 *   items            the parts list, with prices and zero stock
 *   work_defs        the works, with labour and hours
 *   work_def_items   which parts each work uses, and how many
 *
 * And nothing else. No customers, no cars, no tickets — that is
 * seed-board.mjs, and the split is the point: a catalogue is a garage's real
 * price list, and a board is invented. Mixing the two in one command is how a
 * garage that wanted a starting price list ended up with fourteen imaginary
 * customers on its screen.
 *
 * MODES
 *
 *   default    The garage must have no catalogue yet.
 *   --append   Keep what is there. items(garage_id, sku) and
 *              work_defs(garage_id, code) are unique, so a row whose key is
 *              already taken is skipped rather than inserted, and the work
 *              definitions this run did not create keep their own parts lists —
 *              a garage's own pricing is not ours to add to.
 *
 * Additive only: no DELETE, no UPDATE. Safe to point at production, which is
 * why it takes --id as well as --garage.
 *
 * Runs under the service_role key, which bypasses RLS. Every row carries an
 * explicit garage_id because the column's default, current_garage_id(), reads a
 * JWT this client does not have.
 */

import { CATALOG, PARTS, partBySku } from './demo-data.mjs';
import { connect, guardEmpty, insert, parseArgs, resolveGarage, skipped, stopUnlessConfirmed } from './seed-lib.mjs';

const args = parseArgs(process.argv.slice(2), ['garage', 'id', 'append', 'yes']);
const APPEND = args.has('append');
const CONFIRMED = args.has('yes');

const db = connect();
console.log(`mode    : ${APPEND ? 'append — existing catalogue rows are kept and skipped' : 'no catalogue yet'}`);
const garage = await resolveGarage(db, { name: args.get('garage'), id: args.get('id') });
const G = garage.id;

await guardEmpty(db, G, ['items', 'work_defs', 'work_def_items'], {
  append: APPEND,
  label: 'a catalogue',
});

/* Read once, up front, so the plan a dry run prints is the plan that runs. */
const existing = { skus: new Set(), codes: new Set() };
if (APPEND) {
  const { data: items } = await db.from('items').select('sku').eq('garage_id', G);
  const { data: defs } = await db.from('work_defs').select('code').eq('garage_id', G);
  items?.forEach((r) => existing.skus.add(r.sku));
  defs?.forEach((r) => existing.codes.add(r.code));
}

const newParts = PARTS.filter((p) => !existing.skus.has(p.sku));
const newDefs = CATALOG.filter((w) => !existing.codes.has(w.code));

console.log('\nwill insert:');
console.log(`  ${String(newParts.length).padStart(4)}  items${skipped(PARTS, newParts, 'skus')}`);
console.log(`  ${String(newDefs.length).padStart(4)}  work_defs${skipped(CATALOG, newDefs, 'codes')}`);
console.log(`  ${String(newDefs.reduce((n, w) => n + w.parts.length, 0)).padStart(4)}  work_def_items`);
console.log('     0  deletes, 0 updates to existing rows');

stopUnlessConfirmed(CONFIRMED);

await insert(db, 'items', newParts.map((p) => ({ ...p, garage_id: G })));

const defs = await insert(db, 'work_defs', newDefs.map((w, i) => ({
  garage_id: G, code: w.code, name: w.name, labor: w.labor, hours: w.hours, position: i,
})));
const defIdByCode = Object.fromEntries(defs.map((d) => [d.code, d.id]));

/* Only for definitions this run created. A work already on file belongs to the
   garage, and adding parts to it would change what it charges. */
const defItems = await insert(db, 'work_def_items', newDefs.flatMap((w) =>
  w.parts.map(([sku, qty], i) => ({
    work_def_id: defIdByCode[w.code], garage_id: G, sku,
    name: partBySku[sku].name, qty, price: partBySku[sku].price, position: i,
  }))));

console.log(`catalogue: ${defs.length} works, ${newParts.length} parts, ${defItems.length} work parts`);
console.log('\ndone.');
