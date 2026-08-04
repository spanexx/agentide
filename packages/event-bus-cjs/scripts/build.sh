#!/usr/bin/env bash
# Mirror ESM source from ../event-bus/src, then compile to CJS.
# Run from this package's directory.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ESM="$HERE/../event-bus/src"
DEST="$HERE/src"

if [ ! -d "$SRC_ESM" ]; then
  echo "ERROR: ESM source not found at $SRC_ESM" >&2
  exit 1
fi

echo "Mirroring $SRC_ESM -> $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC_ESM/." "$DEST/"

# Strip .js from relative imports (CJS doesn't need them, ESM source has them)
# Find: from "./X.js" or from "./X.js"  ->  from "./X"
find "$DEST" -name '*.ts' -exec sed -i 's|from "\(\.[^"]*\)\.js"|from "\1"|g' {} +

echo "Compiling to CJS..."
cd "$HERE"
npx tsc -p tsconfig.json

echo "Done. Output in $HERE/dist"