#!/usr/bin/env bash
# Mirror ESM source from ../sdk-browser/src, rewrite @spanexx/event-bus to -cjs variant, compile.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ESM="$HERE/../sdk-browser/src"
DEST="$HERE/src"

if [ ! -d "$SRC_ESM" ]; then
  echo "ERROR: ESM source not found at $SRC_ESM" >&2
  exit 1
fi

echo "Mirroring $SRC_ESM -> $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC_ESM/." "$DEST/"

# Strip .js from relative imports
find "$DEST" -name '*.ts' -exec sed -i 's|from "\(\.[^"]*\)\.js"|from "\1"|g' {} +

# Rewrite @spanexx/event-bus -> @spanexx/event-bus-cjs
find "$DEST" -name '*.ts' -exec sed -i 's|"@spanexx/event-bus"|"@spanexx/event-bus-cjs"|g' {} +

echo "Compiling to CJS..."
cd "$HERE"
npx tsc -p tsconfig.json

echo "Done. Output in $HERE/dist"