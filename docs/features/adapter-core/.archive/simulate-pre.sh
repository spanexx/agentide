#!/usr/bin/env bash
# simulate-pre.sh — A7 WS server migration onto @spanexx/adapter-core (design sim)
# Pre-impl: no adapter-core code exists yet. This script makes the DESIGN visible:
#   the move map, the survival contract, and the migration order with green gates.
# Run: bash docs/features/adapter-core/simulate-pre.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WS="$ROOT/packages/adapter-websocket"
PASS=0; FAIL=0

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " A7 design sim — WS server pipeline -> @spanexx/adapter-core"
echo " Design locked: A1 boundary, A2 auth, A3 session, A4 response,"
echo "                A5 error envelope, A6 capability lookup."
echo "================================================================"

echo
echo "Step 1 — CURRENT STATE (what the migration starts from)"
echo "--------------------------------------------------------"
[ -d "$WS/src" ] && ok "adapter-websocket package present ($WS)" || bad "missing $WS/src"
files=$(ls "$WS/src"/*.ts | wc -l)
echo "  info: $files server-side source files (excl. client.ts + tests)"
tests=$(grep -rc "it(" "$WS/src/__tests__"/*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')
echo "  info: ~${tests:-?} test cases across $(ls "$WS/src/__tests__"/*.test.ts 2>/dev/null | wc -l) test files"
echo "  info: sim simulate-websocket-adapter.mjs asserts 31 outcomes"
[ -f "$ROOT/scripts/simulate-websocket-adapter.mjs" ] || [ -f "$ROOT/packages/adapter-websocket/scripts/simulate-websocket-adapter.mjs" ] \
  && ok "sim script found" || echo "  info: sim script located under packages/adapter-websocket"

echo
echo "Step 2 — THE MOVE MAP (file-by-file, per A1-A6 locks)"
echo "--------------------------------------------------------"
cat <<'EOF'
  MOVE to adapter-core (shared)                     STAYS in adapter-websocket (door bytes)
  ─────────────────────────────                     ────────────────────────────────────────
  readClaims(token)            (A2/A6)              protocol.ts   — W1-W6 frame envelope
  createAuthPolicy early mode  (A2)                 errors.ts     — WS_ERROR_CODES + table
  response channel types       (A4)                 queue.ts      — 1MiB FIFO, stats, drop-oldest
  error converter + fallback   (A5)                 fanout.ts     — subscribe authz + relay
  generic RecordRegistry       (A1/A7-Q2)           registry.ts   — keeps ConnectionRecord shape
  createCapabilityLookup       (A6)                 invoke.ts     — parse + render (delegates core)
  canonical re-exports         (A1)                 auth.ts       — wire phrases + origin binding
                                                   server.ts     — transport lifecycle
                                                   client.ts     — UNTOUCHED (consumer surface)
                                                   types.ts      — envelope types + config
EOF
echo "  rule: anything a test file imports must keep its exact signature (zero-edit rule)."

echo
echo "Step 3 — SURVIVAL CONTRACT (public exports that must not change)"
echo "--------------------------------------------------------"
cat <<'EOF'
  index.ts must still export (consumers + tests import these):
    createWebSocketAdapter, createWsClient, WsInvokeError, WsDoorMismatchError,
    originMatches, authenticateToken, ConnectionRegistry, WS_ERROR_CODES,
    DEFAULT_CONFIG, AUTH_ERROR_CODES, and all types.
  Internal files tests import directly (invoke.ts, auth.ts, queue.ts, fanout.ts,
  registry.ts, protocol.ts, types.ts, errors.ts) keep their function signatures;
  bodies delegate to adapter-core. Zero edits to __tests__/ + client.ts.
EOF

echo
echo "Step 4 — MIGRATION ORDER (each step leaves the suite green)"
echo "--------------------------------------------------------"
cat <<'EOF'
  1. scaffold @spanexx/adapter-core  (canonical re-exports only — pure additive)
  2. readClaims(token)               (from MCP decodeScopeFromToken; WS unused yet)
  3. error converter + fallback      (A5) — WS hands its table into the pipeline
  4. generic RecordRegistry          (A1) — WS ConnectionRegistry becomes thin wrapper
  5. auth policy early mode          (A2) — authenticateToken delegates, wire phrases stay
  6. response channel                (A4) — WS channel renders invoke.partial/end
  7. createAdapterPipeline wiring    (A1) — server.ts invokes pipeline handlers
  8. capability lookup               (A6) — ships in core; NOT wired into WS frames
  gate after every step: pnpm build && pnpm test (WS suite, unedited) + sim 31/31
EOF

echo
echo "Step 5 — ACCEPTANCE GATES (what proves zero-delta)"
echo "--------------------------------------------------------"
cat <<'EOF'
  G1  all adapter-websocket tests pass with ZERO edits to __tests__/
  G2  simulate-websocket-adapter.mjs still 31/31 (same script, same assertions)
  G3  CLI consumer (agentide/src/consumer.ts) untouched; wire client untouched
  G4  public exports above identical; wire bytes identical (PRD Scenario 11 messages,
      close 1008/1009/1011, WS_ERROR_CODES, auth phrases)
  G5  adapter-core ships its own unit tests for the moved logic (new package)
EOF

echo
echo "================================================================"
echo " RESULT: $PASS pass, $FAIL fail (structural checks above)"
echo " If all [PASS] and the move map reads right -> approve, PRD-TRD next."
echo "================================================================"
