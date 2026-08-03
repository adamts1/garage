# Production Readiness — 10 Garages

Status: **planning → Phase 0**
Last updated: 2026-07-20

This document is the plan for taking the garage system from a single-tenant demo
to a production service running 10 independent garages. It records what we found
in the audit, the decisions taken and *why*, and the ordered work remaining.

Read the Decisions section before changing architecture — several choices here
look arbitrary until you know what they are protecting against.

---

## 1. Decisions

| Area | Decision | Why |
|---|---|---|
| Tenancy | Shared Postgres, `garage_id` on every table, RLS isolation | 10 separate Supabase projects means 10× cost and a 10-way deploy for every schema change. Shared-DB + RLS scales to hundreds. |
| Roles | Everyone at a garage sees everything | Small garages; owner and mechanics already share a workspace. One policy shape per table. Revisit if a garage asks for it. |
| Parts catalog | Per-garage, fully separate | Each garage prices and stocks differently. `items` simply gets `garage_id`. |
| Invoices | Real tax documents, stored immutably | They are issued to customers as legal documents. See §3.1 — the current derived-view model cannot support this. |
| Invoicing provider | Third party, **garage brings their own account** | Compliance burden sits with a certified provider, not with us. Bring-your-own keeps us out of the liability path — we transmit under the garage's credentials, we do not issue as an intermediary. Most garages already use one of these tools with their accountant. |
| Payments | Third party, in-app at the counter, **after the pilot** | The terminal already works. Payment integration is convenience, not capability. See §5.4b. |
| Merchant account | Each garage holds their own; funds settle directly to them | Aggregating 10 garages' revenue and disbursing it makes us a payment facilitator — a regulated, licensed activity. Never let money flow through us. |
| Card data | Hosted fields / redirect only | Building our own card form puts us in serious PCI DSS scope. Non-negotiable. |
| Repo | Single repo, npm workspaces, shared package | Web and mobile already duplicate the data layer and have drifted. Splitting would make that permanent. See §3.8. |
| Backend | Supabase Edge Functions added in Phase 4 | Provider API credentials cannot ship in a client bundle, and webhooks need an HTTPS endpoint. |
| DB region | `eu-central-1` (Frankfurt) for staging and production | The demo project sits in `ap-northeast-2` (Seoul): ~250–300ms from Israel versus ~60–80ms to Frankfurt, which is the difference between a board that feels instant and one that lags with several mechanics on it. Frankfurt also keeps customer PII in the EU, matching the Sentry project. **Supabase regions cannot be changed after creation** — moving costs nothing now and is a migration with downtime once garages are live. |
| Launch | Pilot with **one** garage, then roll out | Every schema assumption gets tested at 1/10th the blast radius. Fixing something for one customer is a conversation; for ten it is an incident. |

### Vendor selection criterion

Prefer a vendor that does **both invoicing and clearing**. Then payment and
invoice issuance are one atomic operation. Split across two vendors, we own the
reconciliation problem — including the case where the charge succeeds but
invoice issuance fails, leaving money with no legal document behind it.

---

## 2. What is already sound

Not everything needs changing. Worth knowing so we don't churn it:

- Secrets are correctly gitignored; only `.example` templates are tracked.
- The data layer is already isolated behind `db.ts` — the UI never touches
  Supabase directly, so tenancy changes stay contained.
- `CloseTicketDrawer` already models real payment methods (cash / card /
  bit / transfer / check / open balance) with references. This is **correct
  production behaviour for the pilot**, not a stub — see §5.4a.
- Realtime, optimistic updates, and the mobile photo flow all work and are
  well-commented.

---

## 3. Audit findings

Ordered by severity. Each maps to a phase in §5.

### 3.1 Invoices are derived views, not documents — *blocker*
`InvoicesPage.invoiceFrom()` recomputes an invoice from the ticket's **current**
works on every render. Nothing is stored. For real tax invoices this fails on
every axis:

- Editing a ticket after billing silently changes an issued tax document.
- `number: 10000 + ticketKeyNumber` — derived, not allocated. Non-sequential,
  gappy, and two garages billing their ticket 142 both produce invoice 10142.
