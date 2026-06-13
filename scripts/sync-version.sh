#!/usr/bin/env bash
# sync-version.sh
# Reads the version from packages/antena/package.json and updates the
# "Antena vX.Y.Z" footer in RightSidebar.tsx. Run before each release
# (or wire it into a pre-commit hook).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO_ROOT/packages/antena/package.json"
FOOTER="$REPO_ROOT/packages/antena/src/components/layout/RightSidebar.tsx"

VERSION=$(node -e "console.log(require('$PKG').version)")
if [ -z "$VERSION" ]; then
  echo "ERROR: could not read version from $PKG" >&2
  exit 1
fi

echo "Found version $VERSION"
echo "Updating footer in $FOOTER"

# Replace 'Antena v0.0.0' (or any version) with 'Antena v$VERSION'.
# Use perl for in-place sed-like edit (works on macOS).
perl -i -pe "s/Antena v[0-9]+\.[0-9]+\.[0-9]+/Antena v$VERSION/g" "$FOOTER"

# Verify
if grep -q "Antena v$VERSION" "$FOOTER"; then
  echo "Footer updated: Antena v$VERSION"
else
  echo "ERROR: footer update failed" >&2
  exit 1
fi
