#!/usr/bin/env bash
# prepare-publish.sh — run by pnpm publish (prepublishOnly hook).
#
# Strategy: the CLI is a self-contained esbuild bundle. Every internal dep is
# inlined, so the published package must ship `dependencies: {}` — zero runtime
# deps. If workspace:* refs leak into the tarball, npm rewrites them to real
# versions that may not exist on the registry (the 0.0.2 / 0.0.4 ETARGET bug).
#
# Steps:
#   1. Empty the dependencies field in package.json.
#   2. Install dev deps (esbuild lives in devDependencies).
#   3. Build the bundle so dist/bin.bundled.cjs exists in the tarball.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# 1. Empty runtime dependencies (the bundle covers everything).
python3 - <<'EOF'
import json
p = json.load(open("package.json"))
p["dependencies"] = {}
with open("package.json", "w") as f:
    json.dump(p, f, indent=2)
    f.write("\n")
EOF
echo "[prepare-publish] dependencies emptied for bundled CLI."

# 2. Install dev deps (esbuild etc).
echo "[prepare-publish] Installing dev deps..."
pnpm install --prod=false --ignore-scripts 2>&1 | tail -3 || true

# 3. Build the bundle — ALWAYS. The mtime check on src/bin.ts alone misses
# changes in cli.ts/start.ts/lifecycle.ts etc., which silently ships a stale
# bundle (the 0.0.3-in-0.0.5 bug). Rebuild unconditionally on publish.
echo "[prepare-publish] Building bundle..."
pnpm run bundle

echo "[prepare-publish] Ready to publish."