- Issue date = ticket creation date, not billing date. Wrong VAT period.
- Deleting a ticket deletes the invoice. Tax invoices are cancelled by credit
  note, never deleted.
- VAT is a module constant in `catalog.ts`. The rate changed to 18%; reprinting
  an older invoice would apply today's rate to it.

### 3.2 No authentication or tenancy — *blocker*
Every table carries `create policy demo_all ... using (true) with check (true)`,
and the anon key ships in the client bundle. Today anyone who opens devtools can
read and write every ticket, customer, phone number and address. There is no
column anywhere distinguishing one garage from another.

### 3.3 Photo bucket is public — *blocker*
`ticket-photos` is a public bucket read via `getPublicUrl()`. Any leaked URL
exposes a customer's vehicle indefinitely, with no expiry and no audit.

### 3.4 Ticket key generation races
`App.tsx:132` generates keys as `GAR-${maxKey + 1}` client-side. Two service
advisors creating tickets simultaneously collide.

### 3.5 `saveWorks` is not transactional
`db.ts` deletes all of a ticket's works and re-inserts them, outside a
transaction. A failure mid-way loses the job lines; two people editing one
ticket clobber each other.

### 3.6 Customers are matched by name
`findOrCreateCustomer` does `.eq('name', t.customer).maybeSingle()`. Two
customers with the same name merge into one — and `.maybeSingle()` *throws* on
multiple matches, so the second one breaks ticket creation outright.

### 3.7 Realtime discards concurrent updates
`useTickets.ts:41` ignores incoming changes while our own write is in flight —
not queued, discarded. With several people on one board, screens silently
diverge until the next refetch.

### 3.8 Web and mobile duplicate the data layer
`db.ts` exists in both, 649 lines total with **241 differing**. Nine exported
symbols are defined twice (`listTickets`, `updateTicket`, `deleteTicket`,
`subscribeToTickets`, `listTicketPhotos`, `Item`, `TicketPhoto`, …), and
`Ticket` / `Status` / `Priority` / `COLUMNS` / `EPICS` are declared
independently in `src/board-data.ts` and `mobile/lib/types.ts`.

They have already drifted. Two definitions of the shape that crosses the network
to the same tables — and every remaining phase touches this layer.

### 3.10 The ticket form silently discards what it collects
`App.tsx` renders inputs for **ת״ז** (`form.idNumber`) and a vehicle code
(`form.vehicleCode`). The user fills them in, and they go nowhere: `Ticket` has
no field for either and `ticketToRow` never maps them. All 13 production tickets
have `id_number = NULL` despite the field being on screen.

The columns *do* exist in the database — added straight in the dashboard and
recorded in none of the legacy `.sql` files. That drift was invisible until
seeding a clean database from a production dump failed on `column "id_number"
does not exist`. The baseline now carries both.

**Resolved for ת״ז: wired up, stored on the customer.** It is needed, so it is
now persisted properly rather than collected and dropped.

It lives on `customers.id_number`, not on the ticket. A national ID identifies a
person, not a repair — per-ticket storage would mean re-entering it every visit,
duplicating it across rows, and having no single place to correct it. On the
customer it is entered once and autofills thereafter, and Phase 4a can snapshot
it onto an issued invoice from the customer record. `CustomersPage` can edit it,
which matters because `findOrCreateCustomer` deliberately fills a *missing* ת״ז
but never overwrites an existing one — a correction should be an explicit edit,
not a side effect of opening a ticket with a typo in it.

`Ticket.idNumber` exists only in transit, so the create form can hand it to
`findOrCreateCustomer`. It is not a column on `tickets` and reading a ticket back
never populates it.

`tickets.id_number` is left in place and unused — every value is NULL, dropping a
column is irreversible, and it costs nothing to keep. Remove it deliberately once
tenancy settles, if still unused.

> **This is the first sensitive identifier the system stores, and it was a
> deliberate decision.** It raises the bar on the §6 privacy review: retention,
> access, and deletion now all have a national ID in scope. Whatever review
> happens must cover it explicitly.

**Still open: `vehicleCode`.** Same defect, no privacy weight — still collected
by the form, still discarded. Either map it or drop the input.

### 3.11 Ticket photos are not backed up
Supabase's daily backups cover the database only. The dashboard says so plainly:
*"Database backups do not include objects stored via the Storage API."*

