# Database

Schema changes are **migrations**. Nothing here is hand-pasted into the SQL
Editor any more, and nothing in `migrations/` ever drops a table.

```
migrations/     ordered, append-only. Applied to every environment in sequence.
seed.sql        demo data. Local and staging ONLY — never production.
tests/          tenancy.mjs, tenant isolation proved over HTTP against a real
                database; schema-fingerprint.sql, the squash verifier.
```

`legacy/` held the hand-pasted `.sql` files used before migrations existed. It
was deleted on 2026-08-11 with the second squash: the files were superseded, and
two of them opened by destroying data (`drop table ... cascade`,
`delete from public.tickets`) while being labelled "safe to re-run" — true of a
demo database and catastrophic against production. A dead file that deletes
tickets is a foot-gun, not an archive. Git has them:
`git show 7beb12b:supabase/legacy/schema.sql`.

## The baseline

`20260811000000_baseline.sql` is the whole schema in one file. It has been
squashed twice: 22 migrations into `20260730000000_baseline.sql` on 2026-07-30,
and that baseline plus the 17 migrations after it into this one on 2026-08-11.

**The rule that makes a squash safe**: it may only cover migrations every
environment has already applied, and the file must then carry the version of
the *last* of them. Production and staging already record `20260811000000` as
applied, so the squash changed no database anywhere — it rewrote history, it did
not migrate anything. Check before squashing again; the schema probe in
`git log` for `scripts/` or a `migration list --linked` will tell you.

The corollary is the part that is easy to get wrong: **nothing may be added to a
baseline while squashing it**. Anything extra reaches a fresh local database and
never reaches staging or production, because those skip the file entirely. That
is why the incomplete `revoke ... from anon` list at the foot of this baseline
was left incomplete, and fixed by the migration after it instead.

The squashed filenames are still the handles used by comments across the
codebase and by the checklist in docs/PRODUCTION.md. They live in git history:

```bash
git show aaebebf:supabase/migrations/20260806010000_partial_credit_notes.sql
```

Two things a `pg_dump`-based squash silently loses, both restored by hand at
the foot of the baseline and both worth knowing before squashing again:

- **Rows.** The `ticket-photos` bucket is a row in `storage.buckets`, so a
  schema dump omits it — leaving three storage policies pointing at a bucket
  that does not exist.
- **Revoked inherited grants.** A dump writes out the GRANTs an object has and
  cannot write out the ones it was denied: a fresh database re-applies the
  platform's default ACL at `CREATE TABLE` time, and the dump's `GRANT` lines
  only ever add. So `revoke ... from anon` disappears, which handed anon
  `TRUNCATE` on every tenant table. RLS does not gate `TRUNCATE`.

A third thing to know: `supabase db dump` covers the `public` schema only, so
the three policies on `storage.objects` have to be carried across by hand too.

Both squashes were verified by diffing a catalogue fingerprint — columns,
constraints, indexes, policies, RLS flags, function bodies and settings,
triggers, grants, default privileges, sequences, enums, views, buckets,
extensions, publications, replica identity — of a database built from the
migration chain against one built from the baseline alone. The second squash
compared 984 such facts and differed in none. Do that again, not an eyeball
pass, if you ever squash again — `supabase/tests/schema-fingerprint.sql` is the
query, and its header is the procedure.

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

Always dump it from the real database. Never reconstruct it from the old
hand-written `.sql` files that used to live in `legacy/` — they had drifted out
of sync with each other and with production, and rebuilding from them produced
broken data. The dump confirmed it: production had 11 customers where
`schema.sql` seeded 8, and 16 vehicles where the broken join in `vehicles.sql`
would have inserted about 6. That drift is why the folder is gone rather than
kept "just in case".

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
