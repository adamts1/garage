#!/usr/bin/env bash
# Build a distributable artifact on EAS.
#
#   bash scripts/release.sh ios --submit                     # production -> TestFlight
#   bash scripts/release.sh ios                              # production, build only
#   bash scripts/release.sh android                          # production .aab for Play
#   bash scripts/release.sh ios --profile staging --submit   # staging -> TestFlight
#
# Use the npm scripts rather than calling this directly:
#   npm run testflight | npm run testflight:staging | npm run build:prod:android
#
# EAS builds from a git archive, so ANYTHING NOT COMMITTED IS NOT IN THE BUILD.
# That is the mistake this script exists to catch. It applies to every platform
# and every profile, which is why this takes both as arguments instead of being
# the iOS-and-production-only scripts/testflight.sh it started as: a guarded
# release path and an unguarded one is how the unguarded one gets used.

set -euo pipefail

cd "$(dirname "$0")/.."          # mobile/
REPO_ROOT="$(git rev-parse --show-toplevel)"

BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$BLUE" "$OFF" "$1"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%sxx%s  %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# ---------- 0. arguments ----------
PLATFORM="${1:-}"
case "$PLATFORM" in
  ios|android) shift ;;
  *) die "Usage: release.sh <ios|android> [--profile <name>] [--submit]" ;;
esac

PROFILE="production"
SUBMIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; [[ -z "$PROFILE" ]] && die "--profile needs a name."; shift 2 ;;
    --submit)  SUBMIT=1; shift ;;
    *)         die "Unknown argument: $1" ;;
  esac
done

# eas.json is the single source of truth for where a submission lands. Reading
# the id back from it means this script cannot drift into printing a link to one
# app while EAS uploads to another.
ASC_APP_ID="$(node -p "require('./eas.json').submit?.['$PROFILE']?.ios?.ascAppId ?? ''" 2>/dev/null || true)"

# Only iOS has submit credentials configured. Android needs a Google Play
# service account first; until then the AAB is uploaded to Play Console by hand.
if [[ "$SUBMIT" == "1" && "$PLATFORM" == "android" ]]; then
  die "No Play submit configured yet — build the AAB and upload it in Play Console."
fi
if [[ "$SUBMIT" == "1" && -z "$ASC_APP_ID" ]]; then
  die "No submit target for profile '$PROFILE' — add submit.$PROFILE.ios.ascAppId to eas.json."
fi

# ---------- 1. logged in? ----------
say "Checking EAS login"
WHO="$(npx --yes eas-cli@latest whoami 2>/dev/null | tail -1 || true)"
[[ -z "$WHO" || "$WHO" == *"Not logged in"* ]] && die "Not logged in to EAS. Run: npx eas-cli login"
printf '    logged in as %s%s%s\n' "$GREEN" "$WHO" "$OFF"

# ---------- 2. typecheck before burning build minutes ----------
say "Typechecking"
npx tsc --noEmit || die "Typecheck failed. Fix the errors before building."
printf '    %sclean%s\n' "$GREEN" "$OFF"

# ---------- 3. uncommitted changes would be SILENTLY excluded ----------
# packages/shared is part of the app since Phase 1 — it is linked in as a `file:`
# dependency and its source is bundled. Checking only mobile/ would let
# uncommitted shared changes be silently excluded, which is the exact mistake
# this check exists to prevent.
DIRTY="$(cd "$REPO_ROOT" && git status --porcelain -- mobile/ packages/shared/)"
if [[ -n "$DIRTY" ]]; then
  warn "Uncommitted changes under mobile/ or packages/shared/ — EAS builds from git, so these will NOT be in the build:"
  printf '%s\n' "$DIRTY" | sed 's/^/      /'
  echo
  read -r -p "    Commit them now? [y]es / [n]o, build without them / [a]bort: " ANS
  case "$ANS" in
    y|Y)
      read -r -p "    Commit message: " MSG
      [[ -z "$MSG" ]] && die "Empty commit message."
      (cd "$REPO_ROOT" && git add mobile/ packages/shared/ && git commit -m "$MSG")
      printf '    %scommitted%s\n' "$GREEN" "$OFF"
      ;;
    n|N) warn "Building WITHOUT those changes." ;;
    *)   die "Aborted." ;;
  esac
else
  printf '    %sworking tree clean%s\n' "$GREEN" "$OFF"
fi

# ---------- 4. say what is actually being built, and against what ----------
BRANCH="$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD)"
COMMIT="$(cd "$REPO_ROOT" && git log --oneline -1)"
say "Building from"
printf '    platform %s%s%s\n' "$GREEN" "$PLATFORM" "$OFF"
printf '    profile  %s%s%s\n' "$GREEN" "$PROFILE" "$OFF"
printf '    branch   %s%s%s\n' "$GREEN" "$BRANCH" "$OFF"
printf '    commit   %s\n' "$COMMIT"
if [[ "$PROFILE" == "production" ]]; then
  printf '    database %sPRODUCTION%s — real garages\n' "$RED" "$OFF"
else
  printf '    database %sstaging%s\n' "$YELLOW" "$OFF"
fi

# ---------- 5. build (+ submit) ----------
if [[ "$SUBMIT" == "1" ]]; then
  say "Building on EAS and auto-submitting to TestFlight"
  npx --yes eas-cli@latest build --platform "$PLATFORM" --profile "$PROFILE" --auto-submit
  echo
  printf '%sDone.%s Apple processes the build for ~5-15 min, then it appears in TestFlight:\n' "$GREEN" "$OFF"
  echo "  https://appstoreconnect.apple.com/apps/$ASC_APP_ID/testflight/ios"
else
  say "Building on EAS (no submit)"
  npx --yes eas-cli@latest build --platform "$PLATFORM" --profile "$PROFILE"
  echo
  if [[ "$PLATFORM" == "android" ]]; then
    printf '%sBuild done.%s Install from the link above, or upload the artifact in Play Console.\n' "$GREEN" "$OFF"
  elif [[ -n "$ASC_APP_ID" ]]; then
    printf '%sBuild done.%s Submit later with: eas submit --platform ios --profile %s\n' "$GREEN" "$OFF" "$PROFILE"
  else
    printf '%sBuild done.%s\n' "$GREEN" "$OFF"
  fi
fi
