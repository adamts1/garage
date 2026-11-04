#!/usr/bin/env bash
# A full backup of PRODUCTION to a local folder: schema, data (user accounts
# included), roles, and the photo files the database only points at.
#
#   npm run backup:prod                 # → ~/Documents/MyBusiness/Garage-backups/prod-<date-time>
#   npm run backup:prod -- /some/dir    # → a folder of your choosing
#
# Read-only against production. It links the Supabase CLI to production for the
# dump and links it back to STAGING on the way out — on success, on failure and
# on Ctrl-C alike — because a CLI left on production turns the next
# `npm run db:push` into a production deploy.
#
# The folder holds customers' personal data (names, phones, ת״ז). It is created
# outside the repo and readable by your user only. Do not send it anywhere.
#
# Restore, into an EMPTY database, in this order: roles.sql, schema.sql,
# data.sql; then upload storage/<bucket>/… back to the same bucket paths.
set -euo pipefail

PROD_REF=farpgkljbmlaeiocrore
STAGING_REF=poksqsdklnhaumozriqd

cd "$(dirname "$0")/.."
OUT="${1:-$HOME/Documents/MyBusiness/Garage-backups/prod-$(date +%Y-%m-%d-%H%M)}"

[ -f .env.production.local ] || { echo "Missing .env.production.local (production URL + service_role key)." >&2; exit 1; }
case "$OUT" in "$PWD"/*) echo "Refusing to write a backup inside the repo: $OUT" >&2; exit 1 ;; esac

linked() { cat supabase/.temp/project-ref 2>/dev/null || true; }
link() { echo "" | npx --yes supabase link --project-ref "$1" >/dev/null 2>&1; }

back_to_staging() {
  link "$STAGING_REF" || true
  if [ "$(linked)" = "$STAGING_REF" ]; then
    echo "✓ Supabase CLI is linked to staging again."
  else
    echo "!! Supabase CLI is linked to '$(linked)', NOT staging. Run: npx supabase link --project-ref $STAGING_REF" >&2
  fi
}
trap back_to_staging EXIT

echo "→ Linking the CLI to production ($PROD_REF)…"
link "$PROD_REF"
[ "$(linked)" = "$PROD_REF" ] || { echo "Could not link to production." >&2; exit 1; }

mkdir -p "$OUT"
chmod 700 "$OUT"

# The pooler sometimes refuses the CLI's temporary login on the first try
# ("unsupported or invalid secret format"); a retry gets through.
dump() {
  local file="$1"; shift
  for attempt in 1 2 3; do
    if npx --yes supabase db dump --linked "$@" -f "$file" >/dev/null 2>"$OUT/.dump.log" && [ -s "$file" ]; then
      echo "  ✓ $(basename "$file") ($(du -h "$file" | cut -f1))"
      return 0
    fi
    echo "  … $(basename "$file") failed (attempt $attempt), retrying"
    sleep 5
  done
  cat "$OUT/.dump.log" >&2
  return 1
}

echo "→ Dumping to $OUT"
dump "$OUT/schema.sql"
dump "$OUT/data.sql" --data-only --use-copy
dump "$OUT/roles.sql" --role-only
rm -f "$OUT/.dump.log"
chmod 600 "$OUT"/*.sql

echo "→ Downloading the photo files"
node scripts/backup-prod-photos.mjs "$OUT"

echo "→ Rows per table:"
awk '/^COPY /{t=$2; n=0; next} /^\\\.$/{if (t != "") print "    " n "\t" t; t=""; next} t != ""{n++}' "$OUT/data.sql" \
  | grep -E '"public"|"auth"\."users"|"storage"\."objects"'

echo "✓ Backup complete: $OUT"
