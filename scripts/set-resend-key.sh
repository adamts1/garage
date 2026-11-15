#!/bin/zsh
# Store the Resend API key as a Supabase Edge Function secret, without the key
# ever appearing on screen, in shell history, or in a file.
#
#   npm run resend-key          -> staging
#   npm run resend-key:prod     -> production
#
# The project ref is written here rather than typed, because a ref copied out
# of right-to-left text picks up invisible direction marks and the CLI rejects
# it as "Invalid project ref format".
set -e
ref="$1"
case "$ref" in
  poksqsdklnhaumozriqd) env=staging ;;
  farpgkljbmlaeiocrore) env=PRODUCTION ;;
  *) echo "unknown project ref: $ref" >&2; exit 1 ;;
esac

echo "Setting RESEND_API_KEY on $env ($ref)."
read -s "key?Paste the Resend key (starts with re_) and press Enter: "
echo
# Strip anything that is not part of a key — spaces, line breaks, and the
# invisible direction marks a paste can carry.
key=$(printf '%s' "$key" | LC_ALL=C tr -cd 'A-Za-z0-9_-')
if [[ "$key" != re_* ]]; then
  echo "That does not look like a Resend key (it should start with re_). Nothing was saved." >&2
  exit 1
fi

npx supabase secrets set --project-ref "$ref" "RESEND_API_KEY=$key" >/dev/null
unset key
echo "Saved. Secrets on $env now:"
npx supabase secrets list --project-ref "$ref" | grep -o '"name":"[^"]*"' | sed 's/"name"://; s/"//g'