So `ticket_photos` rows are backed up — filenames, captions, which ticket they
belong to — but **the images themselves are not**. Restoring from a backup would
produce a database full of photo records pointing at files that no longer exist.

Tolerable for a demo. For ten garages photographing vehicle damage — the kind of
evidence that surfaces in an insurance dispute or a "it was already scratched"
argument — it should be a decision rather than a surprise. Options run from
"accept it, photos are convenience" to a scheduled job copying the bucket
elsewhere. Not urgent, but it should be chosen rather than inherited.

### 3.9 No migrations, no tests, no CI
Schema changes are hand-pasted `.sql` files. `schema.sql` opens with
`drop table if exists ... cascade` labelled "safe to re-run" — true today,
catastrophic once real data exists. There are no tests and no CI.

---

## 4. Architecture

### Tenancy

```sql
create table public.garages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text not null,                    -- ח.פ / עוסק מורשה
  created_at timestamptz not null default now()
);

create table public.garage_members (
  garage_id uuid not null references public.garages(id) on delete cascade,
  user_id   uuid not null references auth.users(id)    on delete cascade,
  primary key (garage_id, user_id)
);

create function public.current_garage_id() returns uuid
language sql stable security definer set search_path = public as
$$ select garage_id from public.garage_members where user_id = auth.uid() limit 1 $$;
```

`stable` matters — Postgres evaluates it once per query, not once per row.

Every table then carries `garage_id` and one policy:

```sql
create policy tenant_isolation on public.<table> for all
  using      (garage_id = public.current_garage_id())
  with check (garage_id = public.current_garage_id());
```

With `garage_id` defaulting from `current_garage_id()`, client insert code
barely changes and reads filter automatically.

### Invoices

Immutable documents that **snapshot** the ticket at issue time — customer
details, line items and the VAT rate all frozen into the row. The ticket stays
mutable; the invoice never changes.

- Numbers from a per-garage sequence, `unique (garage_id, number)`
- `ticket_id` is `on delete set null`, never cascade
- Tickets with an invoice become soft-delete only
- Cancellation creates a credit-note row referencing the original
- `vat_rate` stored per invoice, never read from a constant

### Payment seam

The invoice does not care how the money arrived:

```
PaymentResult { method, reference, amount, paidAt }
   ├── TerminalPayment  → advisor records what happened   (today, and the pilot)
   └── ProviderPayment  → charges a card, same shape       (post-pilot)
```

Adding clearing later is a new implementation behind an existing seam, not a
restructure.

### Repo layout

```
packages/shared/     types, db layer, VAT + totals, invoice math
apps/web/            vite + react
apps/mobile/         expo
```

The Supabase *client* legitimately differs — mobile needs the AsyncStorage
adapter and `detectSessionInUrl: false`. So `shared` exports functions taking a
client; each app constructs its own. That difference is real and preserved.

---

## 5. Phases

Each phase is a gate. Do not start the next until the current one is green.

### Phase 0 — Safety net
Changes nothing user-facing. Makes every later phase reversible.

- [x] Real migrations; `drop table cascade` retired to `supabase/legacy/`
- [x] CI: typecheck + build both apps, and apply migrations to a clean database
- [ ] `seed.sql` dumped from the live demo project — **blocked on CLI link**, see `supabase/README.md`
- [x] Error tracking on web, with PII scrubbing — verified end to end, EU region
- [ ] Error tracking on mobile — deferred deliberately, see note
- [ ] Separate staging project from production — *needs Supabase account access*
- [ ] Automated backups **plus one tested restore** — an untested backup is not a backup

> Mobile Sentry needs `@sentry/react-native`, a config plugin and a native
> rebuild. Kept out of the Phase 0 commit so a working TestFlight pipeline is
> not disturbed by infrastructure changes. Do it as its own change, with an
> iOS build verified before merge.

> Use **two Sentry projects**, not one: `garage-web` (platform: React) and
> `garage-mobile` (platform: React Native). Releases do not line up — web
> deploys continuously, mobile ships through TestFlight — and source maps
> differ, with React Native needing Hermes bundles and native symbolication.
> Billing is by event volume, so the second project is free.

