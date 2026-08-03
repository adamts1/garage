# How development works

Companion to `PRODUCTION.md`. That document says *what* we are building and why.
This one says *how work moves* — from an edit on your laptop to a garage using it.

---

## 1. One repository

There is no second repo and there should not be. Web and mobile share a data
layer, a `Ticket` type, and the arithmetic that decides what a customer owes.
When they lived in two copies they had already drifted 241 lines apart
(`PRODUCTION.md` §3.8).

```
/                    web app (Vite + React)
  src/               web UI
  packages/shared/   types, data layer, catalog, money math   <- both apps
  mobile/            Expo app (its own node_modules, see below)
  supabase/          migrations, seed
  docs/              this and PRODUCTION.md
```

**Mobile is deliberately not an npm workspace.** Hoisting its dependencies to
the repo root would change the paths `ios/Podfile` resolves against. It links
`@garage/shared` as a `file:` dependency instead, so `mobile/node_modules` stays
put and the native project is untouched by the monorepo layout.

**Install order matters:** `npm ci` at the root *before* `npm ci` in `mobile/`.
TypeScript follows into the shared package's source, so resolving its imports
walks up to the root `node_modules`. CI enforces this; a fresh clone must too.

---

## 2. Three environments

| | database | region | who uses it | data |
|---|---|---|---|---|
| **Local** | `garage-staging` | Frankfurt | you, while developing | seeded copy |
| **Staging** | `garage-staging` | Frankfurt | rehearsing migrations | seeded copy |
| **Production** | `garage-production` | Frankfurt | the deployed site and TestFlight builds | real |

Local development points at **staging**, so a junk ticket created while testing
never lands in real data. The deployed Netlify site and TestFlight builds point
at **production**.

Two independent things, frequently confused:

- **Your app's connection** comes from `.env.local` / `mobile/.env` (local) or
  the Netlify / EAS dashboards (deployed).
- **The Supabase CLI link** (`supabase/.temp/project-ref`) decides where
  `db push` and `db reset` go — and nothing else.

They can point at different projects at the same time, and usually do.

> Both projects are in `eu-central-1` (Frankfurt), ~60–80ms from Israel. The
> original demo project in Seoul was ~250–300ms on every board interaction and
> has been deleted; regions cannot be changed after a project is created, which
> is why moving meant a new project rather than a setting.

### Before anything destructive

```bash
cat supabase/.temp/project-ref
```

`db push` adds and is safe. `db reset` **drops and rebuilds**. Same two letters,
very different day.

---

## 3. The daily loop

```
branch from main
   ↓
edit  (+ a migration if the schema changes)
   ↓
test locally against staging      npm run dev
   ↓
push → PR → CI
   ↓
merge
   ↓
deploy
```

CI runs on every PR and blocks the merge:

| job | what it proves |
|---|---|
| web | typecheck, tests, build |
| mobile | typecheck |
| migrations | every migration applies to a **clean** database, then loads the seed |

That third job is the one that has caught real problems — a baseline missing two
production columns, and a seed file that could not load. Trust it.

**A failing `scrub.test.ts` is a security issue, not a style nit.** It is what
keeps customer names and phone numbers out of Sentry.

---

## 4. Schema changes

Never edit the database by hand. Never edit an applied migration — fix it with a
new one. Nothing in `migrations/` may drop a table.

```bash
npm run db:new add_something        # create the migration file
# ... write it ...
npx supabase db reset               # test on a clean LOCAL database
git push                            # CI re-tests on a clean database
# merge, then:

npx supabase link --project-ref poksqsdklnhaumozriqd   # staging
npx supabase db push
# check staging still works, then:

npx supabase link --project-ref fdztfosbohiwskzfvwaj   # production
npx supabase db push
```

Staging always goes first. It exists so a migration meets real Supabase
infrastructure somewhere that does not matter.

### Grants are not policies, and neither is inherited

