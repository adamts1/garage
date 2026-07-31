# Database

Schema changes are **migrations**. Nothing here is hand-pasted into the SQL
Editor any more, and nothing in `migrations/` ever drops a table.

```
migrations/     ordered, append-only. Applied to every environment in sequence.
seed.sql        demo data. Local and staging ONLY — never production.
legacy/         the pre-migration hand-run files. Archive. Do not run. See legacy/README.md.
```

## The baseline

`20260730000000_baseline.sql` is the whole schema in one file. The 22
migrations that built it up to 2026-07-30 were squashed into it once every
environment had applied all of them — the version number is deliberately the
last of the 22, so production and staging already carry it as applied and the
squash changed no database.

Their filenames are still the handles used by comments across the codebase and
by the checklist in docs/PRODUCTION.md. Those files live in git history: read
one with `git show e5e2faa:supabase/migrations/20260727000000_invoices.sql`.

Two things a `pg_dump`-based squash silently loses, both restored by hand at
the foot of the baseline and both worth knowing before squashing again:

- **Rows.** The `ticket-photos` bucket is a row in `storage.buckets`, so a
  schema dump omits it — leaving three storage policies pointing at a bucket
  that does not exist.
- **Revoked inherited grants.** The dump records ACL deltas against the
  platform default, so `revoke ... from anon` on a privilege anon held by
  default reads as "no delta" and disappears. That handed anon `TRUNCATE` on
  every tenant table. RLS does not gate `TRUNCATE`.

The squash was verified by diffing a catalogue fingerprint — columns,
constraints, indexes, policies, RLS flags, functions, triggers, grants,
sequences, enums, views, buckets, extensions, publications, replica identity —
of a database built from the 22 migrations against one built from the
baseline. Do that again, not an eyeball pass, if you ever squash again.

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

## Per-garage reference data

`work_defs` / `work_def_items` (the works catalog), `items` (parts) and
`garage_workers` (the team) are all per-garage: each row carries a `garage_id`,
and a tenant policy scopes reads and writes to the caller's garage. They were
each a hardcoded TypeScript constant once, identical for every garage, which
meant a price change or a staff change needed a release.

`garage_workers.code` is what `tickets.assignee` stores — unique within the
garage, deliberately not globally, so two garages can both use `dk`. Retire a
worker with `active = false` instead of deleting them, so old tickets keep
resolving to a name. A new garage starts with none of this; see
docs/WORKFLOW.md §5.

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
