#!/usr/bin/env node
/* Is the code running in an environment the code in git?
 *
 *   node scripts/functions-drift.mjs --env staging                 # vs origin/staging
 *   node scripts/functions-drift.mjs --env production              # vs origin/main
 *   node scripts/functions-drift.mjs --env staging --ref <branch>  # vs any ref
 *
 * functions-status.mjs compares staging with production, by bundle hash. That
 * says whether the two environments agree, and nothing about whether either
 * agrees with git — so a function deployed from a branch that was never merged
 * looks exactly like one deployed from the branch it should have come from.
 * Hashes cannot answer that: the bundle is built server-side and nothing local
 * reproduces it.
 *
 * So this downloads what is actually running (`functions download --use-api`,
 * no Docker needed) and compares it byte for byte with the files at the ref,
 * and with the working tree. It reads `_shared/` modules too, since a function
 * runs whichever copy of them it was deployed with.
 *
 * Read-only. It downloads into a temporary directory and deploys nothing.
 */

import {
  environment,
  environmentDrift,
} from '../packages/ops/src/index.ts';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const envName = args.get('env') ?? 'staging';
let env;
try {
  env = environment(envName);
  if (!env.ref) throw new Error();
} catch {
  console.error(c.red('--env must be one of: staging, production'));
  process.exit(1);
}
const gitRef = args.get('ref') ?? env.gitRef;

/* The comparison itself lives in packages/ops (functions.ts), shared with the
   admin console. This file only prints it. */
const main = async () => {
  let report;
  try {
    report = await environmentDrift(env.id, gitRef);
  } catch (e) {
    console.error(c.red(e.message));
    process.exit(1);
  }

  console.log(`\n${c.bold(envName)} ${c.dim(`(${env.ref})`)} compared with ${c.bold(gitRef)} and the working tree\n`);

  let drift = 0;
  let unreadable = 0;
  for (const r of report.results) {
    const name = r.name;
    if (r.noSource) {
      console.log(`${name.padEnd(22)}${c.yellow('live, but has no source in this repo')}`);
      drift++;
      continue;
    }
    if (!r.deployed) {
      console.log(`${name.padEnd(22)}${c.red('— not deployed')}`);
      drift++;
      continue;
    }
    const meta = c.dim(`v${r.version} · ${new Date(r.updatedAt).toISOString().slice(0, 10)}`);
    if (r.error) {
      console.log(`${name.padEnd(22)}${meta}  ${c.red(`could not download: ${r.error}`)}`);
      unreadable++;
      continue;
    }
    if (r.sameAsRef) {
      console.log(`${name.padEnd(22)}${meta}  ${c.green(`same as ${gitRef}`)}`);
      continue;
    }
    drift++;
    console.log(`${name.padEnd(22)}${meta}  ${c.yellow(`DIFFERENT from ${gitRef}`)}`
      + (r.matchesTree ? c.dim('  (matches your working tree)') : ''));
    for (const p of r.offRef) console.log(`${''.padEnd(24)}${c.dim('• ' + p)}`);
  }

  console.log();
  if (unreadable) {
    console.log(c.red(`${unreadable} function(s) could not be read — those rows say nothing about what is deployed.`));
    process.exitCode = 1;
  }
  if (!drift && !unreadable) {
    console.log(c.green(`${envName} runs exactly the functions in ${gitRef}.`));
  } else if (drift) {
    console.log(c.yellow(`${drift} function(s) on ${envName} do not match ${gitRef}.`));
    console.log(c.dim(`Deployed from an unmerged branch, or ${gitRef} moved on since the last deploy.`));
    console.log(c.dim(`Deploy ${gitRef}'s code with: npm run functions:push${envName === 'production' ? ':prod' : ''} <name>`));
    process.exitCode = 1;
  }
  console.log();
};

main().catch((e) => {
  console.error(c.red(e.stack ?? String(e)));
  process.exit(1);
});