A **policy** decides which rows a role may see. A **grant** decides whether the
role may address the table at all, and *RLS is never consulted without one*.
Both are required. Write both, in the migration, every time.

`service_role` bypasses RLS. It does **not** bypass grants. Conflating those two
is what made the onboarding script work against staging and fail on a clean
database.

Never inherit either from the platform. Tables created by a migration are owned
by `postgres`; its default ACL locally gives `anon` and `service_role` no
`SELECT`, while hosted projects were provisioned under `supabase_admin`'s
default ACL, which grants full DML. So the same migration produces a working
database on staging and a database that rejects every query locally — and the
difference is invisible until something reads a table. `supabase db diff` does
not report it.

---

## 5. Accounts

There is no signup. Accounts are created by an operator, together with the
membership that joins them to a garage:

```bash
npm run onboard -- --garage "מוסך הרצל" --email avi@example.com --admin
```

It prints a generated password once and stores it nowhere. Pass `--garage-id` to
add someone to a garage that already exists, or `--password` to set a memorable
one for handover — worth changing after the first login, since these accounts
read customer PII. An existing email is left with its password untouched, so
`--password` cannot be used to reset one; do that from the Supabase dashboard.

> **`--garage` is the name the garage will see and the name its customers will
> see.** It heads the sidebar after login, names the browser tab, signs the
> WhatsApp quote and the ready-for-pickup notice, and heads the printed work
> order and invoice copy. Type it as the business would write it on a sign —
> there is no separate display-name field, and no screen to edit it later
> (change it in the `garages` table). Until 2026-07-30 all of those read a
> constant, so every garage on the system introduced itself as the first one we
> onboarded.

### 5.0 Admin or member

Two roles, and one distinction: **only an admin may change the name or the price
of a work already on a ticket** — the numbers a customer is charged. A member
does everything else, including adding a work, removing one, editing its parts,
and writing the note that records what was actually done.

`--admin` is how it is set, and this script is the only place it is ever set.
There is deliberately **no in-app role editor**: a garage with one admin who
demoted themselves would need the service_role key to get their price list back.

Default is `member`, so the flag has to be passed for the person who owns the
garage. The reverse default would mean every mechanic added later silently got
the keys to the price list.

```bash
npm run onboard -- --garage-id <uuid> --email mechanic@example.com   # a member
```

The UI reads the role to decide whether to render an editable price, but that is
not the boundary — `save_ticket_works` re-checks it in the database, against the
values as they were **before** the save. It has to be checked there rather than
in a policy, because the function replaces a ticket's works wholesale: at the
row level an edit and an addition are the same INSERT, so the previous value has
to be in scope for the rule to be expressible at all.

Everyone who existed when the roles landed became an admin. Silently demoting the
person who onboarded the garage would have locked them out of their own prices.

### A new garage starts empty

No works, no parts, no workers. It was the reverse until 2026-07-30: every new
garage was handed a copy of the standard ten works and twenty-four parts, which
inverted the first day's work into deleting parts it does not stock and
re-pricing works it does not offer — and a part left behind reads as real stock
at a price nobody chose.

Pass `--catalog` to seed the standard catalog anyway, which is what demos and
smoke tests want:

```bash
npm run onboard -- --catalog --garage "מוסך הדגמה" --email demo@example.com
```

Workers are never seeded, because there is no plausible guess: the garage enters
its own staff on the עובדים screen. Until it does, tickets are created
unassigned, which the board shows as `לא הוקצה`. See §5.1.

### 5.1 Workers are the garage's own

A ticket's `assignee` holds a `garage_workers.code`, unique within the garage,
and the column is nullable — unassigned is a real state, not a default person.

Until 2026-07-30 the assignable mechanics were four invented people hardcoded in
`packages/shared/src/types.ts` (`dk` דני כהן, `il` עידו לוי, `ns` נועה שמש,
`am` אבי מזרחי), and the set was pinned in the database by
`check (assignee in ('dk','il','ns','am')) default 'dk'`. Every garage saw the
same four strangers, could not record who actually did the job, and the web
create form — which never had a technician picker — silently attributed every
ticket it made to דני כהן.

