# Supabase setup — 5 minutes

## 1. Create the project
Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
Pick a name, a strong DB password, and the region closest to you (`eu-central-1` for Israel).
Wait ~2 minutes for it to spin up.

## 2. Create the tables
Dashboard → **SQL Editor** → **New query**.
Paste the entire contents of [supabase/schema.sql](supabase/schema.sql) → **Run**.

That creates `customers`, `items`, `tickets`, `works`, `work_items`, turns on realtime,
and seeds the same demo data the app used to hold in memory.

## 3. Point the app at it
Dashboard → **Project Settings** → **API Keys** (and **Data API** for the URL).
Copy `.env.local.example` to `.env.local` and fill in the two values:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

## 4. Run
```bash
npm run dev
```

## 5. See realtime working
Open the app in **two browser windows** side by side.
Drag a ticket to another column in one — it moves in the other within a second.
Same for adding a customer, editing an item's stock, or closing a ticket.

---

## The tables

| Table | What it holds |
|---|---|
| `customers` | Name, phone, email, city, private/business |
| `items` | The parts catalog + stock level, keyed by SKU |
| `tickets` | One work ticket: status, priority, technician, car, customer, totals |
| `works` | The job lines on a ticket (e.g. "front brakes", labor price) |
| `work_items` | The parts each work consumes (qty + price at time of quote) |

`works`/`work_items` is the fifth table your four-table sketch implied: a ticket has many works,
and each work consumes many parts. Deleting a ticket cascades through both.

## Where the code lives

- [src/lib/supabase.ts](src/lib/supabase.ts) — the client
- [src/lib/db.ts](src/lib/db.ts) — every read and write, plus the row ↔ `Ticket` mapping
- [src/lib/useTickets.ts](src/lib/useTickets.ts) — tickets state: paints instantly, saves in the background, listens for others' changes
- [src/CustomersPage.tsx](src/CustomersPage.tsx), [src/ItemsPage.tsx](src/ItemsPage.tsx) — add / edit / delete, live

The board, ticket page, and close-ticket drawer were **not** changed — they still call `setTickets`,
which now diffs old vs. new state and writes only what actually changed.

## ⚠️ Before this touches real customer data

The RLS policies in the schema are `using (true)` — **anyone with the anon key can read and write
every row**. That is fine for a demo, wrong for production. Replace them with auth-based policies,
e.g. `using (auth.uid() is not null)`, once you add login.
