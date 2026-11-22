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
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dbQuery, repoRoot } from './cli.mjs';
import { environment } from './environments.mjs';

const run = promisify(execFile);

const MIGRATION = /^(\d{14})_(.+)\.sql$/;

const parse = (file) => {
  const m = MIGRATION.exec(file);
  return m ? { version: m[1], name: m[2] } : null;
};

/** The migrations in the working tree. */
export function treeMigrations() {
  return readdirSync(join(repoRoot, 'supabase', 'migrations')).map(parse).filter(Boolean);
}

/** The migrations at a git ref, or null when the ref is unknown (not fetched). */
export async function refMigrations(gitRef) {
  try {
    const { stdout } = await run('git', ['ls-tree', '--name-only', `${gitRef}:supabase/migrations`], { cwd: repoRoot });
    return stdout.split('\n').map((f) => parse(f.trim())).filter(Boolean);
  } catch {
    return null;
  }
}

/** Applied versions in one environment. Throws when the database cannot be
 *  read — an unreadable environment must never look like one with nothing
 *  applied. */
export async function appliedMigrations(id) {
  const env = environment(id);
  const rows = await dbQuery(env.id === 'local' ? 'local' : env.ref,
    'select version, name from supabase_migrations.schema_migrations order by version');
  return rows.map((r) => ({ version: String(r.version), name: r.name ?? null }));
}

/** One environment's state: what it applied, compared with the tree and with
 *  its own branch. */
export async function migrationStatus(id) {
  const env = environment(id);
  const [applied, branch] = await Promise.all([
    appliedMigrations(id),
    env.gitRef ? refMigrations(env.gitRef) : Promise.resolve(null),
  ]);
  const tree = treeMigrations();
  const appliedSet = new Set(applied.map((m) => m.version));
  const treeSet = new Set(tree.map((m) => m.version));
  const branchSet = branch ? new Set(branch.map((m) => m.version)) : null;

  return {
    env: env.id,
    gitRef: env.gitRef,
    branchKnown: branch !== null,
    applied: applied.map((m) => m.version),
    /* On the branch this environment deploys from, and not applied: the real
       backlog. */
    pendingFromBranch: branch ? branch.filter((m) => !appliedSet.has(m.version)) : [],
    /* In your working tree only, not applied: fine while a branch is in review. */
    pendingFromTree: tree.filter((m) => !appliedSet.has(m.version) && !(branchSet?.has(m.version))),
    /* Applied, with no file anywhere in the tree: pushed from a branch that
       never merged, or a file that was renamed after it ran. */
    unknown: applied.filter((m) => !treeSet.has(m.version)),
  };
}
