#!/usr/bin/env bash
# simulate.sh — mcp-tools-refresh POST-IMPL simulation (IMPL Phase 3)
# Drives the REAL bundled CLI gateway + example app through the PRD-TRD
# Simulation Contract: catalogVersion stability, change-on-register,
# change-on-unregister, per-caller catalogs. Pass/fail echoes; exit 0 on
# full pass. Uses raw JSON-RPC POSTs (stateless door — no MCP SDK needed).
#
# Usage:
#   bash docs/features/mcp-tools-refresh/simulate.sh [--keep]
set -u

HERE="$(cd "$(dirname "$0")/../../.." && pwd)"          # agentide repo root
BIN="$HERE/packages/agentide/dist/bin.bundled.cjs"      # local bundle (built)
BASE="$(mktemp -d /tmp/agentide-mcp-refresh-sim-XXXXXX)"
EXAMPLE_DIR="${EXAMPLE_DIR:-/home/spanexx/Shared/Learn/Agent-Bridge-SDK/example}"
WANT_APP="${WANT_APP:-1}"                                # 0 = skip the example app (unit-ish runs)
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "  ✅ PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ FAIL: $1"; }
mcp() { # mcp <id> <json-body> — POST /mcp with the operator token
  curl -s -X POST "http://127.0.0.1:7100/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$2"
}
mcp_narrow() { # same with the narrow token
  curl -s -X POST "http://127.0.0.1:7100/mcp" \
    -H "Authorization: Bearer $NARROW" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$2"
}
version_of() { echo "$1" | grep -o '"catalogVersion":"[0-9a-f]*"' | head -1 | cut -d'"' -f4; }
count_of()   { echo "$1" | grep -o '"name":"' | wc -l; }

# build the bundle so we test the real artifact (with the D-127 change)
echo "building bundle…"
(cd "$HERE/packages/agentide" && pnpm run bundle >/dev/null 2>&1) || { echo "bundle failed"; exit 1; }

cleanup() {
  [ "${KEEP:-0}" = "1" ] && { echo "(--keep: leaving gateway+app up, base $BASE)"; return; }
  for p in $(ss -ltnp 2>/dev/null | grep -E ':(7100|7350|3000)\b' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill "$p" 2>/dev/null; done
  sleep 1
  pkill -f "node dist/main.js" 2>/dev/null
  pkill -f "bin.bundled.cjs gateway start" 2>/dev/null
  rm -rf "$BASE"
}
trap cleanup EXIT

echo "== boot =="
node "$BIN" init --data-dir "$BASE/data" --default-tenant acme >/dev/null 2>&1
setsid node "$BIN" gateway start --data-dir "$BASE/data" --all-doors --foreground > "$BASE/gw.log" 2>&1 < /dev/null &
sleep 6
TOKEN="$(node "$BIN" token issue --tenant acme --caller sim-op --scope '*' --data-dir "$BASE/data" | tail -1)"
NARROW="$(node "$BIN" token issue --tenant acme --caller sim-narrow --scope 'system.health' --data-dir "$BASE/data" | tail -1)"

echo "== S1: catalogVersion present + stable =="
V1="$(mcp 1 '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
VER1="$(version_of "$V1")"; CNT1="$(count_of "$V1")"
[ -n "$VER1" ] && [ "${#VER1}" = "12" ] && ok "catalogVersion is a 12-hex fingerprint ($VER1)" || bad "missing catalogVersion: $VER1"
V1B="$(mcp 2 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')"
[ "$(version_of "$V1B")" = "$VER1" ] && ok "stable across identical calls" || bad "version unstable"

echo "== S3: registration changes the fingerprint =="
if [ "$WANT_APP" = "1" ]; then
  if ss -tln | grep -q ':3000\b'; then
    bad "port 3000 already in use — a stale example app is running; kill it first (sim cleanup races)"
    exit 1
  fi
  printf 'PLATFORM_GATEWAY_URL=ws://127.0.0.1:7350\nPLATFORM_APP_ID=nestjs-ecommerce\nPLATFORM_TOKEN=%s\n' \
    "$(node "$BIN" token issue --tenant acme --caller nest-app --scope '*' --data-dir "$BASE/data" | tail -1)" > "$EXAMPLE_DIR/.env"
  (cd "$EXAMPLE_DIR" && pnpm run build >/dev/null 2>&1)
  rm -f /tmp/server.log
  (cd "$EXAMPLE_DIR" && setsid node dist/main.js > /tmp/server.log 2>&1 < /dev/null &)
  REGISTERED=0
  for i in $(seq 1 30); do
    grep -qi "registered 11 caps" /tmp/server.log 2>/dev/null && { REGISTERED=1; break; }
    sleep 1
  done
  [ "$REGISTERED" = "1" ] && ok "example app registered 11 caps" || bad "app never registered"
  V2="$(mcp 3 '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}')"
  VER2="$(version_of "$V2")"; CNT2="$(count_of "$V2")"
  [ "$VER2" != "$VER1" ] && ok "registration changed the fingerprint ($VER1 → $VER2)" || bad "version unchanged after registration"
  [ "$CNT2" -gt "$CNT1" ] && echo "$V2" | grep -q '"product.list"' && ok "business tools present in catalog ($CNT1 → $CNT2 tools)" || bad "business tools missing"
  echo "== S4: unregistration changes the fingerprint =="
  pkill -f "node dist/main.js" 2>/dev/null; sleep 5
  V3="$(mcp 4 '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}')"
  VER3="$(version_of "$V3")"
  [ "$VER3" != "$VER2" ] && ok "unregistration changed the fingerprint ($VER2 → $VER3)" || bad "version unchanged after unregistration"
else
  echo "  (example app skipped — WANT_APP=0; register/unregister checks omitted)"
fi

echo "== S2: per-caller catalogs and fingerprints =="
NV="$(mcp_narrow 5 '{"jsonrpc":"2.0","id":5,"method":"tools/list","params":{}}')"
NCNT="$(count_of "$NV")"
[ "$NCNT" -lt "$CNT1" ] && ok "narrow token sees fewer tools ($NCNT vs operator $CNT1)" || bad "narrow catalog not scoped ($NCNT vs $CNT1)"
NV2="$(mcp_narrow 6 '{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{}}')"
[ "$(version_of "$NV")" = "$(version_of "$NV2")" ] && ok "narrow version stable across identical calls" || bad "narrow version unstable"
# Independence: the narrow token (system.health — a platform cap the example app
# NEVER registers) must NOT see the app's registration: its fingerprint stays
# unchanged while the operator's changed (S3). Staged only when the app ran.
if [ "$WANT_APP" = "1" ] && [ -n "${VER2:-}" ]; then
  NV3="$(mcp_narrow 7 '{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}')"
  if [ "$(version_of "$NV3")" != "$(version_of "$NV")" ]; then
    bad "narrow fingerprint changed on an invisible registration"
  else
    ok "narrow fingerprint independent of invisible registrations"
  fi
fi

echo
echo "═══ simulate.sh: $PASS pass / $FAIL fail ═══"
[ "$FAIL" = "0" ] && exit 0 || exit 1