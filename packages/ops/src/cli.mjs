/* The Supabase CLI, run as a program.
 *
 * Everything here that talks to the Management API (function lists, function
 * downloads, SQL against a remote database) goes through the CLI rather than
 * through a token of our own: the CLI is already logged in on this machine, and
 * that login is the only credential these reads need. Nothing new to store.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The repo's own CLI binary; npx only as the fallback. `npx` is not reliably a
 *  file on PATH — under a Node version manager it can be a shell function, and
 *  execFile() does not use a shell. */
export function cli() {
  const local = join(repoRoot, 'node_modules', '.bin', 'supabase');
  return existsSync(local) ? { cmd: local, argv: [] } : { cmd: 'npx', argv: ['supabase'] };
}

/** Runs the CLI. Resolves with stdout/stderr even on a non-zero exit, so the
 *  caller can read the error the CLI printed rather than a bare exit code. */
export async function runCli(argv, { cwd = repoRoot } = {}) {
  const { cmd, argv: pre } = cli();
  try {
    const { stdout, stderr } = await run(cmd, [...pre, ...argv], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, DO_NOT_TRACK: '1' },
    });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') };
  }
}

const tryParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** First meaningful line of whatever the CLI said, for an error message. */
export const firstLine = (s) => String(s ?? '').trim().split('\n').find((l) => l.trim()) ?? '';

/** The JSON value in a CLI reply, which may arrive pretty-printed across many
 *  lines or on one line with noise (a PostHog warning, an update notice)
 *  around it. Throws when the CLI reported an error as JSON, or when nothing
 *  parses — an unreadable reply must never read as an empty answer. */
export function parseCliJson({ stdout, stderr }) {
  const start = stdout.search(/[[{]/);
  if (start >= 0) {
    const whole = tryParse(stdout.slice(start));
    if (whole && whole._tag !== 'Error') return whole;
    if (whole?._tag === 'Error') throw new Error(whole.error?.message ?? 'the CLI reported an error');
  }
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    const parsed = tryParse(t);
    if (!parsed) continue;
    if (parsed._tag === 'Error') throw new Error(parsed.error?.message ?? 'the CLI reported an error');
    return parsed;
  }
  const detail = firstLine(stderr) || `could not read the reply: ${JSON.stringify(stdout.trim().slice(0, 200))}`;
  const looksLikeAuth = /token|login|unauthori[sz]ed|credential|forbidden/i.test(detail);
  throw new Error(detail + (looksLikeAuth ? ' — try: npx supabase login' : ''));
}

/** SQL against one environment's database, read-only by convention: callers
 *  pass SELECTs.
 *
 *  A remote project is queried through `db query --linked`, which uses the
 *  Management API — but "linked" means supabase/.temp/project-ref, and that file
 *  also decides where the next `db push` goes. Re-linking the repo to read a
 *  table would be a quiet way to aim a push at production. So the query runs
 *  from a throwaway workdir that is linked to the target instead, and the
 *  repo's own link is never touched. */
export async function dbQuery(target, sql) {
  if (target === 'local') {
    return rowsOf(await runCli(['db', 'query', '--local', '--output-format', 'json', sql]));
  }
  if (!/^[a-z]{20}$/.test(target)) throw new Error(`not a project ref: ${target}`);
  const work = mkdtempSync(join(tmpdir(), 'ops-db-'));
  try {
    mkdirSync(join(work, 'supabase', '.temp'), { recursive: true });
    writeFileSync(join(work, 'supabase', '.temp', 'project-ref'), target);
    return rowsOf(await runCli(['db', 'query', '--linked', '--workdir', work, '--output-format', 'json', sql], { cwd: work }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function rowsOf(reply) {
  const parsed = parseCliJson(reply);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  throw new Error(firstLine(reply.stderr) || 'the query returned no rows field');
}

/** `supabase status` for the local stack, or null when it is not running. */
export async function localStatus() {
  const reply = await runCli(['status', '-o', 'json']);
  try {
    const parsed = parseCliJson(reply);
    return parsed?.API_URL ? parsed : null;
  } catch {
    return null;
  }
}