> `src/lib/sentry.ts` scrubs query-string values before anything leaves the
> browser. PostgREST puts filters in the URL — `.eq('name', 'יוסי לוי')` becomes
> `?name=eq.%D7%99...` — and Sentry records fetch breadcrumbs with full URLs, so
> unscrubbed we would ship every customer lookup to a third party. Console
> breadcrumbs are dropped entirely for the same reason. Keep this in mind when
> enabling any other telemetry.

> Migration validity has not yet been proven against a real database — Docker
> was unavailable locally. The `migrations` CI job does exactly this on first
> push. Treat the baseline as unverified until that job is green.

### Phase 1 — Consolidation
- [x] `packages/shared` with npm workspaces
- [x] Both `db.ts` files, both `Ticket` types and both copies of the money math reconciled into one
- [x] Web green: typecheck, 14 tests, build
- [x] Mobile green: typecheck, and a real Metro bundle (1170 modules) with shared code verified inside it
- [ ] **A TestFlight build confirmed by a human** — the JS bundle is proven, the native build is not
- [ ] `useTickets` still duplicated — deferred, see note

> **Mobile is deliberately not an npm workspace.** Hoisting its dependencies to
> the repo root would change the paths `ios/Podfile` resolves against, risking a
> working TestFlight pipeline for cosmetic tidiness. It links `@garage/shared`
> as a `file:` dependency instead, so `mobile/node_modules` stays put and the
> native project is untouched by the monorepo layout. `mobile/metro.config.js`
> carries the resolver config this requires.

> **Install order matters.** Run `npm ci` at the repo root *before*
> `npm ci` in `mobile/`. Mobile links `@garage/shared` as a `file:` dependency
> and TypeScript follows into its source, so resolving the shared package's own
> imports walks up from `packages/shared/` to the root `node_modules`. Install
> mobile alone and it typechecks against a shared package whose types cannot
> resolve, turning every inferred database row into `any`. CI enforces this
> order; a fresh clone has to follow it too.

> `src/lib/useTickets.ts` and `mobile/lib/useTickets.ts` are still separate.
> They are React state management rather than data or money, they genuinely
> differ, and Phase 1 was already large. Worth revisiting, but not urgent.

> Merging the two `subscribeToTickets` fixed a latent mobile bug. Mobile used a
> fixed channel name (`garage-tickets-mobile`) where web uses a counter. Supabase
> reuses a channel by topic and throws when `.on()` is called on an already
> subscribed one, so mobile would have crashed the moment a second component
> subscribed. It worked only because exactly one did.

> **For Phase 4a:** `worksSummary` computes `vat = Math.round(net * VAT)` —
> whole shekels. Real tax invoices generally need agorot precision, and a VAT
> line rounded this way may not reconcile against net and total. Confirm the
> required rounding with the accountant before invoices become legal documents.

### Phase 2 — Tenancy + auth 🔒

> **Enable RLS explicitly in every migration. Never rely on the platform.**
> This was found when production was the Seoul demo project (created
> 2026-07-14), which predated Supabase's `rls_auto_enable()` event trigger while
> staging (created 2026-07-21) had it. A migration creating `garages` without an
> explicit `alter table ... enable row level security` would have been protected
> on staging and **silently unprotected on production** — the rehearsal passes,
> the real thing ships an open table. Found by diffing a freshly built staging
> schema against production.
>
> The specific hazard is gone: production was rebuilt in Frankfurt on 2026-07-22
> and now postdates staging, so both carry the trigger. The rule stays, because
> the lesson was never about that one trigger. Platform defaults differ by
> project age, by region and by how a project was provisioned, and the
> difference is invisible until something reads the table.
>
> **The same reasoning applies to GRANTs, and there it bit us.** A policy says
> which rows a role may see; a grant says whether it may touch the table at all,
> and RLS is never consulted without one. Tables created by a migration are
> owned by `postgres`, whose default ACL in the local stack is `anon=Dxtm` — no
> SELECT. Hosted projects were provisioned under `supabase_admin`'s default ACL,
> which grants it. So the apps worked against staging and production while a
> database built from the same migrations rejected every query with
> `permission denied for table tickets`. Declared explicitly in
> `20260722020000_declare_existing_grants.sql`.

