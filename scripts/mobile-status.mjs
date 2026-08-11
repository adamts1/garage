#!/usr/bin/env node
/* Which mobile build is out there, from which commit, and what has changed since.
 *
 *   node scripts/mobile-status.mjs
 *
 * The twin of functions-status.mjs, for the half of the system that ships as an
 * app instead of a deploy. A migration announces itself and an Edge Function has
 * a hash you can compare; a phone build has neither. It was made a week ago from
 * a commit nobody wrote down, and the only honest question — "does what people
 * have installed still match what we think it does" — had no way to be asked.
 *
 * WHAT THIS CAN TELL YOU
 *
 * EAS records `gitCommitHash` on every build. That is an exact answer, not an
 * inference off a timestamp: this artifact was built from this commit. Compared
 * against origin/main it gives the distance, and — the number that actually
 * matters — how much of that distance touches code the app BUNDLES.
 *
 * Most commits do not. A migration, an Edge Function, a web-only screen: none of
 * them reach a phone. "37 commits behind" is noise. "13 of them changed
 * mobile/ or packages/shared/" is the sentence you act on. So both are printed,
 * and the second one is what colours the row.
 *
 * WHAT IT CANNOT
 *
 * It knows what was BUILT, never what is LIVE. EAS does not know what Apple
 * approved, which TestFlight group has it, or which Play track a file sits in.
 * For Android production it cannot know anything by construction — there is no
 * Play submit configured (see scripts/release.sh), so the .aab is uploaded by
 * hand and nothing records that here.
 *
 * So: a green row means "a build exists from current code". It does not mean
 * anybody can install it. That gap is real and this tool does not paper over it.
 *
 * Read-only. It lists; it builds and submits nothing. It does not fetch either —
 * the comparison is against whatever origin/main your clone last saw, and the
 * header says so, because a tool that silently moved your refs to answer a
 * question would be a worse tool.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

/* The profiles worth reporting, and the order to read them in. Taken from
   eas.json rather than hardcoded, minus the ones that never leave a developer's
   machine — a simulator build is not a release and listing it as one buries the
   three rows that are. */
const LOCAL_ONLY = new Set(['development', 'simulator', 'preview']);

const PLATFORMS = ['IOS', 'ANDROID'];

/** What the app actually bundles. Everything else can change freely without a
 *  phone being one commit out of date. `packages/shared` is linked in as a
 *  `file:` dependency and its source is compiled into the app — the same reason
 *  release.sh checks it for uncommitted changes. */
const BUNDLED_PATHS = ['mobile', 'packages/shared'];

const BASE = 'origin/main';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Profiles declared in eas.json, in declaration order, release ones only. */
function releaseProfiles() {
  const eas = JSON.parse(readFileSync(new URL('../mobile/eas.json', import.meta.url), 'utf8'));
  const build = eas.build ?? {};
  return Object.keys(build)
    .filter((p) => !LOCAL_ONLY.has(p))
    .map((name) => ({ name, declares: build[name] }));
}

/* Not every profile is for every platform: `staging-play` builds an .aab and
   means nothing on iOS. Printing a red "never built" against it would be the
   one wrong answer this kind of tool must never give — an instruction to go
   build something that does not exist.
 *
 * A profile's own eas.json entry is not enough to decide, because `production`
 * names only `android` there and is plainly built for both. So: it applies if
 * the profile declares that platform, OR if a build for that pair exists. What
 * remains — declared for neither, built for neither — is genuinely not a thing,
 * and gets no row. */
const applies = (profile, platform, hasBuild) =>
  hasBuild || Boolean(profile.declares?.[platform.toLowerCase()]);

/* Throws rather than returning nothing, for the reason functions-status.mjs
   documents at length: a CLI that is logged out or rate-limited must not render
   as "never built" against every row. That reads as "go build all of these",
   about apps that are already in people's hands. */
async function builds() {
  let stdout = '';
  let stderr = '';
  try {
    ({ stdout, stderr } = await run(
      'npx',
      ['--yes', 'eas-cli@latest', 'build:list', '--limit', '50', '--non-interactive', '--json'],
      { cwd: new URL('../mobile', import.meta.url).pathname, maxBuffer: 32 * 1024 * 1024 },
    ));
  } catch (e) {
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? e.message ?? '';
  }

  // The CLI prefixes progress lines; take the JSON array, not the whole stream.
  const start = stdout.indexOf('[');
  if (start !== -1) {
    try {
      const parsed = JSON.parse(stdout.slice(start));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through to the throw */ }
  }

  throw new Error(
    (stderr.trim().split('\n').filter(Boolean).pop() || 'no build list in the reply')
    + ' — are you logged in? try: npx eas-cli login',
  );
}

const git = async (args) => (await run('git', args)).stdout.trim();

/** How far a built commit is from the base, and how much of that reaches a phone. */
async function distance(sha) {
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    return { known: false };
  }
  const ancestor = await run('git', ['merge-base', '--is-ancestor', sha, BASE])
    .then(() => true, () => false);
  const total = Number(await git(['rev-list', '--count', `${sha}..${BASE}`]));
  const bundled = Number(await git(['rev-list', '--count', `${sha}..${BASE}`, '--', ...BUNDLED_PATHS]));
  const log = bundled
    ? (await git(['log', '--oneline', `${sha}..${BASE}`, '--', ...BUNDLED_PATHS])).split('\n')
    : [];
  return { known: true, ancestor, total, bundled, log };
}

