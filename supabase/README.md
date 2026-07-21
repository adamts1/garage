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

## Regenerating seed.sql

Always dump it from the real database. Never reconstruct it from `legacy/` —
those files have drifted out of sync with each other and with production (see
`legacy/README.md`), and rebuilding from them produces broken data. The dump
confirmed it: production has 11 customers where `schema.sql` seeds 8, and 16
vehicles where the broken join in `vehicles.sql` would have inserted about 6.

```bash
npx supabase db dump --data-only --schema public -f supabase/seed.sql
```

**`--schema public` is not optional.** Without it the dump also covers the
`auth` and `storage` schemas. That is harmless today because there is no login
yet, but once Phase 2 lands, an unscoped dump would pull `auth.users` into a
file committed to git — email addresses, password hashes, and live session and
refresh tokens. Keep the flag.

Review the output before committing, and never dump a database holding real
customer data into this file.
