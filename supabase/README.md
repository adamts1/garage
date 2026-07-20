# Database

Schema changes are **migrations**. Nothing here is hand-pasted into the SQL
Editor any more, and nothing in `migrations/` ever drops a table.

```
migrations/     ordered, append-only. Applied to every environment in sequence.
seed.sql        demo data. Local and staging ONLY — never production.
legacy/         the pre-migration hand-run files. Archive. Do not run. See legacy/README.md.
```

## Working on the schema

```bash
npm run db:new    add_garage_id      # create a timestamped migration file
npm run db:reset                     # rebuild the local DB from migrations + seed
npm run db:diff   add_garage_id      # generate a migration from local DB changes
npm run db:push                      # apply pending migrations to the linked project
npm run db:lint                      # check migrations parse
```

Rules:

1. **Never edit an applied migration.** Fix it with a new one.
2. **Never `drop table` in a migration.** Rename, deprecate, or write an
   explicit reversible data migration — and back up first.
3. **Test on staging before production.** Always.
4. **Seed data does not belong in a migration.** It goes in `seed.sql`.

## Environments

| | Purpose | Seeded |
|---|---|---|
| local | `supabase start`, throwaway | yes |
| staging | rehearse every migration here first | yes |
| production | the 10 garages | **no** |

Link the CLI to whichever project you are targeting before pushing:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

## seed.sql is not generated yet

It must be **dumped from the real database**, not reconstructed from
`legacy/` — those files have drifted out of sync with each other and with
production (see `legacy/README.md`). Reconstructing from them produces broken
data.

Once the CLI is linked to the demo project:

```bash
npx supabase db dump --data-only -f supabase/seed.sql
```

Then review it before committing — it will contain whatever demo customers were
added through the UI, and it must never contain real customer PII.
