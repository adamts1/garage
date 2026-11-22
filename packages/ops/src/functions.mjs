/* Which Edge Function is deployed where, and whether it is the code in git.
 *
 * Two questions with two costs:
 *
 *   * deployedFunctions(): `functions list` — fast. Its ezbr_sha256 is a hash of
 *     the bundle actually running, so two environments with the same hash run
 *     the same code. It says nothing about git: the bundle is built server-side
 *     and nothing local reproduces it.
 *
 *   * functionDrift(): downloads what is running and compares it byte for byte
 *     with the files at a git ref and in the working tree, _shared/ modules
 *     included. Slow — one download per function — and the only real answer to
 *     "was this deployed from the branch it should have been".
 *
 * Local has no deploys (`functions serve` runs the working tree), so only the
 * remote environments appear here.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { firstLine, parseCliJson, repoRoot, runCli } from './cli.mjs';
import { environment } from './environments.mjs';

const run = promisify(execFile);

/** The functions in this repo. _shared holds modules, not functions. */
export function localFunctions() {
  return readdirSync(join(repoRoot, 'supabase', 'functions'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

/** What is deployed on a project. THROWS when it cannot get an answer: an
 *  empty list would render as "not deployed" against every function, which
 *  reads as "deploy all of these" about functions that are already live. */
export async function deployedFunctions(ref) {
  const parsed = parseCliJson(await runCli(['functions', 'list', '--project-ref', ref, '--output-format', 'json']));
  const list = Array.isArray(parsed) ? parsed : parsed?.functions;
  if (!Array.isArray(list)) throw new Error('the CLI reply had no function list');
  return list;
}

/** Both remote environments side by side, by bundle hash. */
export async function functionsOverview(envIds = ['production', 'staging']) {
  const local = localFunctions();
  const byEnv = {};
  const errors = {};
  await Promise.all(envIds.map(async (id) => {
    try {
      const list = await deployedFunctions(environment(id).ref);
      byEnv[id] = Object.fromEntries(list.map((f) => [f.slug, {
        version: f.version,
        updatedAt: f.updated_at,
        hash: f.ezbr_sha256 ?? null,
        status: f.status ?? null,
      }]));
    } catch (e) {
      errors[id] = e.message;
    }
  }));

  const names = new Set(local);
  for (const id of Object.keys(byEnv)) for (const slug of Object.keys(byEnv[id])) names.add(slug);

  const rows = [...names].sort().map((name) => {
    const deployed = Object.fromEntries(envIds.map((id) => [id, byEnv[id] ? byEnv[id][name] ?? null : undefined]));
    const hashes = envIds.map((id) => deployed[id]?.hash).filter(Boolean);
    return {
      name,
      inRepo: local.includes(name),
      deployed,
      sameEverywhere: hashes.length === envIds.length ? hashes.every((h) => h === hashes[0]) : null,
    };
  });
  return { envs: envIds, rows, errors };
}

/* ---------- byte-for-byte comparison with git ---------- */

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;

async function atRef(gitRef, path) {
  try {
    return (await run('git', ['show', `${gitRef}:${path}`], { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024, encoding: 'buffer' })).stdout;
  } catch {
    return null;
  }
}

const atTree = (path) => {
  const p = join(repoRoot, path);
  return existsSync(p) ? readFileSync(p) : null;
};

export async function refExists(gitRef) {
  try {
    await run('git', ['rev-parse', '--verify', gitRef], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** The files running for one function, as paths under supabase/functions.
 *  Throws when it cannot download — an unreadable function must never read
 *  as "same". */
export async function downloadDeployed(ref, name) {
  const work = mkdtempSync(join(tmpdir(), `fn-${name}-`));
  try {
    const reply = await runCli(['functions', 'download', name, '--project-ref', ref, '--use-api', '--workdir', work]);
    if (!reply.ok) throw new Error(firstLine(reply.stderr || reply.stdout) || 'download failed');
    const root = join(work, 'supabase', 'functions');
    if (!existsSync(root)) throw new Error('the download produced no files');
    return walk(root).map((p) => ({ path: join('supabase', 'functions', relative(root, p)), bytes: readFileSync(p) }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Compare one function as deployed with a git ref and with the working tree. */
export async function functionDrift(ref, gitRef, name) {
  const files = await downloadDeployed(ref, name);
  const offRef = [];
  let matchesTree = true;
  for (const f of files) {
    if (!same(f.bytes, await atRef(gitRef, f.path))) offRef.push(f.path.replace('supabase/functions/', ''));
    if (!same(f.bytes, atTree(f.path))) matchesTree = false;
  }
  return { name, sameAsRef: offRef.length === 0, offRef, matchesTree };
}

/** Every function of one environment against git. Per-function failures are
 *  reported per function, never folded into "same". */
export async function environmentDrift(id, gitRef = environment(id).gitRef) {
  const env = environment(id);
  if (!env.ref) throw new Error('local has no deployed functions');
  if (!(await refExists(gitRef))) throw new Error(`unknown ref ${gitRef} — try: git fetch origin`);
  const live = new Map((await deployedFunctions(env.ref)).map((f) => [f.slug, f]));
  const results = [];
  for (const name of localFunctions()) {
    const fn = live.get(name);
    if (!fn) {
      results.push({ name, deployed: false });
      continue;
    }
    const meta = { version: fn.version, updatedAt: fn.updated_at };
    try {
      results.push({ ...meta, deployed: true, ...(await functionDrift(env.ref, gitRef, name)) });
    } catch (e) {
      results.push({ ...meta, name, deployed: true, error: e.message });
    }
  }
  for (const slug of live.keys()) {
    if (!localFunctions().includes(slug)) results.push({ name: slug, deployed: true, noSource: true });
  }
  return { env: id, gitRef, results };
}
