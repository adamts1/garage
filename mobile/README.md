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
npm run build:staging:play     # .aab for the staging Play listing, uploaded by hand
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

### Getting a staging build onto someone else's phone

Each store has its own answer, and Android has two.

**iOS — TestFlight, always.** Apple will not let an app onto a phone it has not signed
for that specific device. Ad-hoc distribution means registering every tester's device
UDID *before* the build, and a phone that was not registered at build time gets
`לא ניתן לוודא את שלמותו` and nothing else. That does not work for a garage's staff,
whose phones we never touch. So `staging` is `distribution: "store"` on iOS.

**Android — a link, or the store.** Nothing there refuses to install an app the
platform did not sign, so both work and they are kept as separate profiles:

| | profile | artifact | reaches the tester | cost |
|---|---|---|---|---|
| link | `staging` | `.apk` | immediately, from the URL EAS prints | an unknown-sources warning to talk them through |
| store | `staging-play` | `.aab` | after upload + Play processing | a manual upload each time |

Use the link while iterating; use the store when handing the app to a customer who
should not be walked through a system warning.

### The four store records

Two apps per store, which is only possible because the identities differ:

| | iOS record | Android package |
|---|---|---|
| production | the real app, `ascAppId 6790709441` | `com.tsityat.garageapp` |
| staging | `garage-mobile-staging`, `ascAppId 6797201110` | `com.tsityat.garageapp.staging` |

`release.sh` reads the ascAppId back out of `eas.json` rather than holding its own
copy, so the link it prints cannot point at one app while EAS uploads to the other.

A `staging-play` profile existed once before and was removed — it built a
store-packaged `.aab` against staging under the **production** package name, so the
only thing standing between a staging build and ten real garages was remembering
which version code was which in Play Console. The profile is back under the same
name, and is safe now for one reason only: the package it builds ends in `.staging`,
so Play treats it as a different app and will not accept it into the production
listing at all.

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
| `staging` | preview → staging | staging | staging TestFlight build / `.apk` link |
| `staging-play` | preview → staging | staging | `.aab` for the staging Play listing |
| `production` | production → **prod** | production | App Store build / Play `.aab` |

Every profile but `production` builds the `.staging` identity, and `production` is the
only one that reads the production EAS environment. Those two facts are set in
different files — `app.config.js` and `eas.json` — and `lib/env.ts` compares them at
runtime precisely because nothing else does.

## What it does

- **Ticket list** — search by number, customer, car or plate; filter by status; pull to refresh.
- **Edit screen** — status, priority, assignee, area, type, all the customer/car fields,
  the subtask checklist, notes, and the works + parts table with live totals (incl. VAT).

Saving is optimistic: the screen updates immediately, then the write goes out. If it
fails, the error shows on the list and the state resyncs from the server.

## Code layout

```
app/                 routes only — expo-router files, each a thin wrapper
components/
  ui/                generic: knows how the app looks, nothing about what it is for
  tickets/           the product: tickets, works, parts, customers, vehicles
    tabs/            one file per tab of the ticket editor
  auth/              login, the auth gate, the account sheet
lib/                 client, session, store, theme, i18n, formatting
```

**The one rule:** nothing in `components/ui/` may import from `components/tickets/`,
`components/auth/` or `@garage/shared`. If a component needs to know what a ticket or
a work order is, it is a product component and belongs beside the screen that uses it.
That rule is what keeps `ui/` reusable and the domain folders readable. (`ui/` does
reach for `lib/i18n` — a `Sheet` has a close button, and those words are the same
everywhere.)

Logic worth being sure about is pulled out of its component and tested:
`newTicket.ts` (what a saved ticket contains) and `useTicketPhotos.ts` (the upload
flow). What the *customer* receives is built by `@garage/shared`'s `waMessage`, so
the counter and the phone send one message rather than two.

### Text

Every string the app shows lives in `lib/locales/he.json` and is reached through
`t('a.b.c')` — same library and same call as the web app in `../src/i18n`. The locale
file is this app's own: the phone shows a subset of the product with its own wording,
and strings that must agree across the two (status titles, priorities) already come
from `@garage/shared`.

`lib/i18n.test.ts` guards it three ways: every key used in the source exists, the check
cannot pass vacuously, and no Hebrew literal is left in the code — with no exemptions.

Hebrew that is **data rather than copy** lives in `@garage/shared` instead: a ticket's
flags and default title (`intake.ts`), the customer kinds (`identity.ts`), and the
WhatsApp message (`waMessage.ts`). Those are written into rows the web board reads back,
or sent to a customer — so translating a label must never change them, and the two apps
must never hold separate copies.

## How it relates to the web app

The data layer and types live in `../packages/shared` and are imported by both apps —
they are no longer duplicated here. `metro.config.js` explains what Metro needs in
order to reach outside `mobile/` for that package, and why mobile is deliberately not
an npm workspace.

Auth is shared too: `@garage/shared`'s `resolveAuth` decides what a session means, so
web and mobile cannot disagree. `components/auth/AuthGate.tsx` renders the four states.
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
