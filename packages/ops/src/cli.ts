/* The Supabase CLI, run as a program.
 *
 * Everything here that talks to the Management API (function lists, function
 * downloads, SQL against a remote database) goes through the CLI rather than
 * through a token of our own: the CLI is already logged in on this machine, and
 * that login is the only credential these reads need. Nothing new to store.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface CliReply {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** The repo's own CLI binary; npx only as the fallback. `npx` is not reliably a
 *  file on PATH — under a Node version manager it can be a shell function, and
 *  execFile() does not use a shell. */
export function cli(): { cmd: string; argv: string[] } {
  const local = join(repoRoot, 'node_modules', '.bin', 'supabase');
  return existsSync(local) ? { cmd: local, argv: [] } : { cmd: 'npx', argv: ['supabase'] };
}

const errorText = (e: unknown, key: 'stdout' | 'stderr'): string => {
  const v = (e as Record<string, unknown> | null)?.[key];
  return v == null ? '' : String(v);
};

/** Runs a program. Resolves with stdout/stderr even on a non-zero exit, so the
 *  caller can read the error the program printed rather than a bare exit code. */
export async function runProgram(cmd: string, argv: string[], cwd: string = repoRoot): Promise<CliReply> {
  try {
    const { stdout, stderr } = await run(cmd, argv, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, DO_NOT_TRACK: '1' },
    });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return {
      ok: false,
      stdout: errorText(e, 'stdout'),
      stderr: errorText(e, 'stderr') || (e instanceof Error ? e.message : String(e)),
    };
  }
}

export async function runCli(argv: string[], { cwd = repoRoot }: { cwd?: string } = {}): Promise<CliReply> {
  const { cmd, argv: pre } = cli();
  return runProgram(cmd, [...pre, ...argv], cwd);
}

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

interface CliError {
  _tag: 'Error';
  error?: { message?: string };
}
const isCliError = (v: unknown): v is CliError =>
  typeof v === 'object' && v !== null && (v as { _tag?: unknown })._tag === 'Error';

/** First meaningful line of whatever the CLI said, for an error message. */
export const firstLine = (s: unknown): string =>
  String(s ?? '').trim().split('\n').find((l) => l.trim()) ?? '';

/** The JSON value in a CLI reply, which may arrive pretty-printed across many
 *  lines or on one line with noise (a PostHog warning, an update notice)
 *  around it. Throws when the CLI reported an error as JSON, or when nothing
 *  parses — an unreadable reply must never read as an empty answer. */
export function parseCliJson({ stdout, stderr }: Pick<CliReply, 'stdout' | 'stderr'>): unknown {
  const start = stdout.search(/[[{]/);
  if (start >= 0) {
    const whole = tryParse(stdout.slice(start));
    if (isCliError(whole)) throw new Error(whole.error?.message ?? 'the CLI reported an error');
    if (whole) return whole;
  }
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    const parsed = tryParse(t);
    if (!parsed) continue;
    if (isCliError(parsed)) throw new Error(parsed.error?.message ?? 'the CLI reported an error');
    return parsed;
  }
  const detail = firstLine(stderr) || `could not read the reply: ${JSON.stringify(stdout.trim().slice(0, 200))}`;
  const looksLikeAuth = /token|login|unauthori[sz]ed|credential|forbidden/i.test(detail);
  throw new Error(detail + (looksLikeAuth ? ' — try: npx supabase login' : ''));
}

/** SQL against one environment's database, read-only by convention: callers
 *  pass SELECTs. `target` is a project ref, or 'local'.
 *
 *  A remote project is queried through `db query --linked`, which uses the
 *  Management API — but "linked" means supabase/.temp/project-ref, and that file
 *  also decides where the next `db push` goes. Re-linking the repo to read a
 *  table would be a quiet way to aim a push at production. So the query runs
 *  from a throwaway workdir that is linked to the target instead, and the
 *  repo's own link is never touched. */
export async function dbQuery(target: string, sql: string): Promise<Record<string, unknown>[]> {
  if (target === 'local') {
    return rowsOf(await runCli(['db', 'query', '--local', '--output-format', 'json', sql]));
  }
  const work = await linkedWorkdir(target);
  return rowsOf(await runCli(['db', 'query', '--linked', '--workdir', work, '--output-format', 'json', sql], { cwd: work }));
}

/* One linked workdir per project, made on first use and kept until the process
   exits.

   It has to be a real `supabase link`, not just a project-ref file. The CLI
   reaches the database through the IPv4 pooler only when link has saved the
   pooler's address (supabase/.temp/pooler-url); without it the CLI falls back to
   the direct host, which is IPv6-only, and on a network without IPv6 every
   query fails with "IPv6 is not supported on your current network". */
const linked = new Map<string, Promise<string>>();

function linkedWorkdir(ref: string): Promise<string> {
  if (!/^[a-z]{20}$/.test(ref)) return Promise.reject(new Error(`not a project ref: ${ref}`));
  let work = linked.get(ref);
  if (!work) {
    work = linkWorkdir(ref);
    linked.set(ref, work);
    // A failed link is not cached: the next request tries again.
    work.catch(() => linked.delete(ref));
  }
  return work;
}

async function linkWorkdir(ref: string): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), `ops-db-${ref}-`));
  process.once('exit', () => rmSync(work, { recursive: true, force: true }));
  mkdirSync(join(work, 'supabase'), { recursive: true });
  const reply = await runCli(['link', '--project-ref', ref, '--workdir', work], { cwd: work });
  if (!reply.ok || !existsSync(join(work, 'supabase', '.temp', 'pooler-url'))) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`could not link ${ref}: ${firstLine(reply.stderr || reply.stdout) || 'no pooler address saved'}`);
  }
  return work;
}

function rowsOf(reply: CliReply): Record<string, unknown>[] {
  const parsed = parseCliJson(reply);
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const rows = (parsed as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error(firstLine(reply.stderr) || 'the query returned no rows field');
}

export interface LocalStatus {
  API_URL: string;
  SERVICE_ROLE_KEY: string;
}

/** `supabase status` for the local stack, or null when it is not running. */
export async function localStatus(): Promise<LocalStatus | null> {
  const reply = await runCli(['status', '-o', 'json']);
  try {
    const parsed = parseCliJson(reply) as Partial<LocalStatus> | null;
    return parsed?.API_URL && parsed.SERVICE_ROLE_KEY
      ? { API_URL: parsed.API_URL, SERVICE_ROLE_KEY: parsed.SERVICE_ROLE_KEY }
      : null;
  } catch {
    return null;
  }
}
