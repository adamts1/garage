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
import { firstLine, parseCliJson, repoRoot, runCli } from './cli.ts';
import { environment } from './environments.ts';
import type {
  DeployedFunction,
  EnvId,
  FunctionDriftReport,
  FunctionDriftRow,
  FunctionsOverview,
} from './types.ts';

const run = promisify(execFile);

/** One row of `functions list`, as the CLI returns it. */
export interface ListedFunction {
  slug: string;
  version: number;
  updated_at: number | string;
  ezbr_sha256?: string;
  status?: string;
}

/** The functions in this repo. _shared holds modules, not functions. */
export function localFunctions(): string[] {
  return readdirSync(join(repoRoot, 'supabase', 'functions'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

/** What is deployed on a project. THROWS when it cannot get an answer: an
 *  empty list would render as "not deployed" against every function, which
 *  reads as "deploy all of these" about functions that are already live. */
export async function deployedFunctions(ref: string): Promise<ListedFunction[]> {
  const parsed = parseCliJson(await runCli(['functions', 'list', '--project-ref', ref, '--output-format', 'json']));
  const list = Array.isArray(parsed) ? parsed : (parsed as { functions?: unknown } | null)?.functions;
  if (!Array.isArray(list)) throw new Error('the CLI reply had no function list');
  return list as ListedFunction[];
}

/** Both remote environments side by side, by bundle hash. */
export async function functionsOverview(envIds: EnvId[] = ['production', 'staging']): Promise<FunctionsOverview> {
  const local = localFunctions();
  const byEnv: Partial<Record<EnvId, Map<string, DeployedFunction>>> = {};
  const errors: Partial<Record<EnvId, string>> = {};

  await Promise.all(envIds.map(async (id) => {
    try {
      const list = await deployedFunctions(environment(id).ref ?? '');
      byEnv[id] = new Map(list.map((f) => [f.slug, {
        version: f.version,
        updatedAt: f.updated_at,
        hash: f.ezbr_sha256 ?? null,
        status: f.status ?? null,
      }]));
    } catch (e) {
      errors[id] = e instanceof Error ? e.message : String(e);
    }
  }));

  const names = new Set(local);
  for (const map of Object.values(byEnv)) for (const slug of map.keys()) names.add(slug);

  const rows = [...names].sort().map((name) => {
    const deployed: Partial<Record<EnvId, DeployedFunction | null>> = {};
    for (const id of envIds) {
      const map = byEnv[id];
      if (map) deployed[id] = map.get(name) ?? null;
    }
    const hashes = envIds.map((id) => deployed[id]?.hash).filter((h): h is string => Boolean(h));
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

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const same = (a: Buffer | null, b: Buffer | null): boolean => a !== null && b !== null && Buffer.compare(a, b) === 0;

async function atRef(gitRef: string, path: string): Promise<Buffer | null> {
  try {
    return (await run('git', ['show', `${gitRef}:${path}`], { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024, encoding: 'buffer' })).stdout;
  } catch {
    return null;
  }
}

const atTree = (path: string): Buffer | null => {
  const p = join(repoRoot, path);
  return existsSync(p) ? readFileSync(p) : null;
};

export async function refExists(gitRef: string): Promise<boolean> {
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
export async function downloadDeployed(ref: string, name: string): Promise<{ path: string; bytes: Buffer }[]> {
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
export async function functionDrift(ref: string, gitRef: string, name: string) {
  const files = await downloadDeployed(ref, name);
  const offRef: string[] = [];
  let matchesTree = true;
  for (const f of files) {
    if (!same(f.bytes, await atRef(gitRef, f.path))) offRef.push(f.path.replace('supabase/functions/', ''));
    if (!same(f.bytes, atTree(f.path))) matchesTree = false;
  }
  return { name, sameAsRef: offRef.length === 0, offRef, matchesTree };
}

/** Every function of one environment against git. Per-function failures are
 *  reported per function, never folded into "same". */
export async function environmentDrift(id: EnvId, gitRef?: string | null): Promise<FunctionDriftReport> {
  const env = environment(id);
  const ref = gitRef ?? env.gitRef;
  if (!env.ref || !ref) throw new Error('local has no deployed functions');
  if (!(await refExists(ref))) throw new Error(`unknown ref ${ref} — try: git fetch origin`);

  const local = localFunctions();
  const live = new Map((await deployedFunctions(env.ref)).map((f) => [f.slug, f]));
  const results: FunctionDriftRow[] = [];
  for (const name of local) {
    const fn = live.get(name);
    if (!fn) {
      results.push({ name, deployed: false });
      continue;
    }
    const meta = { version: fn.version, updatedAt: fn.updated_at };
    try {
      results.push({ ...meta, deployed: true, ...(await functionDrift(env.ref, ref, name)) });
    } catch (e) {
      results.push({ ...meta, name, deployed: true, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const slug of live.keys()) {
    if (!local.includes(slug)) results.push({ name: slug, deployed: true, noSource: true });
  }
  return { env: id, gitRef: ref, results };
}
