#!/usr/bin/env bash
# Post-impl simulation — cli-adapter Phase 6 (PRD S7) reality check.
#
# Drives the REAL `platform` binary against the scripted mock W4 server
# (`crates/cli-adapter/examples/mock_wire.rs`), asserting the PRD Simulation
# Contract 1:1 (exit codes, output shapes, NDJSON events). Writes every
# scenario verdict to docs/features/cli-adapter/sim-state.json so sibling
# sims see the CLI's behavior (interconnected-simulation convention).
#
# Usage: bash docs/features/cli-adapter/simulate.sh
# Needs: cargo-built binary at crates/cli-adapter/target/debug/platform
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BIN="$ROOT/crates/cli-adapter/target/debug/platform"
MOCK="$ROOT/crates/cli-adapter/target/debug/examples/mock_wire"
STATE="$ROOT/docs/features/cli-adapter/sim-state.json"
URL="ws://127.0.0.1:7300/ws"
LOG=/tmp/cli-sim-mock.log
TMP=/tmp/cli-sim; mkdir -p "$TMP"

PASS=0; FAIL=0
RESULTS=()

# run <name> <expected_exit> <cmd...>
run() {
  local name="$1" want="$2"; shift 2
  local out err code
  timeout 10 "$@" > "$TMP/out.txt" 2> "$TMP/err.txt"; code=$?
  out=$(cat "$TMP/out.txt"); err=$(cat "$TMP/err.txt")
  RESULTS+=("$name|$want|$code|$(echo "$out" | tr '\n' '¶' | head -c 120)")
  if [ "$code" -eq "$want" ]; then
    echo "ok:   $name (exit $code)"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (want $want got $code)"; FAIL=$((FAIL+1))
  fi
  echo "$out" | sed 's/^/    /'
  [ -n "$err" ] && echo "$err" | sed 's/^/    err: /'
}

echo "== cli-adapter post-impl sim (Phase 6) — driving real binary =="
[ -x "$BIN" ] || { echo "missing $BIN — cargo build first"; exit 1; }
[ -x "$MOCK" ] || { echo "missing $MOCK — cargo build --example mock_wire"; exit 1; }

# mock up? (socket probe; fall back to starting our own)
MOCK_PID=
if ! (exec 3<>/dev/tcp/127.0.0.1/7300) 2>/dev/null; then
  "$MOCK" > "$LOG" 2>&1 & MOCK_PID=$!
  sleep 0.7
fi
trap '[ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null' EXIT

# S2/S3: tables + JSON
run "capabilities table" 0 "$BIN" --url "$URL" --token tok capabilities
run "sessions json" 0 "$BIN" --url "$URL" --token tok sessions --json
run "invoke pretty" 0 "$BIN" --url "$URL" --token tok invoke gateway.status

# S4: invoke.error passthrough → exit 1 (literal PRD Simulation Contract cmd)
run "invoke denied" 1 "$BIN" --url "$URL" --token tok invoke session.create --args '{}'

# S5: auth.error → exit 4
run "bad token" 4 "$BIN" --url "$URL" --token token.bad sessions

# S1/S6: missing token file → exit 2
run "missing token file" 2 "$BIN" --url "$URL" --token path:/tmp/cli-sim-nope.jwt status

# S1: no env/config, non-TTY → exit 2
env -i "$BIN" sessions < /dev/null >/dev/null 2>&1
[ $? -eq 2 ] && { echo "ok:   no config non-tty (exit 2)"; PASS=$((PASS+1)); } \
             || { echo "FAIL: no config non-tty (want 2 got $?)"; FAIL=$((FAIL+1)); }

# S5: wss:// TLS failure over reachable TCP → exit 3
run "wss tls fail" 3 "$BIN" --url wss://127.0.0.1:7300/ws --token tok status

# S7: watch — snapshot + NDJSON, SIGINT → exit 5
"$BIN" --url "$URL" --token tok status --watch > "$TMP/watch.txt" 2>/dev/null &
WPID=$!; sleep 2; kill -INT "$WPID" 2>/dev/null; wait "$WPID"; WC=$?
EVS=$(grep -c '"type":"event"' "$TMP/watch.txt" || true)
if [ "$WC" -eq 5 ] && [ "$EVS" -ge 2 ]; then
  echo "ok:   status --watch (exit 5, $EVS events)"; PASS=$((PASS+1))
else
  echo "FAIL: status --watch (exit $WC, $EVS events)"; FAIL=$((FAIL+1))
fi
RESULTS+=("status watch|5|$WC|events=$EVS")

# S7: --watch --json = pure JSON stream (compact snapshot + NDJSON)
"$BIN" --url "$URL" --token tok sessions --watch --json > "$TMP/wj.txt" 2>/dev/null &
WPID=$!; sleep 2; kill -INT "$WPID" 2>/dev/null; wait "$WPID"; WC=$?
if [ "$WC" -eq 5 ] && grep -q '"id":"s-1"' "$TMP/wj.txt" \
   && grep -q '"type":"event"' "$TMP/wj.txt"; then
  echo "ok:   sessions --watch --json (exit 5)"; PASS=$((PASS+1))
else
  echo "FAIL: sessions --watch --json (exit $WC)"; FAIL=$((FAIL+1))
fi
RESULTS+=("sessions watch json|5|$WC|s1+events")

# S6: config.toml 0644 → one stderr warning
CFG=/tmp/cli-sim-config.toml
printf "gateway_url = \"%s\"\ntoken = \"tok\"\n" "$URL" > "$CFG"; chmod 644 "$CFG"
WARN=$("$BIN" --config "$CFG" status 2>&1 >/dev/null | grep -c "world-readable" || true)
[ "$WARN" -eq 1 ] && { echo "ok:   config 0644 warns once"; PASS=$((PASS+1)); } \
                  || { echo "FAIL: config 0644 warn count $WARN"; FAIL=$((FAIL+1)); }

# shared state — sibling sims read this file
{
  echo "{"
  echo "  \"updated\": \"$(date -u +%FT%TZ)\","
  echo "  \"binary\": \"crates/cli-adapter/target/debug/platform\","
  echo "  \"backend\": \"mock_wire (locked W4 wire; real adapter lands with BI[24])\","
  echo "  \"pass\": $PASS, \"fail\": $FAIL,"
  echo "  \"scenarios\": ["
  first=1
  for r in "${RESULTS[@]}"; do
    [ $first -eq 0 ] && echo ","
    first=0
    IFS='|' read -r n w c o <<< "$r"
    printf '    {"name":"%s","expectedExit":%s,"exit":%s,"ok":%s,"outputTail":"%s"}' \
      "$n" "$w" "$c" "$([ "$c" -eq "$w" ] && echo true || echo false)" "$o"
  done
  echo ""
  echo "  ]"
  echo "}"
} > "$STATE"

echo ""
echo "== verdict: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
