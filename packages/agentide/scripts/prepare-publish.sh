#!/usr/bin/env bash
# prepare-publish.sh — run automatically by `pnpm publish` (via prepublishOnly hook).
#
# Strips workspace:* refs from package.json deps because `npm publish`
# can't resolve them. The bundled CLI (dist/bin.bundled.js) inlines
# every internal dep via esbuild, so the published package needs
# zero runtime dependencies — only the library API (createPlatform)
# is affected, and that's documented in README.
#
# Side effect: edits package.json. The next `pnpm install` will
# rewrite workspace refs back automatically; nothing breaks locally.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

if grep -q '"workspace:\*"' package.json; then
  # empty out dependencies + devDependencies (bundling covers all runtime needs)
  tmp="$(mktemp)"
  python3 -c '
import json, sys
with open("package.json") as f:
    pkg = json.load(f)
pkg["dependencies"] = {}
with open(sys.argv[1], "w") as f:
    json.dump(pkg, f, indent=2)
' "$tmp"
  mv "$tmp" package.json
  echo "[prepare-publish] Stripped workspace refs from package.json dependencies."
else
  echo "[prepare-publish] No workspace refs to strip. Continuing."
fi

# Ensure the bundle exists and is up to date.
if [ ! -f dist/bin.bundled.js ] || [ src/bin.ts -nt dist/bin.bundled.js ]; then
  echo "[prepare-publish] Building bundle..."
  pnpm run bundle
fi

echo "[prepare-publish] Ready to publish. Run \`npm publish --access public\` to push."
