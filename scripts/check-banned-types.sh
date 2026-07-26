#!/bin/sh
# check-banned-types — reject `any` and unwanted `unknown` in source files
# Usage: scripts/check-banned-types.sh [dir...]
# Defaults to scanning packages/*/src/ excluding __tests__ and node_modules.

set -e

SRCDIRS=${@:-packages/*/src}
EXIT=0

scan_any() {
  local dir="$1"
  local hits
  hits=$(rg -n ':\s*any\b|as any\b' --glob '*.ts' "$dir" 2>/dev/null || true)
  hits=$(echo "$hits" | grep -v '/__tests__/' || true)
  if [ -n "$hits" ]; then
    echo "ERROR: banned type \`any\` found:"
    echo "$hits"
    return 1
  fi
  return 0
}

scan_unknown() {
  local dir="$1"
  local hits
  # All :unknown or <unknown> or Record.*unknown or as unknown
  hits=$(rg -n ':\s*unknown\b|<unknown>|Record.*\bunknown\b|as unknown\b' \
    --glob '*.ts' "$dir" 2>/dev/null || true)
  # Exclude test files and catch clauses
  local filtered
  filtered=$(echo "$hits" | grep -v '/__tests__/' | grep -v 'catch\s*(' || true)
  if [ -n "$filtered" ]; then
    echo "ERROR: banned type \`unknown\` in non-catch position found:"
    echo "$filtered"
    return 1
  fi
  return 0
}

for dir in $SRCDIRS; do
  [ -d "$dir" ] || continue
  scan_any "$dir" || EXIT=1
  scan_unknown "$dir" || EXIT=1
done

[ "$EXIT" = 0 ] && echo "check-banned-types: OK (no banned types in source)"
exit $EXIT
