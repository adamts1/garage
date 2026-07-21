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

Two things to settle, and the second is not a code decision:

1. Either wire the mapping or remove the inputs. Asking for data and dropping it
   is worse than not asking.
2. **Decide whether ת״ז should be collected at all.** A national ID number is
   sensitive personal data and raises the bar on the §6 privacy review
   considerably. A garage needs a name, a phone and a plate; it does not
   obviously need an ID number. This was deliberately *not* wired up as part of
   Phase 1 — silently switching on collection of national ID numbers is not a
   mechanical refactor.

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
- [ ] npm workspaces, `packages/shared`
- [ ] Reconcile both `db.ts` files and the duplicate `Ticket` type into one
- [ ] Both apps building green; iOS build verified

> Metro needs configuration to resolve hoisted/symlinked workspace deps. It is
> officially supported but not zero effort, and the iOS build is where a mistake
> surfaces. This is the main risk in Phase 1.

### Phase 2 — Tenancy + auth 🔒
- [ ] `garages` + `garage_members`
- [ ] `garage_id` on every table, backfilled
- [ ] Replace every `demo_all` policy with tenant isolation
- [ ] Supabase Auth + login on web and mobile
- [ ] Photo bucket → private, signed URLs, garage-prefixed paths
- [ ] **Gate:** an automated test proving garage A cannot read garage B, running in CI permanently

### Phase 3 — Data integrity
- [ ] Ticket keys → per-garage sequence, `unique (garage_id, key)`  (§3.4)
- [ ] `saveWorks` → one transactional RPC  (§3.5)
- [ ] Customer matching → stable identity, not name  (§3.6)
- [ ] Realtime → garage-scoped subscriptions, fix the dropped-update race  (§3.7)

### Phase 4a — Invoicing 🔒
- [ ] Edge Functions: provider credentials server-side, webhook endpoints
- [ ] Immutable `invoices` table, frozen line items, stored VAT rate
- [ ] Provider integration; per-garage credentials encrypted at rest
- [ ] Credit notes; soft-delete for invoiced tickets
- [ ] `PaymentResult` seam, `TerminalPayment` implementation
- [ ] **Gate:** accountant signs off on real issued documents in staging

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