Split into three so nothing breaks mid-flight. The moment tenant policies replace
`demo_all`, the anon key can read nothing — do that before auth exists in the
apps and both go dark. So schema first, then auth, then the flip.

**2a — schema (non-breaking)**
- [x] `garages` + `garage_members`, RLS enabled explicitly
- [x] `current_garage_id()` — `stable` so it evaluates once per query, `security definer` to read past RLS, empty `search_path` so it cannot be shadowed
- [x] `garage_id` on all seven tables, backfilled into one garage, `NOT NULL`, indexed
- [x] Inheritance triggers so a child's `garage_id` always comes from its parent
- [x] `demo_all` untouched — both apps keep working

**2b — auth**
- [ ] Supabase Auth + login on web and mobile
- [ ] Members joined to a garage on sign-up

**2c — the flip 🔒**
- [ ] Replace every `demo_all` policy with tenant isolation
- [ ] Swap the temporary `garage_id` default for `current_garage_id()`
- [ ] Photo bucket → private, signed URLs, garage-prefixed paths
- [ ] **Gate:** an automated test proving garage A cannot read garage B, running in CI permanently

> The `garage_id` DEFAULT that 2a leaves behind is scaffolding. Until callers are
> authenticated the apps insert rows knowing nothing about garages, and a
> `NOT NULL` column with no default would break every insert. 2c replaces it.
> Leaving it in place after auth would mean a caller with no garage silently
> writes into the backfill tenant instead of being rejected.

> **Child rows carry `garage_id` denormalised** so policies stay a column
> comparison rather than a join back to `tickets`. The risk of denormalising is
> divergence — a work row claiming a different garage from its ticket would be
> invisible to its owner, or visible to someone else. Triggers make that
> unrepresentable: the child's value is always read from the parent, never from
> the caller. Verified by attempting the forgery on `works`, `work_items` and
> `vehicles`; all three were corrected to the parent's garage.

### Phase 3 — Data integrity ✅
- [x] Ticket keys → per-garage counter + `unique (garage_id, key)`, assigned
      inside `create_ticket` under a row lock  (§3.4)
- [x] `saveWorks` → transactional `create_ticket` / `save_ticket_works` RPCs  (§3.5)
- [x] Customer matching → by ת״ז then phone, never name; partial unique index on
      `(garage_id, id_number)`  (§3.6)
- [x] The phone is matched on its **digits**, so one number typed with hyphens,
      spaces or neither is one customer. A ticket with a name but neither
      identifier creates **no** customer record at all — it used to create a
      fresh unmatchable one on every visit, which is the same duplication §3.6
      set out to kill. Both intake forms now require name + phone + מספר רישוי;
      the server rule is the floor under a caller that skips them.
      `20260802000000_customer_identity.sql`
- [x] A customer **picked** from the intake form's search box is honoured by id,
      ahead of any derivation. The search box knows which record the human
      meant, and ת״ז-then-phone cannot recover that for a customer saved with
      neither — picking one and filling in a phone used to open a second copy of
      the person just selected. The id is garage-checked, not trusted:
      `create_ticket` is `SECURITY DEFINER`, so RLS does not filter that lookup,
      and an id from another garage is ignored rather than honoured. Dropped by
      the form the moment name / phone / ת״ז is typed over.
      `20260802010000_pick_customer.sql`
- [x] **The phone is the customer identifier**, everywhere. ת״ז rides with it
      and is optional. Two holes closed, both found by probing the RPC rather
      than reading it: a ת״ז skipped the phone check entirely (`if id_number …
      elsif phone …`), so an unknown ת״ז inserted a **second customer holding a
      number the first already had** — after which `limit 1` picks between them
      arbitrarily and the phone identifies nobody; and filling in a ת״ז already
      held by another customer raised on the partial unique index and **rolled
      back the whole ticket**, works and parts included. Order is now picked id
      → phone digits → ת״ז, and the fill skips a number somebody else holds.
      `20260802020000_phone_is_the_identity.sql`
- [x] Both intake forms **say so when a number is already on file**, naming the
      customer who holds it, with one button to open the ticket on that record.
      Reported, not blocked: a number can legitimately be shared (a couple, a
      business line), and only the person at the counter can tell a returning
      customer from a mistyped digit. Before this the ticket was silently
      attached to the existing customer while the card showed the newly typed
      name, and no record was ever created for it — which is how a ticket got
      "created without the customer".
