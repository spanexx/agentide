#!/usr/bin/env bash
# Mirror ESM source from ../agentide/src, skipping __tests__, then compile to CJS.
# Run from this package's directory.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ESM="$HERE/../agentide/src"
DEST="$HERE/src"

if [ ! -d "$SRC_ESM" ]; then
  echo "ERROR: ESM source not found at $SRC_ESM" >&2
  exit 1
fi

echo "Mirroring $SRC_ESM -> $DEST (excluding __tests__)"
rm -rf "$DEST"
mkdir -p "$DEST"
# Copy everything except __tests__
for item in "$SRC_ESM"/*; do
  name=$(basename "$item")
  if [ "$name" = "__tests__" ]; then continue; fi
  cp -R "$item" "$DEST/"
done

# Strip .js from relative imports (CJS doesn't need them, ESM source has them).
find "$DEST" -name '*.ts' -exec sed -i 's|from "\(\.[^"]*\)\.js"|from "\1"|g' {} +

echo "Compiling to CJS..."
cd "$HERE"
npx tsc -p tsconfig.json

echo "Done. Output in $HERE/dist"
