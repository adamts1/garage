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

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENVIRONMENTS = {
  staging: { ref: 'poksqsdklnhaumozriqd', branch: 'origin/staging' },
  production: { ref: 'farpgkljbmlaeiocrore', branch: 'origin/main' },
};

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
const env = ENVIRONMENTS[envName];
if (!env) {
  console.error(c.red(`--env must be one of: ${Object.keys(ENVIRONMENTS).join(', ')}`));
  process.exit(1);
}
const gitRef = args.get('ref') ?? env.branch;

/** Same lookup as functions-status.mjs: the repo's own CLI binary, npx only as
 *  the fallback, because execFile does not go through a shell. */
function cli() {
  const local = join(repoRoot, 'node_modules', '.bin', 'supabase');
  return existsSync(local) ? { cmd: local, argv: [] } : { cmd: 'npx', argv: ['supabase'] };
}

async function git(...argv) {
  return run('git', argv, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024, encoding: 'buffer' });
}

/** A file as it is at the ref, or null when the ref has no such file. */
async function atRef(path) {
  try {
    return (await git('show', `${gitRef}:${path}`)).stdout;
  } catch {
    return null;
  }
}

const atTree = (path) => {
  const p = join(repoRoot, path);
  return existsSync(p) ? readFileSync(p) : null;
};

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** What is running: the function's own files plus the _shared modules it was
 *  deployed with, as paths under supabase/functions. Throws when it cannot
 *  download — an unreadable function must never read as "same". */
async function downloadDeployed(name) {
  const work = mkdtempSync(join(tmpdir(), `fn-${name}-`));
  try {
    const { cmd, argv } = cli();
    try {
      await run(cmd, [...argv, 'functions', 'download', name, '--project-ref', env.ref, '--use-api', '--workdir', work],
        { maxBuffer: 20 * 1024 * 1024, env: { ...process.env, DO_NOT_TRACK: '1' } });
    } catch (e) {
      const why = (e.stderr || e.stdout || e.message || '').toString().trim().split('\n').find((l) => l.trim()) ?? 'download failed';
      throw new Error(why);
    }
    const root = join(work, 'supabase', 'functions');
    if (!existsSync(root)) throw new Error('the download produced no files');
    return walk(root).map((p) => ({ path: join('supabase', 'functions', relative(root, p)), bytes: readFileSync(p) }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function deployedList() {
  const { cmd, argv } = cli();
  const { stdout } = await run(cmd, [...argv, 'functions', 'list', '--project-ref', env.ref, '--output-format', 'json'],
    { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, DO_NOT_TRACK: '1' } });
  const parsed = JSON.parse(stdout.slice(stdout.search(/[[{]/)));
  return Array.isArray(parsed) ? parsed : parsed.functions ?? [];
}

const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;

const main = async () => {
  try {
    await git('rev-parse', '--verify', gitRef);
  } catch {
    console.error(c.red(`unknown ref ${gitRef} — try: git fetch origin`));
    process.exit(1);
  }

  const local = readdirSync(join(repoRoot, 'supabase', 'functions'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
  const live = new Map((await deployedList()).map((f) => [f.slug, f]));

  console.log(`\n${c.bold(envName)} ${c.dim(`(${env.ref})`)} compared with ${c.bold(gitRef)} and the working tree\n`);

  let drift = 0;
  let unreadable = 0;
  for (const name of local) {
    const fn = live.get(name);
    if (!fn) {
      console.log(`${name.padEnd(22)}${c.red('— not deployed')}`);
      drift++;
      continue;
    }
    const meta = c.dim(`v${fn.version} · ${new Date(fn.updated_at).toISOString().slice(0, 10)}`);

    let files;
    try {
      files = await downloadDeployed(name);
    } catch (e) {
      console.log(`${name.padEnd(22)}${meta}  ${c.red(`could not download: ${e.message}`)}`);
      unreadable++;
      continue;
    }

    const offRef = [];
    let matchesTree = true;
    for (const f of files) {
      if (!same(f.bytes, await atRef(f.path))) offRef.push(f.path.replace('supabase/functions/', ''));
      if (!same(f.bytes, atTree(f.path))) matchesTree = false;
    }

    if (!offRef.length) {
      console.log(`${name.padEnd(22)}${meta}  ${c.green(`same as ${gitRef}`)}`);
      continue;
    }
    drift++;
    console.log(`${name.padEnd(22)}${meta}  ${c.yellow(`DIFFERENT from ${gitRef}`)}`
      + (matchesTree ? c.dim('  (matches your working tree)') : ''));
    for (const p of offRef) console.log(`${''.padEnd(24)}${c.dim('• ' + p)}`);
  }

  for (const slug of live.keys()) {
    if (!local.includes(slug)) {
      console.log(`${slug.padEnd(22)}${c.yellow('live, but has no source in this repo')}`);
      drift++;
    }
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
