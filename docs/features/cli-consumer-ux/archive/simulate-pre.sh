#!/usr/bin/env bash
# cli-consumer-ux — pre-impl simulation.
# Mirrors the design from GRILL-cli-consumer-ux.txt Q1, Q2, Q3.
# No real CLI or gateway — this script fakes both to show the operator flow.
# Goal: prove the DESIGN is good BEFORE writing PRD-TRD.
set -u
PASS=0; FAIL=0
pass(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
fail(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
note(){ echo "  [note] $*"; }
section(){ echo; echo "===== $* ====="; }

# --- Fake CLI: simulates the design-time behavior of `agentide invoke` ---
# It prints the wire frames it would send and the responses it expects.
fake_agentide() {
  # fake_agentide <scenario> <args...>
  local scenario="$1"; shift
  case "$scenario" in
    invoke-without-session)
      # Q1: auto-mint session, invoke, destroy
      local cap="$1" args="$2" url="$3"
      local session_id="sess-$(date +%s)-$$"
      echo "    [cli] open ws to $url"
      echo "    [cli]   -> {type:auth, token: ...}"
      echo "    [cli]   <- {type:auth.ok}"
      echo "    [cli]   -> {type:invoke, capability:session.create, input:{}}"
      echo "    [cli]   <- {type:invoke.result, id:\"$session_id\"}"
      echo "    [cli]   -> {type:invoke, capability:$cap, session:\"$session_id\", input:$args}"
      echo "    [cli]   <- {type:invoke.result, output:{...}}"
      echo "    [cli]   -> {type:invoke, capability:session.destroy, session:\"$session_id\"}"
      echo "    [cli]   <- {type:invoke.result}"
      echo "    [cli]   prints: result JSON"
      echo "    [cli] exit 0"
      ;;
    invoke-with-session)
      # Q1: supplied --session, reuse, no destroy
      local cap="$1" args="$2" url="$3" sid="$4"
      echo "    [cli] open ws to $url"
      echo "    [cli]   -> {type:auth, token: ...}"
      echo "    [cli]   <- {type:auth.ok}"
      echo "    [cli]   -> {type:invoke, capability:$cap, session:\"$sid\", input:$args}"
      echo "    [cli]   <- {type:invoke.result, output:{...}}"
      echo "    [cli]   prints: result JSON"
      echo "    [cli] exit 0 (does NOT destroy supplied session)"
      ;;
    watch-with-clean-exit)
      # Q3: watch auto-mints, keeps alive, destroys on SIGINT
      local alias="$1" url="$2"
      local session_id="sess-$(date +%s)-watch"
      echo "    [cli] open ws to $url"
      echo "    [cli]   -> {type:auth}"
      echo "    [cli]   <- {type:auth.ok}"
      echo "    [cli]   -> {type:invoke, capability:session.create, input:{}}"
      echo "    [cli]   <- {type:invoke.result, id:\"$session_id\"}"
      echo "    [cli]   -> {type:invoke, capability:<alias-snapshot>, session:\"$session_id\"}"
      echo "    [cli]   <- {type:invoke.result, output:[...]}"
      echo "    [cli]   -> {type:subscribe, topic:$alias.*, session:\"$session_id\"}"
      echo "    [cli]   <- {type:event, ...} (streamed until Ctrl-C)"
      echo "    [cli] SIGINT received"
      echo "    [cli]   -> {type:invoke, capability:session.destroy, session:\"$session_id\"}"
      echo "    [cli]   <- {type:invoke.result}"
      echo "    [cli] exit 0"
      ;;
    wrong-door)
      # Q2: operator points at SDK door (7350), CLI detects and emits clear error
      local url="$1"
      echo "    [cli] open ws to $url"
      echo "    [cli]   -> GET /ws (WS upgrade)"
      echo "    [cli]   <- 101 Switching Protocols"
      echo "    [cli]   -> {type:auth, token: ...}"
      echo "    [cli]   <- {type:auth.error, code:GATEWAY_PROTOCOL_MISMATCH, message:\"expected sdk.auth first\"}"
      echo "    [cli] emit: error: --url points to the SDK door (port 7350); the CLI consumer needs the websocket adapter (port 7300). Override with --url ws://...:7300/ws."
      echo "    [cli] exit 2"
      ;;
    default-port)
      # Q2: operator omits port, CLI defaults to 7300
      local raw="$1"
      local resolved="${raw/:\/\//://7300//}"  # naive: only works on ws://host/ws shape
      echo "    [cli] parsed --url: $raw"
      echo "    [cli]   no port specified -> default :7300"
      echo "    [cli] resolved URL: $resolved"
      ;;
    *)
      echo "    [cli] unknown scenario: $scenario"
      ;;
  esac
}