A foreign key on `(garage_id, assignee)` now makes a worker who does not exist
unrepresentable, rather than merely filtered out of a dropdown.

Retire a worker with the השבת button (`active = false`) rather than deleting
them: the picker drops them while every ticket they ever closed still resolves to
their name. Deleting is allowed and unassigns their tickets
(`on delete set null (assignee)`), which loses that history — so the confirmation
says how many tickets it would affect.

`SUPABASE_SERVICE_ROLE_KEY` goes in `.env.local`, which is gitignored. The npm
script passes `--env-file=.env.local`, because **node does not read .env files
on its own** — only Vite does, and only for `VITE_`-prefixed names. The URL is
taken from `SUPABASE_URL`, falling back to `VITE_SUPABASE_URL`.

> **Never name it `VITE_SUPABASE_SERVICE_ROLE_KEY`.** Vite bakes every
> `VITE_`-prefixed variable into the browser bundle, and this key bypasses RLS
> *and* every grant. The absent prefix is what keeps it out of the bundle — the
> naming is load-bearing, not stylistic. The project URL has no such problem: it
> already ships in the bundle and the APK.

The script refuses to run if the key is not a `service_role` key, or if the key
and the URL name different projects. That second check exists because they come
from different places — the URL usually from `.env.local`, the key exported by
hand — and the dangerous case is not a key that fails to authenticate but one
that succeeds against a project you did not mean to write to.

To target production, use `onboard:prod`, which reads `.env.production.local`
instead of `.env.local`:

```bash
npm run onboard:prod -- --garage "..." --email ...
```

Copy `.env.production.local.example` to `.env.production.local` once and fill in
the production URL and `service_role` key. `.gitignore` matches `.env.*.local`,
so that file cannot be committed.

Nothing about the two commands differs except which env file they load —
`onboard` and `onboard:prod` run the same script, so the `service_role` and
project-match checks above apply to both. The one-off override still works when
you want a target that has no env file:

```bash
SUPABASE_URL=https://fdztfosbohiwskzfvwaj.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<production key> \
  node scripts/onboard-garage.mjs --garage "..." --email ...
```

It keeps working because `--env-file` populates `process.env` before the script
runs, and the script's own `loadEnvFile('.env.local')` does not overwrite names
that are already set. That is also why `onboard:prod` cannot be silently
redirected to staging by `.env.local`.

**Why no self-signup.** A user and their membership are written by the same
command, so "signed in but belongs to no garage" cannot arise. That state is not
theoretical: before 2c such a user lands in the backfill tenant and reads real
data, and after 2c they read nothing while the UI insists all is well. The apps
have a screen for it anyway (`AuthGate`), because a state that should be
impossible is exactly the one worth being loud about.

> **Public signup is off on staging and production** (disabled 2026-07-23), and
> `enable_signup = false` in `config.toml` covers the local stack. Keep it that
> way: the anon key ships inside the APK and the web bundle, so an open signup
> endpoint lets anyone who extracts it create an account.
>
> It is a **per-project dashboard setting** — Authentication → Sign In /
> Providers → *Allow new users to sign up*. `config.toml` governs only the local
> stack, and `supabase config push` is not a safe way to change it: it pushes
> the whole `[auth]` block, including `site_url`, which would point a hosted
> project at localhost.
>
> Verify rather than assume, on each project:
> ```bash
> curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" \
>   -H "apikey: <anon>" -H "Content-Type: application/json" \
>   -d '{"email":"probe@gmail.com","password":"StrongEnough123!"}'
> ```
> `signup_disabled` is correct. A `weak_password` or `email_address_invalid`
> reply means signup is **open** — the endpoint got far enough to validate the
> payload. Do not probe with a weak password and read the rejection as safety.

