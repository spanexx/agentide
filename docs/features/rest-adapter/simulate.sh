#!/usr/bin/env bash
# simulate.sh — REST adapter post-impl reality check (Phase 6, IMPL §6).
#
# Drives the REAL `createRestAdapter` on 127.0.0.1:7400 (loopback only)
# against the 10 PRD-TRD scenarios via curl. Exits 0 only when all 10
# scenarios pass — same shape as the PRD scenario walk-through but here
# the bytes go through node:http instead of a mocked JS state.
#
# Companion to simulate-pre.html (Phase 0.5 design sim, archived).
#
# Run: bash docs/features/rest-adapter/simulate.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SIM_DIR="$(cd "$(dirname "$0")" && pwd)"
SIM_PORT="${SIM_PORT:-7400}"

PASS=0; FAIL=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
note() { echo "  [note] $1"; }

echo "================================================================"
echo " REST adapter post-impl sim — PRD-TRD scenarios 1-10"
echo "================================================================"

# Pre-flight: build the adapter-rest package so dist/ exists for the
# Node helper to import from (the helper uses the published surface).
echo
echo "P0 — build adapter-rest (dist/ must exist for the helper)"
echo "-------------------------------------------------------"
if (cd "$ROOT" && pnpm --filter @spanexx/adapter-rest build >/dev/null 2>&1); then
  ok "pnpm --filter @spanexx/adapter-rest build"
else
  bad "adapter-rest build failed"
  echo "RESULT: $PASS passed, $FAIL failed"
  exit 1
fi

# Pre-flight: port must be free at boot (the helper binds to it).
echo
echo "P1 — port 7400 free at boot"
echo "----------------------------"
if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -qE ":${SIM_PORT} "; then
    bad "port ${SIM_PORT} is in use at boot"
    exit 1
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -ltn 2>/dev/null | grep -qE ":${SIM_PORT} "; then
    bad "port ${SIM_PORT} is in use at boot"
    exit 1
  fi
fi
ok "port ${SIM_PORT} free at boot"

# Pre-flight: start the helper.
echo
echo "P2 — start createRestAdapter on 127.0.0.1:${SIM_PORT}"
echo "------------------------------------------------------"
SIM_LOG="$(mktemp)"
SIM_PID=""
( cd "$ROOT" && SIM_PORT="$SIM_PORT" node "$SIM_DIR/simulate-server.mjs" >"$SIM_LOG" 2>&1 ) &
SIM_PID=$!
# Wait for READY line.
for _ in $(seq 1 50); do
  if grep -q "^READY " "$SIM_LOG" 2>/dev/null; then break; fi
  sleep 0.1
done
if ! grep -q "^READY " "$SIM_LOG"; then
  bad "helper did not signal READY"
  cat "$SIM_LOG"
  kill "$SIM_PID" 2>/dev/null || true
  exit 1
fi
READY_LINE=$(grep "^READY " "$SIM_LOG" | head -1)
READY_PORT=$(echo "$READY_LINE" | sed -E 's/.*port=([0-9]+).*/\1/')
SCOPED_TOKEN=$(echo "$READY_LINE" | sed -E 's/.*platformReadToken=([^ ]+).*/\1/')
PRODUCT_TOKEN=$(echo "$READY_LINE" | sed -E 's/.*productReadToken=([^ ]+).*/\1/')
EXPIRED_TOKEN="EXPIRED_TEST_TOKEN"
NOSCOPE_TOKEN="NOSCOPE_TEST_TOKEN"
ok "createRestAdapter ready on 127.0.0.1:${READY_PORT} (pid ${SIM_PID})"

BASE="http://127.0.0.1:${READY_PORT}"

