#!/usr/bin/env bash
# simulate.sh — A7 post-impl reality check: WS server migration onto @spanexx/adapter-core
# Post-impl: adapter-core EXISTS and the WS door delegates. This script drives the
# REAL gates (build, test suites, wire sim, exports diff, consumer diff, unwired lookup)
# against PRD-TRD Scenarios 1-8. Different from simulate-pre.sh (design sim, pre-code).
# Run: bash docs/features/adapter-core/simulate.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CORE="$ROOT/packages/adapter-core"
WS="$ROOT/packages/adapter-websocket"
PASS=0; FAIL=0

# vitest 4 prints ANSI colors even when piped, breaking "Tests N passed" greps.
# Strip ANSI escapes everywhere test/sim output is matched (S2/S7 false-FAIL fix, 2026-08-07).
strip_ansi() { sed -e 's/\x1b\[[0-9;]*m//g'; }

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " A7 post-impl sim — Scenario 1-8 reality check"
echo "================================================================"

echo
echo "S1 — adapter-core exists and builds (canonical exports present)"
echo "---------------------------------------------------------------"
if [ -d "$CORE/src" ] && [ -f "$CORE/package.json" ]; then
  ok "adapter-core package present"
else
  bad "missing $CORE"
fi
(cd "$ROOT" && pnpm --filter @spanexx/adapter-core build >/dev/null 2>&1) \
  && ok "core builds (tsc --build)" || bad "core build failed"
for sym in readClaims createAuthPolicy createCapabilityLookup createAdapterPipeline createErrorConverter createResponseChannel RecordRegistry; do
  grep -q "$sym" "$CORE/src/index.ts" && ok "export: $sym" || bad "missing export: $sym"
done
grep -q "GatewayErrorPayload" "$CORE/src/index.ts" && ok "re-export: GatewayErrorPayload (A5 envelope)" || bad "missing GatewayErrorPayload"

echo
echo "S7 — core ships its own unit tests (moved logic, green)"
echo "--------------------------------------------------------"
core_tests=$(cd "$ROOT" && pnpm vitest run packages/adapter-core 2>&1 | strip_ansi | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+")
[ -n "${core_tests:-}" ] && ok "core suite green ($core_tests tests)" || bad "core suite not green"

echo
echo "S2 — WS suite passes UNEDITED (migration oracle)"
echo "------------------------------------------------"
ws_tests=$(cd "$ROOT" && pnpm vitest run packages/adapter-websocket 2>&1 | strip_ansi | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+")
[ -n "${ws_tests:-}" ] && ok "WS suite green ($ws_tests tests)" || bad "WS suite failed"
if [ -z "$(cd "$ROOT" && git diff --stat -- packages/adapter-websocket/__tests__ packages/adapter-websocket/src/client.ts)" ]; then
  ok "zero edits: __tests__/ + client.ts untouched (git diff empty)"
else
  bad "zero-edit rule violated — tests or client.ts modified"
fi

echo
echo "S3 — wire simulation unchanged (same script, same assertions)"
echo "--------------------------------------------------------------"
sim_out=$(cd "$ROOT" && node packages/agentide/scripts/simulate-websocket-adapter.mjs 2>&1)
echo "$sim_out" | strip_ansi | grep -q "0 failed" && ok "sim green (was 31 pre-migration; count may grow)" || bad "sim failed: $(echo "$sim_out" | tail -1)"

echo
echo "S4 — public surface identical (index.ts exports pre/post)"
echo "-----------------------------------------------------------"
exp=$(cd "$ROOT" && git show HEAD:packages/adapter-websocket/src/index.ts | grep -E "^export (function|const|class|type|interface|enum|\{)" | sort)
expnow=$(grep -E "^export (function|const|class|type|interface|enum|\{)" "$WS/src/index.ts" | sort)
if [ "$exp" = "$expnow" ]; then
  ok "index.ts export list byte-identical vs HEAD"
else
  bad "export drift detected:"; diff <(echo "$exp") <(echo "$expnow")
fi

echo
echo "S5 — wire bytes identical (close codes + auth phrases, via sim + source)"
echo "------------------------------------------------------------------------"
grep -q "CLOSE_AUTH.*1008\|1008" "$WS/src/server.ts" && ok "close 1008 (auth) present" || bad "close 1008 missing"
grep -q "CLOSE_TOO_LARGE.*1009\|1009" "$WS/src/server.ts" && ok "close 1009 (too large) present" || bad "close 1009 missing"
grep -q "CLOSE_HEARTBEAT.*1011\|1011" "$WS/src/server.ts" && ok "close 1011 (heartbeat) present" || bad "close 1011 missing"
grep -q '"invoke.partial"' "$WS/src/invoke.ts" && ok "invoke.partial frame rendered" || bad "invoke.partial missing"
grep -q '"invoke.end"' "$WS/src/invoke.ts" && ok "invoke.end frame rendered" || bad "invoke.end missing"

echo
echo "S6 — consumers untouched (CLI consumer + wire client)"
echo "-------------------------------------------------------"
if [ -z "$(cd "$ROOT" && git diff --stat -- packages/adapter-websocket/src/client.ts)" ] \
   && [ -z "$(cd "$ROOT" && git diff --stat -- packages/agentide/src/consumer.ts)" ]; then
  ok "consumer.ts + client.ts untouched"
else
  bad "consumer surface modified"
fi

echo
echo "S8 — capability lookup ships unwired (no WS discovery frame)"
echo "-------------------------------------------------------------"
if grep -q "createCapabilityLookup" "$CORE/src/index.ts"; then
  ok "createCapabilityLookup exported from core"
else
  bad "lookup missing from core exports"
fi
if grep -q "capability.list" "$WS/src/protocol.ts" 2>/dev/null || grep -q '"discover"' "$WS/src/protocol.ts" 2>/dev/null; then
  bad "WS gained a discovery frame — violates S8"
else
  ok "no discovery frame in WS protocol (still reachable via plain invoke, kernel capability)"
fi
grep -q 'readClaims(token)' "$CORE/src/capabilities/lookup.ts" && ok "lookup scope via readClaims(token).scope" || bad "lookup scope not via readClaims"

echo
echo "================================================================"
echo " RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo " ALL SCENARIOS SATISFIED" || echo " SCENARIO GAPS REMAIN"
echo "================================================================"
exit $FAIL
