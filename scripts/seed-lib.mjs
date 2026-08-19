/* What every additive seeder needs, and nothing about what any of them seeds.
 *
 * There were two seeders and then there was one script with three modes, which
 * is the shape a script takes when nobody wants to duplicate the twenty lines
 * that connect, find the garage and print the plan. Those twenty lines live
 * here now, so the seeders can be what they are: one writes a catalogue, one
 * writes a board, and neither has an opinion about the other.
 *
 * Everything here is additive. No DELETE, no UPDATE to operational data. That
 * is the property that lets these run against production at all, and it is a
 * property of every caller, not of this file — see seed-demo.mjs for the one
 * that does wipe, and refuses production outright because of it.
 */

import { createClient } from '@supabase/supabase-js';

/** The garages' real project. Named so a run against it says so out loud. */
export const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';

export function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/* Flags are `--name value` or bare `--name`. Deliberately the same shape as
   onboard-garage.mjs, including the refusal of an unknown one: a typo that is
   silently ignored is a run that reports success and did something else. */
export function parseArgs(argv, known) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > 2) {
      args.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args.set(token.slice(2), true);
    else { args.set(token.slice(2), next); i++; }
  }
  for (const name of args.keys()) {
    if (!known.includes(name)) {
      die(`Unknown flag --${name}. Known flags: ${known.map((f) => `--${f}`).join(' ')}`);
    }
  }
  return args;
}

/** Connects, and says which project out loud before anything is written. */
export function connect() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    die('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — run through npm, which passes --env-file.');
  }
  console.log(`project : ${url}${url.includes(PRODUCTION_PROJECT_REF) ? '   ← PRODUCTION' : ''}`);
  return createClient(url, key, { auth: { persistSession: false } });
}

/* A uuid identifies exactly; a name has to be unique among garages to mean
   anything. Either way the operator is told which one they hit, because
   "שרון" being one garage is an assumption and this is where it is checked. */
export async function resolveGarage(db, { name, id }) {
  if (!name && !id) die('pass --garage "<name>" or --id <uuid>');
  const q = db.from('garages').select('id, name');
  const { data, error } = await (id ? q.eq('id', id) : q.eq('name', name));
  if (error) die(error.message);
  if (!data?.length) die(`no garage ${id ? id : `named "${name}"`} in this project`);
  if (data.length > 1) die(`${data.length} garages share that name — refusing to guess`);
  console.log(`garage  : ${data[0].name}  [${data[0].id}]\n`);
  return data[0];
}

/* Each seeder guards exactly what it writes, and nothing else. The catalogue
   script has no business refusing a garage because it has customers, and the
   board script has none refusing one because it has a price list.

   The reason a guard exists at all: seeded rows and real rows are
   indistinguishable once they are in the same table, so putting demo data into
   a garage somebody is using is a decision, not a default. */
export async function guardEmpty(db, garageId, tables, { append, label }) {
  const found = [];
  for (const t of tables) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true }).eq('garage_id', garageId);
    if (error) die(`${t}: ${error.message}`);
    if (count) found.push([t, count]);
  }
  if (found.length && !append) {
    console.error(`✗ this garage already has ${label} — refusing to seed on top of it:\n`);
    for (const [t, n] of found) console.error(`    ${String(n).padStart(5)}  ${t}`);
    console.error('\nSeeded rows and real rows are indistinguishable once they are in.');
    console.error('Re-run with --append to keep what is there and add only what is missing.');
    process.exit(1);
  }
  if (!found.length) console.log(`guard   : no ${label} in this garage\n`);
  else {
    console.log('already here (none of it will be changed):');
    for (const [t, n] of found) console.log(`  ${String(n).padStart(5)}  ${t}`);
    console.log();
  }
  return found;
}

/** Inserts and returns the rows, or dies naming the table. */
export async function insert(db, table, values) {
  if (!values.length) return [];
  const { data, error } = await db.from(table).insert(values).select();
  if (error) die(`${table}: ${error.message}`);
  return data;
}

/** "4 of 12 already here, skipped", or nothing when none were. */
export const skipped = (all, kept, what) =>
  all.length === kept.length ? '' : `   (${all.length - kept.length} ${what} already here, skipped)`;

/** Every seeder prints its plan and does nothing until told twice. */
export function stopUnlessConfirmed(confirmed) {
  if (confirmed) {
    console.log('\ninserting…');
    return;
  }
  console.log('\nDry run. Re-run with --yes to actually do it.');
  process.exit(0);
}
