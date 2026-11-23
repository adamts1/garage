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

/* The reading and the comparison live in packages/ops (mobile.ts), shared with
   the admin console's mobile tab. This file prints them. */
import { MOBILE_BASE as BASE, mobileStatus } from '../packages/ops/src/index.ts';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const VERDICT = {
  current: (r) => (r.behind?.total ? c.green(`current ${c.dim(`(${r.behind.total} unrelated)`)}`) : c.green('current')),
  behind: (r) => c.yellow(`${r.behind.bundled} of ${r.behind.total} commits change the app`),
  'off-main': () => c.yellow('built off a commit not on main'),
  'unknown-commit': () => c.dim('commit not in this clone'),
  'never-built': () => c.red('never built'),
};

const main = async () => {
  let status;
  try {
    status = await mobileStatus();
  } catch (e) {
    console.error(c.red(`could not read the build list: ${e.message}`));
    process.exit(1);
  }

  console.log(`\ncomparing against ${c.bold(BASE)} at ${c.bold(status.baseCommit)} ${c.dim('(not fetched — run git fetch for a fresher answer)')}\n`);
  console.log(c.bold('platform'.padEnd(11)) + c.bold('profile'.padEnd(16)) + c.bold('built'.padEnd(13))
    + c.bold('commit'.padEnd(10)) + c.bold('behind'));
  console.log(c.dim('─'.repeat(78)));

  const problems = [];
  const details = [];

  for (const r of status.rows) {
    const key = `${r.platform}/${r.profile}`;
    const row = r.platform.toLowerCase().padEnd(11) + r.profile.padEnd(16);
    if (!r.build) {
      console.log(row + c.dim('—'.padEnd(13)) + c.dim('—'.padEnd(10)) + VERDICT['never-built'](r));
      problems.push(`${key} is a declared profile with no build at all`);
      continue;
    }
    const when = (r.build.completedAt ?? '').slice(0, 10);
    console.log(row + when.padEnd(13) + (r.build.commit ?? '').padEnd(10) + VERDICT[r.verdict](r));
    if (r.verdict === 'off-main') problems.push(`${key} was built from ${r.build.commit}, which is not on ${BASE}`);
    if (r.verdict === 'behind') {
      const n = r.behind.bundled;
      problems.push(`${key} is missing ${n} commit${n === 1 ? '' : 's'} that change what the app bundles`);
      details.push({ key, log: r.behind.log });
    }
    if (r.laterAttempt) {
      console.log(' '.repeat(27) + c.dim(`↳ a later ${r.laterAttempt.status.toLowerCase()} build exists (${(r.laterAttempt.createdAt ?? '').slice(0, 10)})`));
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