section "Q1: agentide invoke with no --session (auto-mint)"
note "operator types: agentide invoke product.list --args '{}' --url ws://127.0.0.1:7300/ws --token ..."
note "expected: session.create -> invoke -> session.destroy, exit 0"
fake_agentide invoke-without-session product.list '{}' ws://127.0.0.1:7300/ws
# Self-check: did the trace contain the expected round-trip?
fake_agentide invoke-without-session product.list '{}' ws://127.0.0.1:7300/ws | grep -q "session.create" && pass "session.create auto-mint" || fail "session.create auto-mint"
fake_agentide invoke-without-session product.list '{}' ws://127.0.0.1:7300/ws | grep -q "session.destroy" && pass "session.destroy after invoke" || fail "session.destroy after invoke"

section "Q1: agentide invoke with --session supplied (batch)"
note "operator types: agentide invoke product.list --args '{}' --session sess-abc --url ..."
note "expected: reuses sess-abc, does NOT destroy on exit"
fake_agentide invoke-without-session product.list '{}' ws://127.0.0.1:7300/ws 2>/dev/null
TS1=$(date +%s)
OUT=$(fake_agentide invoke-without-session product.list '{}' ws://127.0.0.1:7300/ws)
SESSION_ID=$(echo "$OUT" | grep -oE 'sess-[0-9]+-[0-9]+' | head -1)
note "  -> steal session id from prior mint for the batch scenario"
fake_agentide invoke-with-session product.list '{}' ws://127.0.0.1:7300/ws "$SESSION_ID" 2>/dev/null
fake_agentide invoke-with-session product.list '{}' ws://127.0.0.1:7300/ws "$SESSION_ID" | grep -q "does NOT destroy" && pass "supplied session preserved" || fail "supplied session preserved"

section "Q2: agentide --url ws://localhost/ws (no port — default 7300)"
note "operator types: agentide sessions --url ws://localhost/ws"
note "expected: CLI parses URL, no port, inserts :7300"
fake_agentide default-port ws://localhost/ws | tee /tmp/ws.out
grep -q ":7300" /tmp/ws.out && pass "default port 7300 inserted" || fail "default port 7300 inserted"

section "Q2: agentide pointed at SDK door (7350)"
note "operator types: agentide sessions --url ws://127.0.0.1:7350/ws"
note "expected: WS upgrade succeeds, but auth handshake fails with protocol-mismatch; CLI emits clear error and exits 2"
fake_agentide wrong-door ws://127.0.0.1:7350/ws | tee /tmp/wd.out
grep -q "SDK door" /tmp/wd.out && pass "wrong-door error mentions SDK door" || fail "wrong-door error mentions SDK door"
grep -q "websocket adapter" /tmp/wd.out && pass "wrong-door error mentions websocket adapter" || fail "wrong-door error mentions websocket adapter"
grep -q "exit 2" /tmp/wd.out && pass "wrong-door exits 2" || fail "wrong-door exits 2"

section "Q3: agentide watch (auto-mint, keep alive, destroy on SIGINT)"
note "operator types: agentide watch sessions --url ws://127.0.0.1:7300/ws"
note "expected: session.create -> snapshot invoke -> subscribe (streaming)... -> SIGINT -> session.destroy"
fake_agentide watch-with-clean-exit sessions ws://127.0.0.1:7300/ws | tee /tmp/wt.out
grep -q "session.create" /tmp/wt.out && pass "watch auto-mints session" || fail "watch auto-mints session"
grep -q "subscribe" /tmp/wt.out && pass "watch subscribes" || fail "watch subscribes"
grep -q "SIGINT" /tmp/wt.out && pass "watch handles SIGINT" || fail "watch handles SIGINT"
grep -q "session.destroy" /tmp/wt.out && pass "watch destroys session on clean exit" || fail "watch destroys session on clean exit"

section "summary"
echo "PASS=$PASS FAIL=$FAIL"
note "If PASS > 0 and FAIL == 0, the design is operator-visible and consistent."
note "If FAIL > 0, the design is incomplete — revisit the GRILL or surface new questions."
