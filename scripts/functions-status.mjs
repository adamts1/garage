#!/usr/bin/env node
/* Which Edge Function is deployed where, and is it the same code.
 *
 *   node scripts/functions-status.mjs
 *
 * A migration announces itself: `supabase migration list` puts local and remote
 * side by side, because the database keeps a table of what it has applied.
 * Functions keep no such record, and `db push` does not touch them — so the one
 * half of a change that is invisible is the half nobody deploys.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU
 *
 * `functions list` returns an `ezbr_sha256` per function: a hash of the bundle
 * actually running. Two environments with the same hash are running the same
 * code, full stop — which makes "is production behind staging" a question with
 * a real answer rather than a guess off two timestamps.
 *
 * It does NOT answer "does this match my working tree". The hash is of a bundle
 * built server-side, and nothing local reproduces it. For that there is
 * `supabase functions download <name>` and a diff — slow, and worth it before a
 * release. This script says which functions are worth that trouble.
 *
 * Read-only. It lists; it deploys nothing.
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The CLI as a real program rather than a name the shell would have resolved.
 *  `npx` is not reliably a file on PATH — under a Node version manager it can be
 *  a shell function, and execFile() does not use a shell, so the failure arrives
 *  worded as a problem with Supabase rather than with the lookup. The dependency
 *  is in this repo, so prefer its binary; npx stays as the fallback for a tree
 *  with no node_modules. */
function cli() {
  const local = join(repoRoot, 'node_modules', '.bin', 'supabase');
  return existsSync(local) ? { cmd: local, argv: [] } : { cmd: 'npx', argv: ['supabase'] };
}

const ENVIRONMENTS = [
  { name: 'staging', ref: 'poksqsdklnhaumozriqd' },
  { name: 'production', ref: 'fdztfosbohiwskzfvwaj' },
];

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** The functions in this repo — the source of truth for what SHOULD exist.
 *  _shared holds modules the functions import, not functions of its own. */
