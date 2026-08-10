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
import { readdirSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

/** The CLI prints JSON on stdout and is prone to trailing noise — a PostHog
 *  shutdown warning, most often. Take the line that parses, not the whole
 *  stream. */
async function deployed(ref) {
  const { stdout } = await run('npx', ['supabase', 'functions', 'list', '--project-ref', ref], {
    maxBuffer: 10 * 1024 * 1024,
  });
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed.functions)) return parsed.functions;
    } catch { /* not the line we want */ }
  }
  return [];
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
  if (problems.length === 0) {
    console.log(c.green('Every function is deployed everywhere, and the environments agree.'));
  } else {
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
