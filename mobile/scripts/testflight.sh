#!/usr/bin/env bash
# Build the iOS app on EAS and push it straight to TestFlight.
#
#   npm run testflight            # build + auto-submit
#   npm run testflight -- --build-only    # build, don't submit
#
# EAS builds from a git archive, so ANYTHING NOT COMMITTED IS NOT IN THE BUILD.
# That is the mistake this script exists to catch.

set -euo pipefail

cd "$(dirname "$0")/.."          # mobile/
REPO_ROOT="$(git rev-parse --show-toplevel)"

BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$BLUE" "$OFF" "$1"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%sxx%s  %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

SUBMIT=1
[[ "${1:-}" == "--build-only" ]] && SUBMIT=0

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

# ---------- 4. say what is actually being built ----------
BRANCH="$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD)"
COMMIT="$(cd "$REPO_ROOT" && git log --oneline -1)"
say "Building from"
printf '    branch %s%s%s\n' "$GREEN" "$BRANCH" "$OFF"
printf '    commit %s\n' "$COMMIT"

# ---------- 5. build (+ submit) ----------
if [[ "$SUBMIT" == "1" ]]; then
  say "Building on EAS and auto-submitting to TestFlight"
  npx --yes eas-cli@latest build --platform ios --profile production --auto-submit
  echo
  printf '%sDone.%s Apple processes the build for ~5-15 min, then it appears in TestFlight:\n' "$GREEN" "$OFF"
  echo "  https://appstoreconnect.apple.com/apps/6790709441/testflight/ios"
else
  say "Building on EAS (no submit)"
  npx --yes eas-cli@latest build --platform ios --profile production
  echo
  printf '%sBuild done.%s Submit later with: npm run submit:ios\n' "$GREEN" "$OFF"
fi