- [x] The **customer report groups by identity, not by the name string**
      (`ticketCustomerKey`). It disagreed with the database in both directions:
      one person whose name was typed two ways became two rows and looked like
      two customers, and two people sharing a name became one row whose total
      belonged to nobody. The row's sub-line is now the number it grouped by,
      replacing a sequential `1001+i` that identified nothing and changed
      whenever a filter did; report search matches a number as well as a name.
- [x] The rule itself lives in one place — `packages/shared/src/identity.ts` —
      because it has to be the same in four: the RPC, both intake forms and the
      report. The SQL in `create_ticket` is its mirror; keep them in step.
- [x] `scripts/duplicate-customers.mjs` reports the records the old rule already
      wrote — grouped by phone digits, and by name where there is no phone and
      no ת״ז — and merges only ids named explicitly on the command line. There
      is deliberately no merge-all: two people who share a name and a garage are
      not a duplicate, and only the garage can tell.
- [x] Realtime → a change arriving mid-write is deferred and re-pulled once the
      write settles, not discarded  (§3.7)

> Proven on every CI run by `supabase/tests/tenancy.mjs` (85 checks): ten
> concurrent creates get ten unique keys, a failed create leaves no orphan, a
> forged garage_id is ignored, and two people with one name stay two customers.
>
> Still open from the original §3.7 wording: **garage-scoped** realtime
> *channels*. Subscriptions are correct because RLS filters every payload to the
> caller's garage, but each client still receives (and discards) other garages'
> events. That is efficiency, not correctness, and is deferred — noted here so it
> is not mistaken for done.

### Board and intake — the workflow the garage actually runs ✅
- [x] **Four columns**: כניסה / ממתין לאישור / מוכן / שולם. It was six on screen
      and **eight in the database** — `diag` and `qa` were allowed by the check
      constraint and rendered by nothing, so a ticket that reached one dropped
      off the board with no column to sit in. "בעבודה" and "חסום - חלקים" both
      meant *in the shop, not ready*, which is what כניסה says. Existing tickets
      are **mapped, not deleted** (`diag`/`prog`/`parts`/`qa` → `todo`); the
      status ids are unchanged, so nothing downstream had to be rewritten.
      `20260802030000_four_statuses.sql`
- [x] A blocker is now a **note, not a column**. `blocked` still shows on the
      card and in print; dragging no longer erases it, which it used to do on
      the way out of "חסום - חלקים".
- [x] The board columns are asserted from both sides: `COLUMNS` against the four
      in `board.test.ts`, and the check constraint against the same four in
      `tenancy.mjs`. Neither half can drift without a red test.
- [x] **Car make and model are pick-or-type** on the intake form: `VEHICLE_MAKES`
      offers the makes, `modelsFor()` narrows the models to whichever make was
      entered. Both fields stay **free text** — a grey import or a thirty-year-old
      model is typed straight in and saves like any other. Web uses `<datalist>`;
      the phone gets a chip row, since React Native has no native combobox.
      The list is a plain data file (`packages/shared/src/vehicleCatalog.ts`) —
      adding a make is a one-line edit, no migration.
- [x] **A customer's cars are visible from the customers page** — a count per row
      that opens a panel with plate, make and model, year, km and code. The cars
      come from `vehicles`, which `create_ticket` fills as tickets are opened, so
      the list is a by-product of normal work rather than something to maintain.
      `Table` grew an optional `renderExpanded` for this and stays reusable.

### Works catalog, per-work notes, and the first roles ✅
- [x] **קטלוג עבודות** at `/works` — create, rename, reprice and delete the works
      a ticket copies from. The data layer already existed (`listWorkDefs` and
      friends in `packages/shared/src/db.ts`); only the screen was missing, so
      the catalog could previously be changed only through the database. The
      page says on screen what the two tables mean: repricing here moves the
      *next* ticket, never one already written.