### The login gate became a security boundary in 2c

Through 2b it was not one: `demo_all` granted the anon key — which ships inside
both apps — full read and write on every tenant table, so signing in changed
what the app showed and nothing about what the database would hand out.

2c replaced those policies. A caller now sees exactly one garage's rows and
writes into exactly one garage, proven by `supabase/tests/tenancy.mjs` on every
CI run.

### Grants are the other half, and they are never inherited

Said once in §4 and repeated here because it cost four separate fixes in one
phase. A policy decides which rows; a **grant** decides whether the role may
address the table at all, and RLS is never consulted without one.

Every time, the symptom was the same: the same migration produced different
behaviour on a hosted project and on a database built from these migrations,
because the two were provisioned under different default ACLs, and nothing
reports the difference until something reads the table.

| what | how it surfaced |
|---|---|
| `anon` on the seven original tables | clean local DB rejected every query |
| `service_role` on the same | onboarding worked on staging, failed on a fresh DB |
| `anon` on the membership map | staging answered `200 []`, local `401` |
| `anon` on the catalog tables | same again, in a migration whose comment claimed otherwise |
| `service_role` on `current_garage_id()` | only after the flip made it a column default |

**Omitting a grant is not revoking one.** Write both the grant and the revoke,
explicitly, in the migration.

### Photos are private

The `ticket-photos` bucket is private as of 2c and every read is a signed URL,
valid 8 hours. Paths are `<garage_id>/<ticket key>/<file>`.

Photos uploaded before 2c have no garage prefix, and a stored object cannot be
renamed from SQL — moving one is a storage API call. The storage policies
therefore authorise on *either* the path prefix or a `ticket_photos` row in the
caller's garage. Do not simplify that to the prefix alone without migrating the
objects first: staging and production both hold pre-2c photos, and they would
become unreadable to their owner while every new upload kept working.

---

## 6. Shipping

### Web — automatic

Netlify builds `main` on every merge. PRs get a deploy preview. Nothing to run.

**Environment variables are baked in at build time.** Changing one in the Netlify
dashboard does nothing until the next deploy.

### Mobile — the store *listing* is production, everything else is staging

**The rule: an artefact that can reach the production App Store or Play listing
is built against production. Nothing else is.** Simulators, emulators, `expo
start` and every staging build read staging.

Note what the rule is keyed on. It is not "TestFlight means production" — there
are now two TestFlight apps, and the staging one is a separate App Store Connect
record. What separates them is identity, not distribution channel: `APP_VARIANT`
in `app.config.js` gives staging builds their own bundle id, package name, app
name and URL scheme, so they cannot land in the production listing at all.

| profile | EAS environment → database | variant | produces | for |
|---|---|---|---|---|
| `development` | development → **staging** | staging | dev client | working on native modules |
| `simulator` | preview → **staging** | staging | simulator `.app` / emulator `.apk` | quick checks, no device |
| `staging` | preview → **staging** | staging | staging TestFlight `.ipa` / `.apk` link | testers, including the garage's staff |
| `staging-play` | preview → **staging** | staging | `.aab` for the staging Play listing | a tester who should not see a system warning |
| `production` | production → **production** | production | TestFlight `.ipa` / Play `.aab` | releases |

```bash
cd mobile
npm run run:sim:ios            # staging, straight into the simulator
npm run testflight:staging     # staging -> the staging TestFlight app
npm run build:staging:android  # staging .apk -> send the link
npm run build:staging:play     # staging .aab -> the staging Play listing
npm run testflight             # production -> TestFlight
npm run build:prod:android     # production .aab -> upload in Play Console
```

Four store records, two per platform:

| | iOS | Android |
|---|---|---|
| production | the real app, `ascAppId 6790709441` | `com.tsityat.garageapp` |
| staging | `garage-mobile-staging`, `ascAppId 6797201110` | `com.tsityat.garageapp.staging` |