function localFunctions() {
  return readdirSync('supabase/functions', { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
}

const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** The function array out of whichever shape the reply arrived in. The CLI has
 *  two: `{"functions":[...]}` on one line, and a bare `[...]` pretty-printed
 *  across many. Which one you get depended, before the explicit flag below, on
 *  whether stdout was a terminal — so the same command answered differently by
 *  hand and from a script. */
const functionsIn = (v) =>
  Array.isArray(v) ? v : Array.isArray(v?.functions) ? v.functions : null;

/** This THROWS when it cannot get an answer, and that is the important part.
 *  The first version returned an empty list instead, so a CLI that was not
 *  logged in, rate-limited or simply having a bad minute rendered as "— not
 *  deployed" against every function — which is the one wrong answer this tool
 *  must never give. It reads as "deploy all of these", about functions that are
 *  already live. Silence and nothing are not the same fact. */
async function deployed(ref) {
  const { cmd, argv } = cli();
  let stdout = '';
  let stderr = '';
  try {
    /* Ask for the format outright. Left to the CLI, it prints a table for a
       human and JSON for a pipe — which is a fine default and a bad thing to
       depend on, because the one that reaches here is then a property of how
       the script was launched rather than of what was asked for. */
    ({ stdout, stderr } = await run(
      cmd,
      [...argv, 'functions', 'list', '--project-ref', ref, '--output-format', 'json'],
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (e) {
    // A non-zero exit still carries the useful text on one of the two streams.
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? e.message ?? '';
  }

  // Whole body first — that is the multi-line shape, which no per-line pass
  // can read, since its opening line is a lone bracket that parses as nothing.
  const whole = functionsIn(tryParse(stdout));
  if (whole) return whole;

  // Then line by line, for the single-line shape with noise around it — a
  // PostHog shutdown warning, most often.
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{') && !line.trim().startsWith('[')) continue;
    const parsed = tryParse(line);
    if (!parsed) continue;
    const fns = functionsIn(parsed);
    if (fns) return fns;
    /* The CLI reports its own failures as JSON too. Left unrecognised, this
       line looks exactly like noise, and the loop would fall off the end and
       call it an empty project. */
    if (parsed._tag === 'Error') {
      throw new Error(parsed.error?.message ?? 'the CLI reported an error');
    }
  }

  /* Quote what actually arrived. The previous wording — "no function list in
     the reply, are you logged in?" — named the one cause it could not have
     been: a rejected login says so on stderr, and this branch is only reached
     when stderr is empty. The guess was appended to every failure alike, so it
     sent the reader to re-authenticate an account that was working fine. */
  const detail = stderr.trim().split('\n')[0]
    || `could not read the reply: ${JSON.stringify(stdout.trim().slice(0, 200)) || '(nothing on stdout)'}`;
  const looksLikeAuth = /token|login|unauthori[sz]ed|credential|forbidden/i.test(detail);
  throw new Error(detail + (looksLikeAuth ? ' — try: npx supabase login' : ''));
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const main = async () => {
  const local = localFunctions();

  const byEnvironment = new Map();
  for (const env of ENVIRONMENTS) {
    try {
      const list = await deployed(env.ref);
      byEnvironment.set(env.name, new Map(list.map((f) => [f.slug, f])));
    } catch (e) {
      console.error(c.red(`could not reach ${env.name}: ${e.message.split('\n')[0]}`));
      byEnvironment.set(env.name, null);
    }
  }

  console.log(`\n${c.bold('function').padEnd(28)}${ENVIRONMENTS.map((e) => c.bold(e.name).padEnd(34)).join('')}`);
  console.log(c.dim('─'.repeat(28 + ENVIRONMENTS.length * 26)));

  const problems = [];

  for (const name of local) {
    const cells = ENVIRONMENTS.map((env) => {
      const map = byEnvironment.get(env.name);
      if (!map) return c.dim('unknown').padEnd(34);
      const fn = map.get(name);
      if (!fn) {
        problems.push(`${name} has never been deployed to ${env.name}`);
        return c.red('— not deployed').padEnd(34);
      }
      return `v${fn.version} · ${day(fn.updated_at)} · ${c.dim(fn.ezbr_sha256.slice(0, 8))}`.padEnd(43);
    });
    console.log(name.padEnd(28) + cells.join(''));

    /* The comparison the hash makes possible: same bundle, or not. Only
       meaningful where the function exists in both. */
    const hashes = ENVIRONMENTS
      .map((env) => byEnvironment.get(env.name)?.get(name)?.ezbr_sha256)
      .filter(Boolean);
    if (hashes.length === ENVIRONMENTS.length) {
      const same = hashes.every((h) => h === hashes[0]);
      console.log('  '.padEnd(28) + (same
        ? c.green('↳ same code in both')
        : c.yellow('↳ the environments are running DIFFERENT code')));
      if (!same) problems.push(`${name} differs between staging and production`);
    }
  }

  // Deployed somewhere but gone from the repo — a function nobody maintains.
  for (const env of ENVIRONMENTS) {
    const map = byEnvironment.get(env.name);
    if (!map) continue;
    for (const slug of map.keys()) {
      if (!local.includes(slug)) problems.push(`${slug} is live on ${env.name} but has no source in this repo`);
    }
  }

  console.log();

  /* An environment nobody could read is reported as exactly that, and takes the
     exit code with it. Anything else invites the table to be read as a deploy
     list for functions that are already running. */
  const unreachable = ENVIRONMENTS.filter((e) => !byEnvironment.get(e.name));
  if (unreachable.length) {
    console.log(c.red(`Could not read: ${unreachable.map((e) => e.name).join(', ')}.`));
    console.log(c.red('Those columns say nothing about what is deployed there — see the error above.'));
    process.exitCode = 1;
  }

  if (problems.length === 0 && !unreachable.length) {
    console.log(c.green('Every function is deployed everywhere, and the environments agree.'));
  } else if (problems.length) {
    console.log(c.bold('Worth a look:'));
    for (const p of problems) console.log(`  ${c.yellow('•')} ${p}`);
  }

  console.log(c.dim(`
The hash says whether two environments run the same bundle. It cannot say
whether either matches your working tree — for that:

  npx supabase functions download <name> --project-ref <ref>

and diff it. Deploy with:

  npm run functions:push <name>          # staging
  npm run functions:push:prod <name>     # production
`));
};

main().catch((e) => {
  console.error(c.red(e.stack ?? String(e)));
  process.exit(1);
});
