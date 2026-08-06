#!/usr/bin/env bash
# agentide v0.3.1 — end-to-end test vs example app. 2026-08-06 round 3.
# Robust: per-command timeout, EXIT/INT trap cleanup, no process substitution.
set -u
export PATH="/home/spanexx/.npm-global/bin:$PATH"
W=/tmp/ag-e2e
rm -rf "$W"; mkdir -p "$W"
LOG="$W/transcript.log"
: > "$LOG"
PASS=0; FAIL=0
pass(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
fail(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
note(){ echo "  [note] $*"; }
section(){ echo ""; echo "===== $* ====="; }
ports(){ ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; }
jwt(){ grep -oE 'eyJ[A-Za-z0-9_.-]+' "$1" | head -1; }
T=15
ag(){ timeout "$T" agentide "$@"; }

NEST_PID=""
cleanup(){
  echo ""
  echo "--- cleanup (trap) ---"
  if [ -n "$NEST_PID" ] && kill -0 "$NEST_PID" 2>/dev/null; then
    kill "$NEST_PID" 2>/dev/null || true
    wait "$NEST_PID" 2>/dev/null || true
  fi
  if [ -f /tmp/agentide.pid ]; then
    timeout 10 agentide stop >/dev/null 2>&1 || true
  fi
  sleep 1
  ports | grep -qE ':(7200|7300|7350)\b' && echo "gateway still listening — killing by pid file" || echo "gateway stopped"
  [ -n "$NEST_PID" ] && pgrep -laf "node dist/main.js" | head -3 || true
}
trap cleanup EXIT INT TERM

DD="$W/data"
U=ws://127.0.0.1:7350/ws

# tee everything to LOG via a line-by-line trick: use a FIFO.
# Simpler: append to LOG inline with small `>> "$LOG"` after each block.
# We'll tee only at the END for the transcript.
run() {
  echo "+ $*" >> "$LOG"
  "$@"
}

section "0. env sanity"
(node --version; agentide --version) | tee -a "$LOG"
(timeout 2 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/27017' 2>/dev/null) && note "mongo:27017 OPEN" || note "mongo:27017 closed"
(timeout 2 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/6379' 2>/dev/null) && note "redis:6379 OPEN" || note "redis:6379 closed"

section "1. version / help"
ag --version >/dev/null 2>&1 && pass "version" || fail "version"
ag --help >/dev/null 2>&1 && pass "help" || fail "help"
ag >/dev/null 2>&1; note "bare agentide rc=$?"

section "1a. KNOWN-ISSUE CHECK: init into fresh (missing) data dir"
rm -rf "$DD"
ag init --data-dir "$DD" --default-tenant acme > "$W/init-fresh.out" 2>&1
note "rc=$? (documented issue 1: init does not create the dir)"; head -3 "$W/init-fresh.out" | tee -a "$LOG"

section "2. init + local commands (workaround: pre-create dir)"
mkdir -p "$DD"
ag init --data-dir "$DD" --default-tenant acme --default-tenant-name "Acme" > "$W/init.out" 2>&1 && pass "init (dir pre-created)" || fail "init"
head -3 "$W/init.out" | tee -a "$LOG"
ag tenant list --data-dir "$DD" > "$W/tenants.out" 2>&1 && pass "tenant list" || fail "tenant list"
cat "$W/tenants.out" | tee -a "$LOG"
ag tenant create --id t2 --name "Tenant 2" --data-dir "$DD" > "$W/t2.out" 2>&1 && pass "tenant create" || fail "tenant create"
head -2 "$W/t2.out" | tee -a "$LOG"
ag token issue --tenant acme --caller cli-e2e --scope '*' --data-dir "$DD" > "$W/token.out" 2>&1 && pass "token issue" || fail "token issue"
TOKEN=$(jwt "$W/token.out")
[ -n "$TOKEN" ] && pass "token minted (${#TOKEN} chars)" || fail "no jwt in token output"
echo "$TOKEN" | head -c 50 | tee -a "$LOG"; echo
ag client create --tenant acme --name "CLI tester" --scope '*' --data-dir "$DD" > "$W/client.out" 2>&1 && pass "client create" || fail "client create"
CLIENT_ID=$(grep -oE 'cli_[a-z0-9]+' "$W/client.out" | head -1)
note "client id: ${CLIENT_ID:-unknown}"
ag client list --tenant acme --data-dir "$DD" > "$W/clients.out" 2>&1 && pass "client list" || fail "client list"
cat "$W/clients.out" | tee -a "$LOG"
ag client grant --client-id "$CLIENT_ID" --scope 'acme:*' --data-dir "$DD" > "$W/grant.out" 2>&1 && pass "client grant" || { fail "client grant"; cat "$W/grant.out"; }
RC_CODE=$(grep -oE 'rc_[A-Za-z0-9]+' "$W/grant.out" | head -1)
note "grant rc code: ${RC_CODE:-none}"
[ -n "$RC_CODE" ] && { ag client redeem --code "$RC_CODE" --data-dir "$DD" > "$W/redeem.out" 2>&1 && pass "client redeem" || fail "client redeem"; head -2 "$W/redeem.out" | tee -a "$LOG"; }
ag capability list --data-dir "$DD" > "$W/caps.out" 2>&1 && pass "capability list" || fail "capability list"
note "cap count: $(grep -cE '^[a-z]' "$W/caps.out" 2>/dev/null || echo 0)"
ag plugin list --data-dir "$DD" > "$W/plugs.out" 2>&1 && pass "plugin list" || fail "plugin list"
cat "$W/plugs.out" | tee -a "$LOG"

section "2a. remote command with gateway DOWN (error-path check)"
ag sessions --url "$U" --token "$TOKEN" > "$W/down.out" 2>&1; note "rc=$?"; head -2 "$W/down.out" | tee -a "$LOG"

section "3. start (detached) — set up gateway with SDK door enabled"
cd "$W"
agentide start --data-dir "$DD" --no-mcp --port-sdk 7350 --dashboard-port 7200 > "$W/start.out" 2>&1
note "start rc=$?"; cat "$W/start.out" | tee -a "$LOG"
sleep 5
L="$(ports | grep -E ':(7300|7350|7200)\b' | awk '{print $4}' | sort -u | tee -a "$LOG")"
echo "$L" | grep -q 7350 && pass "SDK door 7350 listening" || fail "SDK door 7350 NOT listening"
echo "$L" | grep -q 7300 && pass "WS door 7300 listening" || fail "WS door 7300 NOT listening"
echo "$L" | grep -q 7200 && pass "dashboard 7200 listening" || fail "dashboard 7200 NOT listening"
[ -d "$W/.agentide/data" ] && fail "--data-directory dropped - default relative dir created" || pass "no default relative data dir created"
agentide start --data-dir "$DD" > "$W/start2.out" 2>&1; RC2=$?
[ $RC2 -ne 0 ] && pass "second start refused (rc=$RC2)" || fail "second start NOT refused"
cat "$W/start2.out" | tee -a "$LOG"
agentide status > "$W/status.out" 2>&1; note "status rc=$? (no --data-dir, uses default cwd)"; head -2 "$W/status.out" | tee -a "$LOG"
agentide status --data-dir "$DD" > "$W/status-dd.out" 2>&1; note "status --data-dir rc=$?"; head -2 "$W/status-dd.out" | tee -a "$LOG"

section "4. remote commands (gateway up)"
ag sessions --url "$U" --token "$TOKEN" > "$W/sessions.out" 2>&1 && pass "remote sessions" || fail "remote sessions"
cat "$W/sessions.out" | tee -a "$LOG"
ag capabilities --url "$U" --token "$TOKEN" > "$W/rcaps.out" 2>&1 && pass "remote capabilities" || fail "remote capabilities"
cat "$W/rcaps.out" | tee -a "$LOG"
ag plugins --url "$U" --token "$TOKEN" > "$W/rplugs.out" 2>&1 && pass "remote plugins" || fail "remote plugins"
cat "$W/rplugs.out" | tee -a "$LOG"
ag health --url "$U" --token "$TOKEN" > "$W/health.out" 2>&1 && pass "remote health" || fail "remote health"
cat "$W/health.out" | tee -a "$LOG"
ag status --url "$U" --token "$TOKEN" > "$W/rstatus.out" 2>&1 && pass "remote status" || fail "remote status"
cat "$W/rstatus.out" | tee -a "$LOG"

section "5. example app (own instance, PORT=3001, fresh token)"
EXPIRE_TOKEN=$(ag token issue --tenant acme --caller nest-app --scope '*' --data-dir "$DD" | jwt -)
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/example
PORT=3001 PLATFORM_GATEWAY_URL="ws://127.0.0.1:7350" PLATFORM_TOKEN="$EXPIRE_TOKEN" node dist/main.js > "$W/nest.log" 2>&1 &
NEST_PID=$!
sleep 8
if kill -0 $NEST_PID 2>/dev/null; then pass "nest app alive (pid $NEST_PID)"; else fail "nest app died"; fi
grep -E "Registered|connect failed" "$W/nest.log" | head -4 | tee -a "$LOG"
curl -sf http://127.0.0.1:3001/products > "$W/rest.out" 2>&1 && { pass "REST :3001/products"; head -c 200 "$W/rest.out"; echo; } || fail "REST :3001/products unreachable"
ag capabilities --url "$U" --token "$TOKEN" > "$W/caps2.out" 2>&1
note "example caps visible: $(grep -c 'nestjs-ecommerce\|product.list' "$W/caps2.out" 2>/dev/null)"
if grep -q 'product.list' "$W/caps2.out"; then pass "example caps registered via SDK"; else fail "example caps NOT in registry"; fi

section "6. invoke business flow"
invoke(){ local desc="$1" cap="$2" args="$3"
  agentide invoke "$cap" --args "$args" --url "$U" --token "$TOKEN" > "$W/inv.out" 2>&1
  if [ $? -eq 0 ] && grep -qE '"(id|data|result|ok|items)"' "$W/inv.out"; then pass "invoke $desc"; else fail "invoke $desc"; fi
  head -c 250 "$W/inv.out"; echo; }
invoke "product.list" product.list '{}'
invoke "product.create" product.create '{"sku":"HAM-1","name":"Hammer","priceCents":1999}'
PROD_ID=$(grep -oE '"id":"[a-zA-Z0-9]+"' "$W/inv.out" | head -1 | cut -d'"' -f4)
invoke "product.list again" product.list '{}'
invoke "user.register" user.register '{"email":"alice3@example.com","password":"s3cret","name":"Alice"}'
USER_ID=$(grep -oE '"id":"[a-zA-Z0-9]+"' "$W/inv.out" | head -1 | cut -d'"' -f4)
note "PROD_ID=$PROD_ID USER_ID=$USER_ID"
invoke "cart.add"    cart.add    "{\"userId\":\"$USER_ID\",\"productId\":\"$PROD_ID\",\"qty\":2}"
invoke "cart.view"   cart.view   "{\"userId\":\"$USER_ID\"}"
invoke "order.create" order.create "{\"userId\":\"$USER_ID\"}"
invoke "order.list"   order.list   "{\"userId\":\"$USER_ID\"}"

section "7. watch (event stream, bounded 6s)"
( timeout 6 agentide watch capabilities --topic '*.list' --url "$U" --token "$TOKEN" > "$W/watch.out" 2>&1 & )
sleep 1
agentide invoke product.list --args '{}' --url "$U" --token "$TOKEN" >/dev/null 2>&1
sleep 5
head -10 "$W/watch.out" | tee -a "$LOG"
grep -q "product.list" "$W/watch.out" && pass "watch captured event" || fail "watch captured nothing in 6s"

section "8. dashboard"
curl -sf http://127.0.0.1:7200/ > "$W/dash.html" && pass "dashboard html" || fail "dashboard html"
wc -c "$W/dash.html" | tee -a "$LOG"
grep -o '<title>[^<]*</title>' "$W/dash.html" | tee -a "$LOG"
curl -sf http://127.0.0.1:7200/assets/app.js > "$W/app.js" && pass "app.js served" || fail "app.js missing"
SIZE=$(wc -c < "$W/app.js")
note "app.js size: $SIZE bytes"
[ "$SIZE" -gt 2000 ] && pass "app.js = real client" || fail "app.js = placeholder (known bug, <2KB)"
head -c 150 "$W/app.js" | tee -a "$LOG"; echo

section "9. stop"
agentide stop > "$W/stop.out" 2>&1; note "stop rc=$?"; cat "$W/stop.out" | tee -a "$LOG"
sleep 2
if ports | grep -qE ':(7300|7350|7200)\b'; then fail "ports still listening"; ports | grep -E ':(7300|7350|7200)\b'; else pass "all ports closed"; fi
agentide stop > "$W/stop2.out" 2>&1; note "second stop rc=$?"; cat "$W/stop2.out" | tee -a "$LOG"

section "10. summary"
echo "PASS=$PASS FAIL=$FAIL" | tee -a "$LOG"
note "log: $LOG"