const main = async () => {
  const profiles = releaseProfiles();

  let all;
  try {
    all = await builds();
  } catch (e) {
    console.error(c.red(`could not read the build list: ${e.message}`));
    process.exit(1);
  }

  /* The latest FINISHED build per platform+profile. Deliberately not the latest
     build of any status: a failed or in-progress one is not what anybody has,
     and showing it would answer a question nobody asked. It IS worth saying
     when the most recent attempt failed, so that is tracked separately. */
  const latest = new Map();
  const lastAttempt = new Map();
  for (const b of all) {
    const key = `${b.platform}/${b.buildProfile}`;
    if (!lastAttempt.has(key)) lastAttempt.set(key, b);
    if (b.status === 'FINISHED' && !latest.has(key)) latest.set(key, b);
  }

  const base = await git(['rev-parse', '--short', BASE]).catch(() => null);
  if (!base) {
    console.error(c.red(`no ${BASE} in this clone — nothing to compare against.`));
    process.exit(1);
  }

  console.log(`\ncomparing against ${c.bold(BASE)} at ${c.bold(base)} ${c.dim('(not fetched — run git fetch for a fresher answer)')}\n`);
  console.log(c.bold('platform'.padEnd(11)) + c.bold('profile'.padEnd(16)) + c.bold('built'.padEnd(13))
    + c.bold('commit'.padEnd(10)) + c.bold('behind'));
  console.log(c.dim('─'.repeat(78)));

  const problems = [];
  const details = [];

  for (const platform of PLATFORMS) {
    for (const profile of profiles) {
      const key = `${platform}/${profile.name}`;
      const b = latest.get(key);
      if (!applies(profile, platform, Boolean(b))) continue;

      const row = platform.toLowerCase().padEnd(11) + profile.name.padEnd(16);

      if (!b) {
        console.log(row + c.dim('—'.padEnd(13)) + c.dim('—'.padEnd(10)) + c.red('never built'));
        problems.push(`${key} is a declared profile with no build at all`);
        continue;
      }

      const when = (b.completedAt ?? b.createdAt ?? '').slice(0, 10);
      const sha = (b.gitCommitHash ?? '').slice(0, 7);
      const d = await distance(b.gitCommitHash ?? '');

      let verdict;
      if (!d.known) {
        verdict = c.dim('commit not in this clone');
      } else if (!d.ancestor) {
        verdict = c.yellow('built off a commit not on main');
        problems.push(`${key} was built from ${sha}, which is not on ${BASE}`);
      } else if (d.bundled === 0) {
        verdict = d.total === 0 ? c.green('current') : c.green(`current ${c.dim(`(${d.total} unrelated)`)}`);
      } else {
        verdict = c.yellow(`${d.bundled} of ${d.total} commits change the app`);
        problems.push(`${key} is missing ${d.bundled} commit${d.bundled === 1 ? '' : 's'} that change what the app bundles`);
        details.push({ key, log: d.log });
      }

      console.log(row + when.padEnd(13) + sha.padEnd(10) + verdict);

      const attempt = lastAttempt.get(key);
      if (attempt && attempt.id !== b.id && attempt.status !== 'FINISHED') {
        console.log(' '.repeat(27) + c.dim(`↳ a later ${attempt.status.toLowerCase()} build exists (${(attempt.createdAt ?? '').slice(0, 10)})`));
      }
    }
  }

  console.log();

  if (!problems.length) {
    console.log(c.green('Every release profile has a build from current code.'));
  } else {
    console.log(c.bold('Worth a look:'));
    for (const p of problems) console.log(`  ${c.yellow('•')} ${p}`);
    /* Capped, because a profile last built in July is missing forty commits and
       the wall of them buries the three rows that matter. Said out loud rather
       than trimmed quietly: a list that stops without saying so reads as the
       whole list. */
    const SHOWN = 8;
    for (const { key, log } of details) {
      console.log(`\n  ${c.bold(key)} is missing:`);
      for (const line of log.slice(0, SHOWN)) console.log(`      ${line}`);
      if (log.length > SHOWN) {
        console.log(c.dim(`      … and ${log.length - SHOWN} older commits — git log ${BASE} --oneline -- mobile packages/shared`));
      }
    }
  }

  console.log(c.dim(`
This says what was BUILT, never what is LIVE. EAS does not know what Apple
approved, which TestFlight group has it, or which Play track a file sits in —
and for android/production it cannot know at all, because there is no Play
submit configured and the .aab goes up by hand.

Build with, from mobile/:

  npm run testflight:staging      # ios staging  -> TestFlight
  npm run build:staging:android   # android staging, installable .apk
  npm run testflight              # ios production -> TestFlight
  npm run build:prod:android      # android production .aab, upload by hand
`));
};

main().catch((e) => {
  console.error(c.red(e.stack ?? String(e)));
  process.exit(1);
});
