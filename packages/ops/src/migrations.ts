/* Which migrations each environment has applied.
 *
 * The database records what it applied in supabase_migrations.schema_migrations
 * — the same table `migration list` reads. The repo says what exists. Each
 * environment is compared with two things: the working tree (what you have
 * now) and the branch it deploys from (origin/staging, origin/main), because
 * "not applied yet" means something different for a migration that is merged
 * than for one that only exists on your branch.
 */

import { execFile } from 'node:child_process';
import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dbQuery, firstLine, freshLinkedWorkdir, repoRoot, runCli, runProgram } from './cli.ts';
import { environment } from './environments.ts';
import type {
  EnvId,
  Environment,
  Migration,
  MigrationPushPlan,
  MigrationPushResult,
  MigrationSource,
  MigrationStatus,
} from './types.ts';

const run = promisify(execFile);

const MIGRATION = /^(\d{14})_(.+)\.sql$/;

const parse = (file: string): Migration | null => {
  const m = MIGRATION.exec(file);
  return m ? { version: m[1] ?? '', name: m[2] ?? null } : null;
};

const present = <T>(v: T | null): v is T => v !== null;

/** The migrations in the working tree. */
export function treeMigrations(): Migration[] {
  return readdirSync(join(repoRoot, 'supabase', 'migrations')).map(parse).filter(present);
}

/** The migrations at a git ref, or null when the ref is unknown (not fetched). */
export async function refMigrations(gitRef: string): Promise<Migration[] | null> {
  try {
    const { stdout } = await run('git', ['ls-tree', '--name-only', `${gitRef}:supabase/migrations`], { cwd: repoRoot });
    return stdout.split('\n').map((f) => parse(f.trim())).filter(present);
  } catch {
    return null;
  }
}

/** Applied versions in one environment. Throws when the database cannot be
 *  read — an unreadable environment must never look like one with nothing
 *  applied. */
export async function appliedMigrations(id: EnvId): Promise<Migration[]> {
  const env = environment(id);
  const rows = await dbQuery(env.ref ?? 'local',
    'select version, name from supabase_migrations.schema_migrations order by version');
  return rows.map((r) => ({ version: String(r.version), name: r.name == null ? null : String(r.name) }));
}

/** Pure: the comparison, given what was read. */
export function compareMigrations(
  env: { id: EnvId; gitRef: string | null },
  applied: Migration[],
  tree: Migration[],
  branch: Migration[] | null,
): MigrationStatus {
  const appliedSet = new Set(applied.map((m) => m.version));
  const treeSet = new Set(tree.map((m) => m.version));
  const branchSet = branch ? new Set(branch.map((m) => m.version)) : null;
  return {
    env: env.id,
    gitRef: env.gitRef,
    branchKnown: branch !== null,
    applied: applied.map((m) => m.version),
    pendingFromBranch: branch ? branch.filter((m) => !appliedSet.has(m.version)) : [],
    pendingFromTree: tree.filter((m) => !appliedSet.has(m.version) && !branchSet?.has(m.version)),
    unknown: applied.filter((m) => !treeSet.has(m.version)),
  };
}

export async function migrationStatus(id: EnvId): Promise<MigrationStatus> {
  const env = environment(id);
  /* Compared with the branch as it is on GitHub, not as it was at your last
     fetch. Offline, the last fetched state is still a fair answer. */
  if (env.gitRef) await fetchRef(env.gitRef).catch(() => {});
  const [applied, branch] = await Promise.all([
    appliedMigrations(id),
    env.gitRef ? refMigrations(env.gitRef) : Promise.resolve(null),
  ]);
  return compareMigrations(env, applied, treeMigrations(), branch);
}

/* ---------- pushing ----------
 *
 * `supabase db push`, aimed at one environment without touching the repo's
 * own link (supabase/.temp/project-ref — whatever was linked last, which may
 * well be production). A remote push runs from a throwaway workdir that is
 * linked to the target and holds a copy of the migrations being pushed:
 *
 *  - from the branch the environment deploys from (origin/main for
 *    production, origin/staging for staging), fetched first. This is the only
 *    source production accepts: what reaches it is what was merged to main,
 *    never a file that exists only on your branch.
 *  - from the working tree, for staging (testing a migration before its PR is
 *    merged) and for local, which has no branch.
 *
 * Every push is a dry run first. The page shows its list, and the real push
 * runs only when a second dry run still gives the same list — so what is
 * applied is exactly what was looked at.
 */

const MIGRATION_FILE = /\b(\d{14}_[\w.-]+?\.sql)\b/g;

/** Pure: what a `db push` reply says. The out-of-order error lists only the
 *  late files, so the caller re-runs with --include-all to see the rest. */
export function readPushReply(text: string): { files: string[]; needsIncludeAll: boolean } {
  const files = [...new Set([...text.matchAll(MIGRATION_FILE)].map((m) => m[1] ?? ''))].filter(Boolean);
  return { files, needsIncludeAll: /--include-all/.test(text) && /before the last migration/i.test(text) };
}

export function pushSources(env: Pick<Environment, 'id' | 'gitRef'>): MigrationSource[] {
  if (env.id === 'production') return ['branch'];
  return env.gitRef ? ['branch', 'tree'] : ['tree'];
}

