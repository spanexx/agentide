#!/usr/bin/env bash
# cli-consumer-ux — post-impl simulation. 2026-08-06.
# Drives the REAL `agentide` binary against a REAL gateway to verify
# every scenario in the PRD-TRD Behavioral Spec (sections 1-6).
# Companion to simulate-pre.sh — that one mirrored the design with
# hardcoded wire frames; this one is the reality check.
#
# Run UNSANDBOXED (loopback binding + websocket + example app).
# Usage: bash docs/features/cli-consumer-ux/simulate.sh
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# Use the inner-repo binary so the test exercises the SHIPPED pack code, not
# whatever global @spanexx/agentide the host happens to have installed.
AG="$ROOT/packages/agentide/dist/bin.bundled.cjs"
EXAMPLE="$ROOT/../example"
W=/tmp/ag-cliux-sim
rm -rf "$W"; mkdir -p "$W"
LOG="$W/transcript.log"
: > "$LOG"

PASS=0; FAIL=0
pass(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
fail(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
note(){ echo "  [note] $*"; }
section(){ echo; echo "===== $* ====="; }
ports(){ ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; }
jwt_of(){ grep -oE 'eyJ[A-Za-z0-9_.-]+' "$1" | head -1; }
NEST_PID=""
cleanup(){
  if [ -n "$NEST_PID" ] && kill -0 "$NEST_PID" 2>/dev/null; then
    kill "$NEST_PID" 2>/dev/null || true
    wait "$NEST_PID" 2>/dev/null || true
  fi
  timeout 10 agentide stop >/dev/null 2>&1 || true
  sleep 1
  ports | grep -qE ':(7200|7300|7350)\b' && echo "WARNING: ports still listening" || true
}
trap cleanup EXIT INT TERM

DD="$W/data"

# Pre-flight: confirm the binary version + Node.
section "preflight"
$AG --version | head -1 | tee -a "$LOG"
node --version | tee -a "$LOG"

# Pre-create the data dir (init doesn't mkdir — see drift D-78).
mkdir -p "$DD"

# ---------------------------------------------------------------------------
section "1. init (with pre-created data dir)"
$AG init --data-dir "$DD" --default-tenant acme --default-tenant-name "Acme" > "$W/init.out" 2>&1 && pass "init" || fail "init"
head -3 "$W/init.out" | tee -a "$LOG"

section "1a. local commands: tenant + token"
$AG tenant list --data-dir "$DD" > "$W/tenants.out" 2>&1 && pass "tenant list" || fail "tenant list"
cat "$W/tenants.out" | tee -a "$LOG"
$AG token issue --tenant acme --caller cli-e2e --scope '*' --data-dir "$DD" > "$W/token.out" 2>&1 && pass "token issue" || fail "token issue"
TOKEN=$(jwt_of "$W/token.out")
[ -n "$TOKEN" ] && pass "token minted (${#TOKEN} chars)" || fail "no jwt in token output"
note "token: ${TOKEN:0:50}..."

# ---------------------------------------------------------------------------
section "2. start (detached) — SDK door enabled so example can connect"
cd "$W"
$AG start --data-dir "$DD" --no-mcp --port-sdk 7350 --dashboard-port 7200 > "$W/start.out" 2>&1
note "start rc=$?"; cat "$W/start.out" | tee -a "$LOG"
sleep 5
L="$(ports | grep -E ':(7300|7350|7200)\b' | awk '{print $4}' | sort -u | tee -a "$LOG")"
echo "$L" | grep -q 7350 && pass "SDK door 7350 listening" || fail "SDK door 7350 NOT listening"
echo "$L" | grep -q 7300 && pass "WS door 7300 listening"  || fail "WS door 7300 NOT listening"
echo "$L" | grep -q 7200 && pass "dashboard 7200 listening" || fail "dashboard 7200 NOT listening"

# Second start should refuse.
$AG start --data-dir "$DD" > "$W/start2.out" 2>&1; RC2=$?
[ $RC2 -ne 0 ] && pass "second start refused (rc=$RC2)" || fail "second start NOT refused"

# ---------------------------------------------------------------------------
section "3. remote commands on the consumer door (7300/ws)"
U=ws://127.0.0.1:7300/ws
timeout 8 $AG sessions --url "$U" --token "$TOKEN" > "$W/sessions.out" 2>&1 && pass "remote sessions" || fail "remote sessions"
cat "$W/sessions.out" | tee -a "$LOG"
timeout 8 $AG capabilities --url "$U" --token "$TOKEN" > "$W/caps.out" 2>&1 && pass "remote capabilities" || fail "remote capabilities"
note "cap count: $(grep -cE '^\{' "$W/caps.out" 2>/dev/null)"
timeout 8 $AG health --url "$U" --token "$TOKEN" > "$W/health.out" 2>&1 && pass "remote health" || fail "remote health"
cat "$W/health.out" | tee -a "$LOG"
timeout 8 $AG status --url "$U" --token "$TOKEN" > "$W/rstatus.out" 2>&1 && pass "remote status" || fail "remote status"
cat "$W/rstatus.out" | tee -a "$LOG"

# ---------------------------------------------------------------------------
section "3a. Q1: invoke without --session auto-mints (against empty registry)"
note "operator types: agentide invoke system.health --url $U --token ..."
timeout 8 $AG invoke system.health --args '{}' --url "$U" --token "$TOKEN" > "$W/inv.out" 2>&1 && pass "invoke system.health (no session, no example)" || fail "invoke system.health"
head -c 200 "$W/inv.out"; echo | tee -a "$LOG"

# ---------------------------------------------------------------------------
section "3b. Q2: --url with no port → defaults to 7300"
note "operator types: agentide health --url ws://127.0.0.1/ws (no port)"
timeout 8 $AG health --url "ws://127.0.0.1/ws" --token "$TOKEN" > "$W/noport.out" 2>&1 && pass "default port 7300 applied" || fail "default port 7300 applied"
cat "$W/noport.out" | tee -a "$LOG"

# ---------------------------------------------------------------------------
section "3c. Q2: --url pointed at SDK door (7350) → clear wrong-door error"
note "operator types: agentide sessions --url ws://127.0.0.1:7350/ws (SDK door)"
OUT=$(timeout 6 $AG sessions --url "ws://127.0.0.1:7350/ws" --token "$TOKEN" 2>&1); RC=$?
echo "$OUT" | tee -a "$LOG"
[ $RC -eq 2 ] && pass "wrong-door exits 2" || fail "wrong-door exits 2 (got rc=$RC)"
echo "$OUT" | grep -q "SDK door"          && pass "wrong-door mentions SDK door"          || fail "wrong-door mentions SDK door"
echo "$OUT" | grep -q "websocket adapter" && pass "wrong-door mentions websocket adapter" || fail "wrong-door mentions websocket adapter"

# ---------------------------------------------------------------------------
section "4. example app (own instance, fresh token, port 3001)"
EXAMPLE_TOKEN=$(timeout 5 $AG token issue --tenant acme --caller nest-app --scope '*' --data-dir "$DD" 2>&1 | jwt_of /dev/stdin)
[ -n "$EXAMPLE_TOKEN" ] && pass "example token minted" || fail "example token mint"
cd "$EXAMPLE"
PORT=3001 PLATFORM_GATEWAY_URL=ws://127.0.0.1:7350 PLATFORM_TOKEN="$EXAMPLE_TOKEN" node dist/main.js > "$W/nest.log" 2>&1 &
NEST_PID=$!
sleep 8
if kill -0 $NEST_PID 2>/dev/null; then pass "example alive (pid $NEST_PID)"; else fail "example died"; tail -20 "$W/nest.log"; fi
grep -E "Registered|connect failed" "$W/nest.log" | head -4 | tee -a "$LOG"
curl -sf http://127.0.0.1:3001/products > "$W/rest.out" 2>&1 && { pass "REST :3001/products"; head -c 150 "$W/rest.out"; echo; } || fail "REST :3001/products"

# ---------------------------------------------------------------------------
section "4a. Q1 + Q3: invoke business caps via auto-minted session"
timeout 8 $AG capabilities --url "$U" --token "$TOKEN" > "$W/caps2.out" 2>&1
note "example caps visible: $(grep -cE 'product\.|user\.|cart\.|order\.' "$W/caps2.out" 2>/dev/null)"
if grep -qE 'product\.(list|create)' "$W/caps2.out"; then pass "example caps registered via SDK"; else fail "example caps NOT in registry"; fi

# Invoke product.list (auto-mints session; no --session flag).
timeout 10 $AG invoke product.list --args '{}' --url "$U" --token "$TOKEN" > "$W/inv-list.out" 2>&1 && pass "invoke product.list (auto-mint)" || fail "invoke product.list"
head -c 250 "$W/inv-list.out"; echo | tee -a "$LOG"

# Invoke product.create (auto-mint; writes to MongoDB). Use timestamped SKU.
SKU="HAM-$(date +%s)"
timeout 10 $AG invoke product.create --args "{\"sku\":\"$SKU\",\"name\":\"Hammer\",\"priceCents\":1999}" --url "$U" --token "$TOKEN" > "$W/inv-create.out" 2>&1 && pass "invoke product.create" || fail "invoke product.create"
head -c 250 "$W/inv-create.out"; echo | tee -a "$LOG"

# Invoke user.register (writes to MongoDB). Use timestamped email.
EMAIL="e2e-$(date +%s)@example.com"
timeout 10 $AG invoke user.register --args "{\"email\":\"$EMAIL\",\"password\":\"s3cret\",\"name\":\"E2E User\"}" --url "$U" --token "$TOKEN" > "$W/inv-user.out" 2>&1 && pass "invoke user.register" || fail "invoke user.register"
head -c 250 "$W/inv-user.out"; echo | tee -a "$LOG"

# ---------------------------------------------------------------------------
section "4b. Q3: watch lifecycle (snapshot + auto-mint, then SIGINT)"
timeout 6 $AG watch sessions --url "$U" --token "$TOKEN" --json > "$W/watch.out" 2>&1 || true
head -10 "$W/watch.out" | tee -a "$LOG"
grep -q '"id"' "$W/watch.out" && pass "watch snapshot printed" || fail "watch snapshot printed"

# ---------------------------------------------------------------------------
section "4c. Q1 (Scenario 2): --session supplied reuses id, no auto-mint"
# Batch workflow: the operator owns the session. The CLI must NOT auto-mint.
# We mint a session manually, then invoke with --session=<that id>, and
# verify the manual session is still active (the CLI did NOT destroy it).
MANUAL=$(timeout 6 $AG invoke session.create --args '{"ownerId":"manual-cli-test","adapterType":"cli"}' --url "$U" --token "$TOKEN" 2>&1 | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
[ -n "$MANUAL" ] && pass "manual session.create → id=$MANUAL" || fail "manual session.create"
# Invoke with --session=$MANUAL — must NOT mint or destroy.
timeout 10 $AG invoke product.list --args '{}' --session "$MANUAL" --url "$U" --token "$TOKEN" > "$W/inv-batch.out" 2>&1 && pass "invoke with --session (batch)" || fail "invoke with --session (batch)"
head -c 200 "$W/inv-batch.out"; echo | tee -a "$LOG"
# The manual session should still be active (not destroyed by the CLI).
timeout 6 $AG sessions --url "$U" --token "$TOKEN" --json 2>/dev/null > "$W/sess-after.out"
if grep -q "$MANUAL" "$W/sess-after.out"; then
  pass "manual session still in list (not destroyed by CLI)"
else
  fail "manual session missing from list (CLI may have destroyed it)"
fi
# Cleanup: explicitly destroy the manual session.
timeout 6 $AG invoke session.destroy --args "{\"sessionId\":\"$MANUAL\"}" --session "$MANUAL" --url "$U" --token "$TOKEN" >/dev/null 2>&1 && pass "manual session.destroy" || fail "manual session.destroy"

# ---------------------------------------------------------------------------
section "5. dashboard"
curl -sf http://127.0.0.1:7200/ > "$W/dash.html" && pass "dashboard html" || fail "dashboard html"
wc -c "$W/dash.html" | tee -a "$LOG"
grep -o '<title>[^<]*</title>' "$W/dash.html" | tee -a "$LOG" || true
curl -sf http://127.0.0.1:7200/assets/app.js > "$W/app.js" && pass "app.js served" || fail "app.js missing"
SIZE=$(wc -c < "$W/app.js")
note "app.js size: $SIZE bytes"
[ "$SIZE" -gt 2000 ] && pass "app.js = real client" || fail "app.js = placeholder (known bug, <2KB)"
head -c 100 "$W/app.js" | tee -a "$LOG"; echo

# ---------------------------------------------------------------------------
section "6. stop"
$AG stop > "$W/stop.out" 2>&1; note "stop rc=$?"; cat "$W/stop.out" | tee -a "$LOG"
sleep 2
if ports | grep -qE ':(7300|7350|7200)\b'; then fail "ports still listening"; ports | grep -E ':(7300|7350|7200)\b'; else pass "all ports closed after stop"; fi

# ---------------------------------------------------------------------------
section "summary"
echo "PASS=$PASS FAIL=$FAIL" | tee -a "$LOG"
note "transcript: $LOG"