- [x] `work_defs` joined the realtime publication. Without it
      `subscribeToTable('work_defs')` attaches to a channel that can never fire —
      the subscription reads as live in the code while the screen goes stale.
      **`garage_workers` has the same gap and still has it** — the Workers page's
      subscription is a silent no-op. Noted, not fixed here.
- [x] **Per-work notes on a ticket** (`works.notes`) — what was actually done,
      against the work it was done on. Any member may write one: it records
      labour, it does not price it. Belongs to the ticket's copy of the work,
      exactly like `name` and `labor`, and never reaches the `work_defs` entry.
- [x] **Roles: `admin` and `member`** on `garage_members`, set only by
      `scripts/onboard-garage.mjs --admin`. One distinction: only an admin may
      change the **name or price of a work already on a ticket**. There is no
      in-app editor on purpose — a garage's only admin cannot demote themselves
      out of their own price list. Everyone who existed at migration time became
      an admin; silently demoting whoever onboarded the garage would have locked
      them out.
- [x] The check lives **inside `save_ticket_works`, not in a policy**. The
      function replaces a ticket's works wholesale — delete every row, re-insert
      from the payload — so at the row level an edit and an addition are the same
      INSERT, and a policy that refused the first would refuse the second. It
      compares against a snapshot taken before the delete, which is the only
      place both values are in scope. `20260803000000_works_notes_and_roles.sql`
- [x] The UI gate is a convenience, not the boundary: `isGarageAdmin()` decides
      whether to render an editable price, and the database re-checks. An
      unrecognised role resolves to the *lesser* privilege, so a build that has
      not heard of a future role never opens a field the server will refuse.
- [x] Proven in `tenancy.mjs`: a member cannot rename or reprice an existing work
      and the rejected save leaves it untouched; a member can add, remove and
      annotate; an admin can reprice; and a member cannot promote themselves.

> **Known and deliberate:** a member can delete a work and add it back at a
> different price, because adding is allowed. Closing that means locking deletion
> too — considered and not chosen. Recorded rather than quietly patched.

### Phase 4a — Invoicing 🔒 *(build complete; awaiting the accountant gate)*
- [x] Immutable `invoices` table — frozen line items, per-invoice VAT rate, provider-owned numbering, cannot be edited or deleted (trigger). `20260727000000_invoices.sql`
- [x] Per-garage credentials — `garage_billing` (provider + vat_rate + active, readable by the garage) + `garage_billing_secrets` (a provider-agnostic `credentials jsonb`, no client grant at all, service_role only). `20260727010000_garage_billing.sql`
- [x] Edge Function `issue-invoice` — issues חשבונית מס-קבלה and cancels via חשבונית זיכוי; RLS is the authorization boundary; idempotent per ticket. **Provider-agnostic**: dispatches on `garage_billing.provider` via an `ADAPTERS` registry. `supabase/functions/issue-invoice/`
- [x] **Multi-provider seam** — `_shared/provider.ts` defines the `InvoiceProvider` interface (issue/cancel → normalized `IssuedDoc`); `_shared/icount.ts` is the first adapter. A second accounting service (Green Invoice, Rivhit, …) is **one new adapter module + one registry line** — the invoices table, the UI, and the shared data layer do not change.
- [x] iCount adapter (`_shared/icount.ts`) — auth + doc shapes verified against a live account (invrec/refund, doc/info for docnum→doc_id + allocation); credentials read from the jsonb bag as `{cid, token}`.
- [x] Web wiring — explicit "הפק חשבונית מס-קבלה" button (confirm dialog) in the ticket's billing panel; `InvoicesPage` now READS the stored table, no longer recomputes from live tickets (kills §3.1).
- [x] CI — 7 invoice-isolation checks added to `tenancy.mjs` (read scoping, no client insert/update/delete, token invisible).
- [ ] Credit-note UX exists (cancel button); soft-delete for invoiced tickets still to confirm.
- [ ] Mobile issuance (web-first shipped; mobile follows).
- [ ] `PaymentResult` seam, `TerminalPayment` implementation.
- [ ] **Gate:** accountant signs off on real issued documents in staging (needs an עוסק מורשה/חברה account connected to רשות המסים to see the real מספר הקצאה — the trial returns none).

