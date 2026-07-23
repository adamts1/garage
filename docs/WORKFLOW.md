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
export SUPABASE_URL=https://poksqsdklnhaumozriqd.supabase.co     # staging
export SUPABASE_SERVICE_ROLE_KEY="$(npx supabase projects api-keys \
  --project-ref poksqsdklnhaumozriqd -o json | jq -r '.[]|select(.name=="service_role").api_key')"

node scripts/onboard-garage.mjs --garage "מוסך הרצל" --email avi@example.com
```

It prints a generated password once and stores it nowhere. Pass `--garage-id` to
add someone to a garage that already exists.

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

### The login gate is not a security boundary

Until 2c replaces the `demo_all` policies, the anon key still reads and writes
every tenant table. Signing in changes what the app shows, not what the database
permits. Treat 2b as product behaviour; 2c is the boundary.

---

## 6. Shipping

### Web — automatic

Netlify builds `main` on every merge. PRs get a deploy preview. Nothing to run.

**Environment variables are baked in at build time.** Changing one in the Netlify
dashboard does nothing until the next deploy.

### Mobile — two tracks

**TestFlight is for production builds only.** Never point it at staging: one app
has one bundle ID and one baked-in database, so repointing TestFlight would mean
your testers are suddenly writing to whichever database was current at build
time — and you cannot tell by looking at the app which one that is.

To test a build against staging, use the `staging` profile instead. It installs
directly on registered devices, skipping TestFlight and Apple's processing wait
entirely.

| profile | database | how it installs | for |
|---|---|---|---|
| `staging` | **staging** | direct link / QR to registered devices | trying a change on a real phone |
| `preview` | **staging** | iOS Simulator on your Mac | quick checks, no device needed |
| `production` | **production** | TestFlight | releases |

```bash
cd mobile
npm run device          # once per phone — registers it for direct install
npm run build:staging   # build against staging, install via the link EAS prints
npm run testflight      # production build -> TestFlight
```

`staging` and `preview` both read EAS's **preview** environment, so that is the
one that must hold staging's URL and anon key. `production` reads the
**production** environment.

Registering a device is a one-off: iOS ad-hoc distribution embeds the allowed
device IDs in the provisioning profile, so a phone that was not registered when
the build was made cannot install it.

### Shipping to TestFlight

```bash
cd mobile
npm run testflight
```

Builds on EAS, auto-increments the version, submits to TestFlight. Apple then
processes it for 5–15 minutes.

- **EAS builds from git.** Uncommitted work is not in the build. The script
  checks `mobile/` *and* `packages/shared/` and refuses to continue quietly.
- The script prints the branch and commit before building. Read it — builds are
  often made from a feature branch, and "which code is in this build" should not
  be a guess.
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
| **A** | **Android prebuild** — before auth, see below | ✅ built; device testing outstanding |
| **2b** | Auth: login on web, iOS **and Android** | code done; not yet run on a device |
| **2c** | Tenant policies replace `demo_all`; private photo bucket | 🔒 gate |
| **3** | Ticket-key races, transactional saves, customer identity, realtime | |
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