#### Why staging iOS is not ad-hoc

It was, briefly, and it failed on the first phone it met. Ad-hoc distribution
embeds the allowed device IDs in the provisioning profile, so a phone that was
not registered *before* the build cannot install the result — it gets
`לא ניתן לוודא את שלמותו` and stops there. Registering requires the device in
hand, which rules out the garage's staff.

The `staging` profile therefore distributes differently per platform:

```json
"staging": {
  "ios":     { "distribution": "store" },
  "android": { "distribution": "internal", "buildType": "apk" }
}
```

Android needs no equivalent, because nothing there refuses to install an app the
platform did not sign. The `.apk` link works on any phone; the only cost is the
unknown-sources warning the tester has to accept. `staging-play` exists for when
even that is too much — same database, same package, packaged for Play instead.

`npm run device` still exists for the rare ad-hoc case, but nothing in the normal
flow needs it any more.

#### `staging-play`, and why the old one was dangerous

A profile by this name existed before and was deleted. It built a store-packaged
`.aab` against staging under the **production** package name, so that Google's
new-developer closed-testing period could run without writing into real garage
data. Sharing the package is what made it usable for that — and also meant one
accidental promote in Play Console would have pointed every real garage at
staging. Nothing prevented that promote; the two builds were distinguishable only
by a version code you had to remember.

The profile is back under the same name and is safe for exactly one reason: it
now builds `com.tsityat.garageapp.staging`. Play treats that as a different app,
with its own listing, and **will not accept it into the production listing at
all**. The safety is structural rather than procedural.

What that costs: a closed test on the staging listing does *not* count toward
Play's production-access requirement, which is tied to the app being published.
For the account holding the real listing — a **personal** account, so the
requirement applies — that test has to run on the production listing with
production builds. Give those testers their own garage: RLS already scopes every
row by `garage_id`, so a test garage in production is isolated from the real ones
exactly as well as they are isolated from each other.

That test garage is needed regardless. Both stores' reviewers hit the login
screen, and `scripts/onboard-garage.mjs` is the only way an account can exist —
there is no self-signup — so a reviewer with no credentials cannot get past it.
One test garage covers the closed test, Google's reviewer and Apple's.

#### Telling them apart at a glance

A staging build installs **alongside** the production app rather than over it —
different bundle id — and shows as `מוסך (Staging)`. Inside the app, a strip
along the bottom names the Supabase project the client actually reached
(`mobile/components/EnvBadge.tsx`): silent in production, yellow for staging,
and **red** when the build's variant and its database disagree.

That last case is the one the naming cannot catch. The variant comes from
`eas.json`; the database comes from EAS environment variables edited in a
dashboard. Nothing links them, so an env var pointed at the wrong project makes
a "production" build that talks to staging — and the badge is what says so.
`eas env:list --environment production` is the check before a release.

### Shipping a release

```bash
cd mobile
npm run testflight           # iOS: build + submit
npm run build:prod:android   # Android: .aab, then upload it in Play Console
```

Both go through `scripts/release.sh`, which builds on EAS, auto-increments the
version, and for iOS submits to TestFlight. Apple then processes it for 5–15
minutes.

- **EAS builds from git.** Uncommitted work is not in the build. The script
  checks `mobile/` *and* `packages/shared/` and refuses to continue quietly.
  This applies to Android too — which is why the script takes a platform rather
  than being the iOS-only `testflight.sh` it started as.
- The script prints the branch, the commit, and that the target is the
  production database before building. Read it — builds are often made from a
  feature branch, and "which code is in this build" should not be a guess.
- **Play submit is not automated.** `submit.production` in `eas.json` has only
  `ios.ascAppId`; Android needs a Google Play service account key first. Until
  then the `.aab` is uploaded by hand, and the script refuses `--submit` for
  Android rather than pretending.
