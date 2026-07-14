# מוסך — mobile

An Expo (React Native) app for editing tickets on a phone. It talks to the **same
Supabase project** as the web app in `../src` — same tables, same rows, live in both
directions: change a status here and the web board moves.

## Running it

```bash
cd mobile
npm install          # first time only
npx expo start       # then scan the QR code with Expo Go, or press i / a
```

`.env` already points at the same Supabase project as `../.env.local`. It is
gitignored; `.env.example` is the template. Expo only exposes variables prefixed
`EXPO_PUBLIC_` to the app, so the names differ from the web app's `VITE_` ones.

After editing `.env`, restart with `npx expo start -c` — the old value is cached.

## What it does

- **Ticket list** — search by number, customer, car or plate; filter by status; pull to refresh.
- **Edit screen** — status, priority, assignee, area, type, all the customer/car fields,
  the subtask checklist, notes, and the works + parts table with live totals (incl. VAT).

Saving is optimistic: the screen updates immediately, then the write goes out. If it
fails, the error shows on the list and the state resyncs from the server.

## How it relates to the web app

| | web (`../src`) | mobile (here) |
|---|---|---|
| data layer | `src/lib/db.ts` | `lib/db.ts` — same mapping, same tables |
| types | `src/board-data.ts`, `src/catalog.ts` | `lib/types.ts` — same shapes |
| env vars | `VITE_SUPABASE_*` | `EXPO_PUBLIC_SUPABASE_*` |

`lib/db.ts` and `lib/types.ts` are **deliberate copies**, not imports — Metro can't
reach outside the `mobile/` folder without extra config. The cost is that a schema
change has to be made in both places. If that becomes annoying, promote them to a
shared workspace package.

## Two things worth knowing

**Subtasks are a count, not per-item flags.** `supabase/schema.sql` stores `done` as an
integer, so a ticket is "3 of 5 done", not "items 1, 2 and 5 done". The checklist here
closes tasks *in order* — tapping the third row means the first three are done. That
matches what the web board renders. Per-item ticking would need a schema change.

**There is no login yet.** The anon key ships inside the app binary and the RLS policies
are still `using (true)` — anyone with the key can read and write every table. Fine for
demo data; not fine for real customers. The Supabase client is already set up with
AsyncStorage session persistence, so adding Supabase Auth is a login screen plus new RLS
policies, not a rewrite.
