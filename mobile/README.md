# מוסך — mobile

An Expo (React Native) app for editing tickets on a phone. Same tables and same rows
as the web app in `../src`, live in both directions: change a status here and the web
board moves.

## Environments — read this first

There are two databases and the app must never confuse them:

| | Supabase project | who reaches it |
|---|---|---|
| **staging** | `poksqsdklnhaumozriqd` | simulators, emulators, `expo start`, internal test builds |
| **production** | `fdztfosbohiwskzfvwaj` | only App Store / TestFlight and Google Play builds |

Three things keep them apart, and they are deliberately independent — each one
catches a different mistake:

1. **The database** comes from EAS environment variables (`environment` in each build
   profile), not from a file in the repo. `eas env:list --environment production`.
2. **The app identity** comes from `APP_VARIANT` in `app.config.js`. Staging builds get
   `.staging` appended to the bundle id / package, the name `מוסך (Staging)`, and the
   `garage-staging://` scheme — so a staging build installs *alongside* the real app
   instead of replacing it, keeps its own session, and cannot be uploaded into the
   production Play listing.
3. **The badge** at the bottom of the screen (`components/EnvBadge.tsx`) reports the
   project the client actually resolved. Silent in production; a yellow `STAGING`
   strip otherwise; **red** if the build's variant and its database disagree — which
   is the one failure the first two cannot catch on their own.

`APP_VARIANT` defaults to staging when unset. Anything not built through an EAS
profile — `expo start`, `expo run:ios`, a local prebuild — is therefore staging.

## Running it

```bash
cd mobile
npm install          # first time only
npx expo start       # then press i / a, or scan the QR code
```

`.env` points at **staging**; it is gitignored and `.env.example` is the template.
Expo only exposes variables prefixed `EXPO_PUBLIC_` to the app, so the names differ
from the web app's `VITE_` ones. After editing `.env`, restart with
`npx expo start -c` — the old value is cached.

`.env.localdb` points at a Supabase running on this machine; copy it over `.env` to
use it. Note the LAN IP rather than `127.0.0.1` — the phone is a different device.

## Builds

Staging — simulators, emulators and testers:

```bash
npm run build:sim:ios          # .app for the iOS simulator
npm run run:sim:ios            # install the latest simulator build (does not build)
npm run build:sim:android      # .apk for an emulator
npm run run:sim:android
npm run testflight:staging     # iOS: build + submit to the staging TestFlight app
npm run build:staging:android  # .apk, installed from the link EAS prints
```

Production — the stores, and the only builds that touch real garages' data:

```bash
npm run testflight             # iOS: build + auto-submit to TestFlight
npm run build:prod:ios         # iOS: build only, submit later with `npm run submit:ios`
npm run build:prod:android     # Android: .aab, uploaded to Play Console by hand
```

Everything except the simulator builds goes through `scripts/release.sh`, which
typechecks first and — the point of the script — **refuses to let uncommitted work be
silently excluded**. EAS builds from a git archive, so anything not committed under
`mobile/` or `packages/shared/` is not in the build. It prompts before continuing, and
prints the platform, profile, branch, commit and target database before it starts.

### Why staging iOS goes through TestFlight and staging Android does not

The `staging` profile distributes differently per platform, which looks inconsistent
until you see what each store allows:

```json
"staging": {
  "ios":     { "distribution": "store" },
  "android": { "distribution": "internal", "buildType": "apk" }
}
```

Apple will not let an app onto a phone it has not signed for that specific device.
Ad-hoc distribution means registering every tester's device UDID *before* the build,
and a phone that was not registered at build time gets `לא ניתן לוודא את שלמותו` and
nothing else. That does not work for a garage's staff, whose phones we never touch.
TestFlight removes the requirement entirely.

Android has no such rule. EAS prints a link, the tester opens it, and the `.apk`
installs — the only friction being the unknown-sources warning. A Play listing for
the staging package would remove that warning, and is not worth its own app record
until someone complains.

The two TestFlight apps are separate App Store Connect records, which is only
possible because the bundle ids differ:

| | App Store Connect record | ascAppId |
|---|---|---|
| production | the real app | `6790709441` |
| staging | `garage-mobile-staging` | `6797201110` |

`release.sh` reads the id back out of `eas.json` rather than holding its own copy, so
the link it prints cannot point at one app while EAS uploads to the other.

Append `-- --local` to any build script to run it on this machine instead of EAS.

**Play submit is not automated.** `submit.production` in `eas.json` only has
`ios.ascAppId`; Android needs a Google Play service account key first. Until then the
AAB is uploaded by hand, and `release.sh android --submit` refuses rather than
pretending.

### Build profiles

| profile | EAS environment → DB | variant | produces |
|---|---|---|---|
| `development` | development → staging | staging | dev client |
| `simulator` | preview → staging | staging | simulator .app / emulator .apk |
| `staging` | preview → staging | staging | staging TestFlight build / .apk |
| `production` | production → **prod** | production | App Store build / Play .aab |

There is no profile that builds a store artifact against staging. There used to be
(`staging-play`), which shipped a staging-pointed AAB into the production Play
listing under the shared package name — one accidental promote away from real
garages. It is gone.

## What it does

- **Ticket list** — search by number, customer, car or plate; filter by status; pull to refresh.
- **Edit screen** — status, priority, assignee, area, type, all the customer/car fields,
  the subtask checklist, notes, and the works + parts table with live totals (incl. VAT).

Saving is optimistic: the screen updates immediately, then the write goes out. If it
fails, the error shows on the list and the state resyncs from the server.

## How it relates to the web app

The data layer and types live in `../packages/shared` and are imported by both apps —
they are no longer duplicated here. `metro.config.js` explains what Metro needs in
order to reach outside `mobile/` for that package, and why mobile is deliberately not
an npm workspace.

Auth is shared too: `@garage/shared`'s `resolveAuth` decides what a session means, so
web and mobile cannot disagree. `components/AuthGate.tsx` renders the four states.
The native build hands the shared package its own Supabase client (`app/_layout.tsx`),
because that one carries the AsyncStorage session config the browser does not need.

## Worth knowing

**Subtasks are a count, not per-item flags.** The schema stores `done` as an integer,
so a ticket is "3 of 5 done", not "items 1, 2 and 5 done". The checklist here closes
tasks *in order* — tapping the third row means the first three are done. That matches
what the web board renders. Per-item ticking would need a schema change.

**`ios/` and `android/` are generated.** Both are gitignored and rebuilt by prebuild on
every EAS build, so `app.config.js` is the single source of truth for native config.
Editing a file under `ios/` will not survive.