interface Prepared {
  workdir: string;
  target: string[];
  label: string;
  cleanup: () => void;
}

async function fetchRef(gitRef: string): Promise<void> {
  const [remote, ...rest] = gitRef.split('/');
  const branch = rest.join('/');
  if (!remote || !branch) throw new Error(`not a remote branch: ${gitRef}`);
  const reply = await runProgram('git', ['fetch', '--quiet', remote, branch]);
  if (!reply.ok) throw new Error(`git fetch ${remote} ${branch} failed: ${firstLine(reply.stderr)}`);
}

async function prepare(id: EnvId, source: MigrationSource): Promise<Prepared> {
  const env = environment(id);
  if (!pushSources(env).includes(source)) {
    throw new Error(source === 'tree' && env.id === 'production'
      ? 'production takes migrations from origin/main only'
      : `${env.id} has no ${source} source`);
  }

  if (!env.ref) {
    return { workdir: repoRoot, target: ['--local'], label: 'working tree', cleanup: () => {} };
  }

  const workdir = await freshLinkedWorkdir(env.ref);
  const cleanup = () => rmSync(workdir, { recursive: true, force: true });
  try {
    const into = join(workdir, 'supabase', 'migrations');
    if (source === 'tree') {
      cpSync(join(repoRoot, 'supabase', 'migrations'), into, { recursive: true });
      return { workdir, target: ['--linked'], label: 'working tree', cleanup };
    }
    const gitRef = env.gitRef ?? '';
    await fetchRef(gitRef);
    const tar = join(workdir, 'migrations.tar');
    const archive = await runProgram('git', ['archive', '--format=tar', '-o', tar, gitRef, 'supabase/migrations']);
    if (!archive.ok) throw new Error(`git archive ${gitRef} failed: ${firstLine(archive.stderr)}`);
    const untar = await runProgram('tar', ['-xf', tar, '-C', workdir]);
    if (!untar.ok) throw new Error(`could not unpack ${gitRef}: ${firstLine(untar.stderr)}`);
    return { workdir, target: ['--linked'], label: gitRef, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function dbPush(p: Prepared, flags: string[]) {
  const reply = await runCli(['db', 'push', ...p.target, '--workdir', p.workdir, ...flags], { cwd: p.workdir });
  return { ...reply, text: `${reply.stdout}\n${reply.stderr}` };
}

async function dryRun(p: Prepared): Promise<{ files: string[]; outOfOrder: boolean }> {
  const first = await dbPush(p, ['--dry-run']);
  const read = readPushReply(first.text);
  if (first.ok) return { files: read.files, outOfOrder: false };
  if (!read.needsIncludeAll) throw new Error(cliError(first.text));
  const all = await dbPush(p, ['--dry-run', '--include-all']);
  if (!all.ok) throw new Error(cliError(all.text));
  return { files: readPushReply(all.text).files, outOfOrder: true };
}

/** The CLI's own words, minus its update nag. */
const cliError = (text: string): string =>
  text.split('\n')
    .filter((l) => l.trim() && !/new version of Supabase CLI|recommend updating|Using workdir|DRY RUN|Initialising login role|Connecting to/i.test(l))
    .join('\n')
    .trim() || 'supabase db push failed';

export async function planMigrationPush(id: EnvId, source: MigrationSource): Promise<MigrationPushPlan> {
  const p = await prepare(id, source);
  try {
    const { files, outOfOrder } = await dryRun(p);
    return { env: id, source, sourceLabel: p.label, files, outOfOrder };
  } finally {
    p.cleanup();
  }
}

const pushing = new Set<EnvId>();

/** Applies exactly `expected` — the list the person confirmed. A fresh dry
 *  run must give the same list, or nothing is pushed. Then reads the
 *  environment back: a push that exits 0 with a version still missing is
 *  reported as a failure, not a success. */
export async function pushMigrations(
  id: EnvId,
  source: MigrationSource,
  expected: readonly string[],
): Promise<MigrationPushResult> {
  if (!expected.length) throw new Error('nothing to push');
  if (pushing.has(id)) throw new Error(`a push to ${id} is already running`);
  pushing.add(id);
  const p = await prepare(id, source).catch((e: unknown) => {
    pushing.delete(id);
    throw e;
  });
  try {
    const plan = await dryRun(p);
    if (plan.files.join('\n') !== expected.join('\n')) {
      throw new Error('the list changed since it was shown (a merge, a new file?) — check again before pushing');
    }
    const reply = await dbPush(p, ['--yes', ...(plan.outOfOrder ? ['--include-all'] : [])]);
    if (!reply.ok) throw new Error(cliError(reply.text));

    const applied = new Set((await appliedMigrations(id)).map((m) => m.version));
    const missing = expected.filter((f) => !applied.has(f.slice(0, 14)));
    if (missing.length) throw new Error(`the CLI finished, but these are not recorded as applied: ${missing.join(', ')}`);
    return { env: id, applied: [...expected], log: cliError(reply.text) };
  } finally {
    p.cleanup();
    pushing.delete(id);
  }
}