> **iCount specifics (verified 2026-07-27):** auth is a `Bearer` token header **plus**
> `cid` in the POST body. Doctypes: `invrec` = חשבונית מס-קבלה, `refund` = חשבונית זיכוי.
> `doc/create` returns only `docnum` + `doc_url`; `doc/info` gives `doc_id` and the
> allocation number (`invoice_reference_number`, empty until connected to רשות המסים).
> An invrec **requires a payment block that balances the total** (`cash:{sum}` etc.).
> A credit note **links** to the original (`based_on`) but does **not** flip the
> original's `is_cancelled` — the offset is the record; we mirror this by moving our
> row's `status` issued→cancelled with `cancelled_by`.
> **The token is pasted in plaintext during setup → rotate it after go-live.**

### Phase 4c — Supplier expenses ✅ *(built)*
The "money out" counterpart to 4a. Unlike an invoice (a legal document the garage *issues*), a supplier expense is a document the supplier issued and the garage merely *records* — so these are the garage's own bookkeeping entries: full CRUD, no provider-owned number, no immutability.
- [x] `suppliers` + `supplier_expenses` tables — tenant-scoped like every other table (`current_garage_id()` default + `tenant_isolation` policy). `20260728000000_suppliers_and_expenses.sql`
- [x] Native + provider sync: `record-expense` Edge Function pushes each expense to the accounting provider (resolves/creates the supplier by vat_id, resolves/creates the expense type, creates the expense), writes the provider ids back, and is idempotent (won't double-post). Reuses the same `ADAPTERS` seam as 4a.
- [x] iCount expense API (verified): `supplier/add` / `supplier/get_list` (vat_id unique) · `expense_type/add` / `expense/types` · `expense/create` (needs supplier_id + expense_type_id + expense_sum + expense_date + **expense_docnum**). **`expense_sum` is the GROSS (VAT-inclusive) total** — iCount derives VAT from it — so the adapter sends subtotal+vat and pins the exact figure with `expense_manual_vat`. VAT-free expenses (rate 0) are an iCount type-level setting we don't set yet; the native record stays correct.
- [x] Web: Suppliers page + Expenses page (add form with live VAT preview, per-row sync status + retry, paid toggle, **print** a formatted record). iCount issues no printable PDF for an expense (not a document it creates), so the print view is built from our stored data. Nav: הוצאות, ספקים.
- [x] CI: supplier/expense isolation checks added to the tenancy gate.
- [ ] Not in MVP (deferred): paid/unpaid A/P reporting depth, attach the supplier's document scan, link parts expenses to inventory.

### Phase 5 — Operate
- [ ] Garage onboarding + per-garage settings
- [ ] Uptime and error alerting that actually reaches someone
- [ ] Runbook and a support channel — 10 businesses will call when the board is down
- [ ] PII review (§6)

### Phase 6 — Pilot
- [ ] **One** garage live. Not ten.
- [ ] Run until boring
- [ ] Roll out the remaining nine

### Phase 4b — Clearing *(post-pilot)*
- [ ] In-app counter payment via provider hosted fields
- [ ] Webhook-driven payment state — **server-authoritative, never optimistic**
- [ ] Idempotency keys on every charge

> The existing data layer paints first and saves second. That is right for a
> kanban board and wrong for money: a dropped network on retry becomes a double
> charge. Payment state must not follow the optimistic pattern.

---

## 6. Open items — need external input

These cannot be resolved from the codebase. **Do not take figures from the
assistant on any of them** — thresholds and rates change annually.

- [ ] **Current חשבונית ישראל allocation-number threshold.** Steps down on a
      published annual schedule. Confirm with the accountant.
- [ ] **Current VAT rate.** 18% at time of writing; stored per invoice so past
      documents stay correct regardless.
- [ ] **Invoicing + clearing vendor choice.** Weight "does both" heavily.
      Confirm each garage's existing tool during onboarding — several likely
      already have one.
- [ ] **Privacy compliance.** Israel's privacy law was amended recently with
      stronger enforcement. We hold customer names, phones, addresses and
      plates across 10 businesses. Needs a professional review.
- [ ] **Per-garage merchant + invoicing accounts.** Ten separate legal
      businesses, each needing their own credentials and accountant sign-off.
      This coordination — not the code — is the realistic schedule driver.
      Start these conversations in parallel with Phase 0.
