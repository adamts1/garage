# Legacy SQL — archive, do not run

These are the hand-pasted files used before migrations existed. They are kept
for history only. `migrations/20260730000000_baseline.sql` supersedes all of
them.

**Do not run these against any database.** `schema.sql` and `demo-tickets.sql`
begin by destroying data:

- `schema.sql` — `drop table if exists ... cascade` on all five core tables
- `demo-tickets.sql` — `delete from public.tickets` (works and work_items cascade)

Both are labelled "safe to re-run", which was true against a demo database and
would be catastrophic against production.

## They are also inconsistent with each other

Discovered while building the baseline, and the reason `seed.sql` must come from
a real database dump rather than from these files:

`vehicles.sql` joins its 17 vehicles to customers **by name**. It expects 12
customer names; `schema.sql` seeds 8; only 5 match. Three are near-misses that
look identical at a glance but are different strings:

| vehicles.sql expects | schema.sql seeds |
|---|---|
| `אבי פרידמן` | `א. פרידמן` |
| `חברת דלתא הובלות בע״מ` | `חברת דלתא בע״מ` |
| `נועם בר אל` | `נועם ברק` |

and four more (`אולגה פטרוב`, `דוד אזולאי`, `כרים חדאד`,
`מוסך שלום הסעות בע״מ`) have no counterpart at all.

Because the join is an inner join, roughly 10 of the 17 vehicle rows are
**silently dropped** — no error, no warning. The demo database only looks
complete because the missing customers were later added through the UI.

Two things follow, both already in the plan:

1. These files are not a faithful record of production. `seed.sql` gets dumped
   from the live database instead. See `../README.md`.
2. Joining records by human-entered name is the same class of bug as
   `findOrCreateCustomer` in the app — see `docs/PRODUCTION.md` §3.6. Phase 3
   removes it in both places.