# Helpers: drive a real request through the helper's createRestAdapter
# (running on the port printed by the helper's READY line). They:
#   - write the body to /tmp/sim-body.$$
#   - write the response headers to /tmp/sim-hdrs.$$
#   - set $out (HTTP status) and $ctype (content-type header)
#   - print the body to stdout for the run transcript
# Each scenario greps /tmp/sim-body.$$ for body-shape assertions, and the
# content-type assertion is folded into the pass condition (PRD §Simulation
# Contract requires (a) status, (b) body shape, (c) content-type).
post_invoke() {
  local token="$1"
  local body="$2"
  local hdr=()
  if [ -n "$token" ]; then
    hdr=(-H "authorization: Bearer ${token}")
  fi
  out=$(curl -sS -o /tmp/sim-body.$$ -D /tmp/sim-hdrs.$$ -w "%{http_code}" \
    -X POST "${BASE}/invoke" \
    -H "content-type: application/json" "${hdr[@]}" -d "$body")
  ctype=$(grep -i "^content-type:" /tmp/sim-hdrs.$$ | head -1 | sed -E 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//' | tr -d '\r')
  cat /tmp/sim-body.$$
  echo
}

get_capabilities() {
  local token="$1"
  local hdr=()
  if [ -n "$token" ]; then
    hdr=(-H "authorization: Bearer ${token}")
  fi
  out=$(curl -sS -o /tmp/sim-body.$$ -D /tmp/sim-hdrs.$$ -w "%{http_code}" \
    "${BASE}/capabilities" "${hdr[@]}")
  ctype=$(grep -i "^content-type:" /tmp/sim-hdrs.$$ | head -1 | sed -E 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//' | tr -d '\r')
  cat /tmp/sim-body.$$
  echo
}

get_route() {
  local path="$1"
  local token="$2"
  local hdr=()
  if [ -n "$token" ]; then
    hdr=(-H "authorization: Bearer ${token}")
  fi
  out=$(curl -sS -o /tmp/sim-body.$$ -D /tmp/sim-hdrs.$$ -w "%{http_code}" \
    "${BASE}${path}" "${hdr[@]}")
  ctype=$(grep -i "^content-type:" /tmp/sim-hdrs.$$ | head -1 | sed -E 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//' | tr -d '\r')
  cat /tmp/sim-body.$$
  echo
}

EXPECTED_CTYPE="application/json; charset=utf-8"
rm -f /tmp/sim-body.$$ /tmp/sim-hdrs.$$

# ─── Scenarios ────────────────────────────────────────────────────────

echo
echo "S1 — POST /invoke capability.list → 200 {output: cards}"
echo "-------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"capability.list","input":{}}'
if [ "$out" = "200" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q '"output"' /tmp/sim-body.$$ && grep -q 'capability.list' /tmp/sim-body.$$; then
  ok "200 + content-type + {output:[...cards]}"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S2 — POST /invoke product.list + sessionId → 200 {output: products}"
echo "-------------------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"product.list","input":{},"sessionId":"s-1"}'
if [ "$out" = "200" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q '"output"' /tmp/sim-body.$$ && grep -q '"id":"p1"' /tmp/sim-body.$$; then
  ok "200 + content-type + {output:[{id:p1,...}]}"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S3 — POST /invoke without token → 401 TOKEN_INVALID"
echo "---------------------------------------------------"
post_invoke "" '{"capability":"product.list","input":{},"sessionId":"s-1"}'
if [ "$out" = "401" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_TOKEN_INVALID' /tmp/sim-body.$$; then
  ok "401 + content-type + TOKEN_INVALID body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S4 — POST /invoke with expired token → 401 TOKEN_EXPIRED"
echo "-------------------------------------------------------"
post_invoke "$EXPIRED_TOKEN" '{"capability":"product.list","input":{},"sessionId":"s-1"}'
if [ "$out" = "401" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_TOKEN_EXPIRED' /tmp/sim-body.$$; then
  ok "401 + content-type + TOKEN_EXPIRED body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S5 — POST /invoke with empty-scope token → 403 INSUFFICIENT_SCOPE"
echo "----------------------------------------------------------------"
post_invoke "$NOSCOPE_TOKEN" '{"capability":"product.list","input":{},"sessionId":"s-1"}'
if [ "$out" = "403" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_INSUFFICIENT_SCOPE' /tmp/sim-body.$$; then
  ok "403 + content-type + INSUFFICIENT_SCOPE body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S6 — POST /invoke product.list without sessionId → 400 SESSION_REQUIRED"
echo "-----------------------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"product.list","input":{}}'
if [ "$out" = "400" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_SESSION_REQUIRED' /tmp/sim-body.$$; then
  ok "400 + content-type + SESSION_REQUIRED body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S7 — POST /invoke does.not.exist → 404 CAPABILITY_NOT_FOUND"
echo "-----------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"does.not.exist","input":{},"sessionId":"s-1"}'
if [ "$out" = "404" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_CAPABILITY_NOT_FOUND' /tmp/sim-body.$$; then
  ok "404 + content-type + CAPABILITY_NOT_FOUND body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S8 — GET /capabilities → 200 {capabilities: cards}"
echo "--------------------------------------------------"
get_capabilities "$SCOPED_TOKEN"
if [ "$out" = "200" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q '"capabilities"' /tmp/sim-body.$$ && grep -q 'capability.list' /tmp/sim-body.$$; then
  ok "200 + content-type + {capabilities:[...]}"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S9 — POST /invoke test.rate-limit → 429 RATE_LIMIT_EXCEEDED"
echo "-----------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"test.rate-limit","input":{},"sessionId":"s-1"}'
if [ "$out" = "429" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_RATE_LIMIT_EXCEEDED' /tmp/sim-body.$$; then
  ok "429 + content-type + RATE_LIMIT_EXCEEDED body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S10 — POST /invoke test.handler-error → 500 HANDLER_TIMEOUT (retryable: true)"
echo "----------------------------------------------------------------------------"
post_invoke "$SCOPED_TOKEN" '{"capability":"test.handler-error","input":{},"sessionId":"s-1"}'
if [ "$out" = "500" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_HANDLER_TIMEOUT' /tmp/sim-body.$$ \
   && grep -q '"retryable":true' /tmp/sim-body.$$; then
  ok "500 + content-type + HANDLER_TIMEOUT + retryable:true"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

# ─── Routing sanity ───────────────────────────────────────────────────

echo
echo "S11 — routing: GET /capabilities/{name} → 404 INVALID_REQUEST (D-100 deferral)"
echo "----------------------------------------------------------------------------"
get_route "/capabilities/some.capability" "$SCOPED_TOKEN"
if [ "$out" = "404" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_INVALID_REQUEST' /tmp/sim-body.$$; then
  ok "404 + content-type + INVALID_REQUEST body (route not registered)"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

echo
echo "S12 — routing: GET /unknown → 404 INVALID_REQUEST"
echo "-------------------------------------------------"
get_route "/unknown" ""
if [ "$out" = "404" ] && [ "$ctype" = "$EXPECTED_CTYPE" ] \
   && grep -q 'GATEWAY_INVALID_REQUEST' /tmp/sim-body.$$; then
  ok "404 + content-type + INVALID_REQUEST body"
else
  bad "status=$out ctype=$ctype body=$(cat /tmp/sim-body.$$)"
fi

# ─── Tear down ────────────────────────────────────────────────────────

echo
echo "Teardown — stop the helper"
echo "--------------------------"
if kill -TERM "$SIM_PID" 2>/dev/null; then
  for _ in $(seq 1 20); do
    if ! kill -0 "$SIM_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  kill -0 "$SIM_PID" 2>/dev/null && kill -KILL "$SIM_PID" 2>/dev/null || true
  ok "helper stopped"
else
  bad "helper was already gone"
fi
rm -f "$SIM_LOG"

echo
echo "================================================================"
echo " RESULT: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo " ALL SCENARIOS SATISFIED — REST adapter ready for delivery"
else
  echo " SCENARIO GAPS REMAIN — see [FAIL] lines above"
fi
echo "================================================================"
exit $FAIL