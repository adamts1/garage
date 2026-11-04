#!/usr/bin/env node
/* The photo files of a production backup.
 *
 *   node scripts/backup-prod-photos.mjs <backup-folder>
 *
 * Called by backup-prod.sh after the dump. The database only holds each photo's
 * row (storage.objects); the image itself lives in Storage. This reads the list
 * of objects out of the dump's data.sql — so the files match the rows exactly —
 * and downloads each one to <backup-folder>/storage/<bucket>/<path>.
 * Read-only: it only GETs. */
import fs from 'node:fs';
import path from 'node:path';

const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';
const [dir] = process.argv.slice(2);
if (!dir || !fs.existsSync(path.join(dir, 'data.sql'))) {
  console.error('usage: backup-prod-photos.mjs <backup-folder containing data.sql>');
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.SUPABASE_URL?.includes(PRODUCTION_PROJECT_REF)) {
  console.error('.env.production.local does not point at production — refusing.');
  process.exit(1);
}

const lines = fs.readFileSync(path.join(dir, 'data.sql'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith('COPY "storage"."objects"'));
const rows = [];
for (let i = start + 1; start >= 0 && lines[i] !== '\\.'; i++) {
  const [, bucket, name] = lines[i].split('\t');
  rows.push({ bucket, name });
}

let ok = 0;
for (const { bucket, name } of rows) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${name}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) { console.error(`  ✗ ${res.status} ${bucket}/${name}`); continue; }
  const out = path.join(dir, 'storage', bucket, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
  ok++;
}
console.log(`  ✓ ${ok}/${rows.length} photo files`);
if (ok !== rows.length) process.exit(1);
