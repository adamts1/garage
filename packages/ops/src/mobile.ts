/* Which mobile build is out there, from which commit, and what has changed since.
 *
 * EAS records `gitCommitHash` on every build: an exact answer — this artifact
 * was built from this commit. Compared against origin/main it gives the
 * distance and, the number that matters, how much of that distance touches
 * code the app BUNDLES. A migration or a web-only screen never reaches a
 * phone, so "37 commits behind" is noise and "13 of them changed mobile/ or
 * packages/shared/" is the sentence you act on.
 *
 * It knows what was BUILT, never what is LIVE. EAS does not know what Apple
 * approved, which TestFlight group has it, or which Play track a file sits in
 * — and for Android production there is no Play submit configured at all, so
 * the .aab goes up by hand and nothing records it. A "current" row means a
 * build exists from current code, not that anybody can install it.
 *
 * Read-only: lists, builds and submits nothing, and does not fetch — the
 * comparison is against whatever origin/main the clone last saw.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repoRoot, runProgram } from './cli.ts';
import type { MobileBuildRow, MobilePlatform, MobileStatus } from './types.ts';

const run = promisify(execFile);

/* Profiles that never leave a developer's machine. A simulator build is not a
   release, and listing it as one buries the rows that are. */
const LOCAL_ONLY = new Set(['development', 'simulator', 'preview']);

export const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['IOS', 'ANDROID'];

/** What the app actually bundles: `packages/shared` is compiled into it. */
const BUNDLED_PATHS = ['mobile', 'packages/shared'];

export const MOBILE_BASE = 'origin/main';

const mobileDir = join(repoRoot, 'mobile');

interface Profile {
  name: string;
  declares: Record<string, unknown> | undefined;
}

/** One build, as `eas build:list --json` returns it. Only the fields used. */
export interface EasBuild {
  id: string;
  platform: MobilePlatform;
  buildProfile: string;
  status: string;
  createdAt?: string;
  completedAt?: string;
  gitCommitHash?: string;
  appVersion?: string;
  appBuildVersion?: string;
  distribution?: string;
  artifacts?: { buildUrl?: string; applicationArchiveUrl?: string };
}

/** Profiles declared in eas.json, in declaration order, release ones only. */
export function releaseProfiles(): Profile[] {
  const eas = JSON.parse(readFileSync(join(mobileDir, 'eas.json'), 'utf8')) as {
    build?: Record<string, Record<string, unknown>>;
  };
  const build = eas.build ?? {};
  return Object.keys(build)
    .filter((p) => !LOCAL_ONLY.has(p))
    .map((name) => ({ name, declares: build[name] }));
}

/* Not every profile is for every platform: `staging-play` builds an .aab and
   means nothing on iOS. A profile applies if it declares the platform, OR if a
   build for that pair exists — `production` names only `android` in eas.json
   and is plainly built for both. */
export const profileApplies = (profile: Profile, platform: MobilePlatform, hasBuild: boolean): boolean =>
  hasBuild || Boolean(profile.declares?.[platform.toLowerCase()]);

/** Throws rather than returning nothing: a logged-out CLI must not render as
 *  "never built" against every row — that reads as "go build all of these",
 *  about apps already in people's hands. */
export async function easBuilds(): Promise<EasBuild[]> {
  const reply = await runProgram(
    'npx',
    ['--yes', 'eas-cli@latest', 'build:list', '--limit', '50', '--non-interactive', '--json'],
    mobileDir,
  );
  const start = reply.stdout.indexOf('[');
  if (start !== -1) {
    try {
      const parsed: unknown = JSON.parse(reply.stdout.slice(start));
      if (Array.isArray(parsed)) return parsed as EasBuild[];
    } catch { /* fall through to the throw */ }
  }
  throw new Error(
    (reply.stderr.trim().split('\n').filter(Boolean).pop() || 'no build list in the reply')
    + ' — are you logged in? try: npx eas-cli login',
  );
}

const git = async (args: string[]): Promise<string> => (await run('git', args, { cwd: repoRoot })).stdout.trim();

async function distance(sha: string) {
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    return { known: false as const };
  }
  const ancestor = await run('git', ['merge-base', '--is-ancestor', sha, MOBILE_BASE], { cwd: repoRoot })
    .then(() => true, () => false);
  const total = Number(await git(['rev-list', '--count', `${sha}..${MOBILE_BASE}`]));
  const bundled = Number(await git(['rev-list', '--count', `${sha}..${MOBILE_BASE}`, '--', ...BUNDLED_PATHS]));
  const log = bundled
    ? (await git(['log', '--oneline', `${sha}..${MOBILE_BASE}`, '--', ...BUNDLED_PATHS])).split('\n')
    : [];
  return { known: true as const, ancestor, total, bundled, log };
}

export async function mobileStatus(): Promise<MobileStatus> {
  const profiles = releaseProfiles();
  const all = await easBuilds();

  const baseCommit = await git(['rev-parse', '--short', MOBILE_BASE]).catch(() => null);
  if (!baseCommit) throw new Error(`no ${MOBILE_BASE} in this clone — run git fetch origin`);

  /* The latest FINISHED build per platform+profile: a failed or in-progress
     one is not what anybody has. The latest attempt is tracked separately so a
     newer failure is still said out loud. */
  const latest = new Map<string, EasBuild>();
  const lastAttempt = new Map<string, EasBuild>();
  for (const b of all) {
    const key = `${b.platform}/${b.buildProfile}`;
    if (!lastAttempt.has(key)) lastAttempt.set(key, b);
    if (b.status === 'FINISHED' && !latest.has(key)) latest.set(key, b);
  }

  const rows: MobileBuildRow[] = [];
  for (const platform of MOBILE_PLATFORMS) {
    for (const profile of profiles) {
      const key = `${platform}/${profile.name}`;
      const b = latest.get(key);
      if (!profileApplies(profile, platform, Boolean(b))) continue;

      if (!b) {
        rows.push({ platform, profile: profile.name, verdict: 'never-built', build: null, behind: null, laterAttempt: null });
        continue;
      }

      const d = await distance(b.gitCommitHash ?? '');
      const verdict: MobileBuildRow['verdict'] = !d.known
        ? 'unknown-commit'
        : !d.ancestor
          ? 'off-main'
          : d.bundled === 0 ? 'current' : 'behind';

      const attempt = lastAttempt.get(key);
      rows.push({
        platform,
        profile: profile.name,
        verdict,
        build: {
          id: b.id,
          appVersion: b.appVersion ?? null,
          buildNumber: b.appBuildVersion ?? null,
          completedAt: b.completedAt ?? b.createdAt ?? null,
          commit: b.gitCommitHash?.slice(0, 7) ?? null,
          artifactUrl: b.artifacts?.buildUrl ?? b.artifacts?.applicationArchiveUrl ?? null,
          distribution: b.distribution ?? null,
        },
        behind: d.known ? { total: d.total, bundled: d.bundled, log: d.log } : null,
        laterAttempt: attempt && attempt.id !== b.id && attempt.status !== 'FINISHED'
          ? { status: attempt.status, createdAt: attempt.createdAt ?? null }
          : null,
      });
    }
  }

  return { base: MOBILE_BASE, baseCommit, rows };
}
