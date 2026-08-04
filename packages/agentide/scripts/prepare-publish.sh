#!/usr/bin/env bash
# prepare-publish.sh — run by pnpm publish (prepublishOnly hook).
#
# Strategy: deps stay as workspace:* in source so esbuild can resolve them
# during bundling. At publish time npm rewrites workspace:* to the actual
# resolved versions (or empty, depending on tarball processing), so we don't
# need to flatten manually. The published @spanexx/agentide has dependencies: {}
# because the bundle is self-contained.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# Make sure dev deps (esbuild) are installed.
echo "[prepare-publish] Installing dev deps..."
pnpm install --prod=false --ignore-scripts 2>&1 | tail -3 || true

# Build the bundle if missing or stale.
if [ ! -f dist/bin.bundled.cjs ] || [ src/bin.ts -nt dist/bin.bundled.cjs ]; then
  echo "[prepare-publish] Building bundle..."
  pnpm run bundle
fi

echo "[prepare-publish] Ready to publish."