- **A build succeeding is not the app working.** After a TestFlight build,
  install it and check: app opens, ticket list loads, a ticket opens with correct
  totals, a photo uploads.
- Apple charges nothing per build; EAS build minutes are the cost. For iteration,
  `--local` builds on your Mac for free.

---

## 7. The road to the first customer

Ordered. Each phase gates the next.

| phase | what | state |
|---|---|---|
| **0** | Migrations, CI, error tracking, backups | ✅ done |
| **1** | One shared package instead of two drifting copies | ✅ done |
| **2a** | `garage_id` on every row — non-breaking | ✅ done |
| **A** | **Android prebuild** — before auth, see below | ✅ built; RTL device testing outstanding |
| **2b** | Auth: login on web, iOS **and Android** | ✅ merged and live |
| **2c** | Tenant policies replace `demo_all`; per-garage catalog; private photos | ✅ gate passing in CI |
| **3** | Ticket-key races, transactional saves, customer identity, realtime | ✅ done |
| **4a** | Real invoices: immutable, numbered, provider-issued | 🔒 gate |
| **5** | Onboarding, alerting, runbook, privacy review | |
| **6** | **Pilot: one garage** | |
| **4b** | In-app card payment | after pilot |
| | Roll out the remaining nine | |

### The two hard gates

**2c** — no garage may read another's data, proven by a test that runs in CI
forever. Not a manual click-through.

**4a** — an accountant signs off on real documents issued in staging. Taking
money without a compliant invoice is a tax exposure, not a bug.

### Android — in the pilot, so it comes before auth

The pilot ships on **both** iOS and Android. That moves Android earlier than it
would otherwise sit, for one reason:

> **Auth is the most platform-divergent thing in the app.** Supabase login
> involves redirect URLs — magic links, OAuth callbacks, deep links back into
> the app. iOS uses URL schemes and associated domains; Android uses intent
> filters. Building auth iOS-only means wiring the whole redirect path a second
> time later and debugging it twice. Everything else in the plan — RLS,
> invoicing, migrations — is genuinely platform-agnostic. Auth is not.

So: `expo prebuild --platform android` **before** 2b, and 2b covers both.

The code is close to ready. There is exactly one `Platform.OS` branch in the
app (`KeyboardAvoidingView`), and it already handles Android. RTL is applied
per-style via `textAlign` / `writingDirection` rather than
`I18nManager.forceRTL`, which is the portable choice — `forceRTL` behaves
differently across platforms and needs an app restart.

What it still costs:

- `npx expo prebuild --platform android`
- **Google Play developer account — start this now, it has lead time.** $25
  once, plus identity verification, plus Google's requirements for new
  developer accounts before production release. Those have included a closed
  test with a minimum number of testers over a fixed period, and differ between
  personal and organisation accounts. **Verify the current rules in the Play
  Console rather than assuming a formality** — if a multi-week requirement
  applies, that is a schedule constraint worth discovering now. An organisation
  account is likely correct for a business, and account type is painful to
  change later.
- Real-device testing. Hebrew font rendering and RTL layout genuinely differ
  between platforms even with the style-based approach. Budget hours, not a
  smoke test. An emulator is not enough.

Every mobile change now needs checking on both platforms.

### Launch tasks not in any phase

- [x] **Create the real production project in `eu-central-1`** and migrate.
      Done 2026-07-22: `garage-production` (`fdztfosbohiwskzfvwaj`), Frankfurt.
      The Seoul demo project has been deleted.
- [ ] Per-garage invoicing and merchant accounts — ten separate legal businesses,
      each with their own credentials and accountant sign-off. **This coordination,
      not the code, is the realistic schedule driver.** Start early.
- [ ] Decide what happens to ticket photos, which backups do not cover (§3.11).

### Pilot with one garage, not ten

Every schema assumption gets tested at a tenth of the blast radius. Fixing
something for one customer is a conversation; fixing it for ten is an incident.
The pilot is what turns this from a rewrite into a rollout.
