#!/usr/bin/env bash
# PRE-IMPL simulation — agentide-cli-consumer (BI[28]).
#
# Runs BEFORE any implementation. Mirrors the DESIGN with hardcoded state:
# every command below is a stub showing the SHAPE of the feature — tables,
# key:value, pretty/compact JSON, NDJSON watch stream, exit codes 0-5.
# No real gateway, no real binary. The design direction is already locked in
# GRILL-agentide-cli-consumer.txt Q1-Q5; this sim exists so the operator can
# poke at the shape and confirm nothing surprises them.
#
# Scenarios map 1:1 to PRD-TRD Behavioral Spec S1-S8 + the 12-command
# Simulation Contract. Writes docs/features/agentide-cli-consumer/sim-state.json
# (interconnected-simulation convention; post-impl sim will overwrite it).
#
# Usage:
#   bash docs/features/agentide-cli-consumer/simulate-pre.sh        # run all
#   bash docs/features/agentide-cli-consumer/simulate-pre.sh -i     # interactive
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STATE="$ROOT/docs/features/agentide-cli-consumer/sim-state.json"
URL="ws://127.0.0.1:7300/ws"
INTERACTIVE="${1:-}"
PASS=0; FAIL=0
RESULTS=()

# ---- hardcoded fixture state (the locked design's "what a gateway would say") ----
CAPS='[
  {"name":"gateway.status","version":"1.0.0","tier":"read","owner":"gateway-core"},
  {"name":"session.list","version":"1.0.0","tier":"read","owner":"session-manager"},
  {"name":"session.create","version":"1.0.0","tier":"write","owner":"session-manager"},
  {"name":"plugin.list","version":"1.0.0","tier":"read","owner":"plugin-manager"},
  {"name":"product.list","version":"2.1.0","tier":"read","owner":"backend-sdk-nest"},
  {"name":"system.health","version":"1.0.0","tier":"read","owner":"gateway-core"}
]'
SESSIONS='[
  {"id":"s-1","status":"active","createdAt":1700000000000},
  {"id":"s-2","status":"active","createdAt":1699900000000}
]'
PLUGINS='[
  {"id":"core","version":"0.1.0","status":"enabled"},
  {"id":"billing","version":"2.0.0","status":"enabled"}
]'

# ---- renderers (shape-only; real logic lands in output.ts) ----
table() { # cols: name|version|tier rows: "name|version|tier"...
  local header="$1"; shift
  printf '%b\n' "$header"
  for row in "$@"; do printf '%b\n' "$row"; done
}
keyvalue() { # key=value...
  for kv in "$@"; do printf '%s\n' "$kv"; done
}
pretty_json() { echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"; }
compact_json() { echo "$1" | tr -d ' \n' ; echo; }

# ---- scenario runner ----
# run <name> <expected_exit> <argv...> — argv is the exact PRD sim command
run() {
  local name="$1" want="$2"; shift 2
  local code=0 out="" err=""
  echo ""
  echo "── $name"
  printf '   $ agentide %s\n' "$*"
  # each scenario handler fills out/err/code (stub behavior below)
  # shellcheck disable=SC2317
  # (no-op; handlers run inline after this function returns — see scenarios)
  return 0
}

# -------- SCENARIO HANDLERS (stub "what the real CLI will do") --------
sim_in_process_status() {
  out=$(keyvalue "tenants: 1" "plugins: 0" "audit log: 4096 bytes" "uptime: 3ms")
  code=0
}
sim_in_process_capability_list() {
  out=$(table "NAME\tVERSION\tTIER" \
    "gateway.status\t1.0.0\tread" \
    "session.list\t1.0.0\tread" \
    "session.create\t1.0.0\twrite" \
    "plugin.list\t1.0.0\tread" \
    "product.list\t2.1.0\tread" \
    "system.health\t1.0.0\tread")
  code=0
}
sim_remote_capability_list() {
  out=$(table "NAME\tVERSION\tTIER" \
    "gateway.status\t1.0.0\tread" \
    "session.list\t1.0.0\tread" \
    "session.create\t1.0.0\twrite" \
    "plugin.list\t1.0.0\tread" \
    "product.list\t2.1.0\tread" \
    "system.health\t1.0.0\tread")
  code=0
}
sim_sessions() {
  out=$(table "ID\tSTATUS\tCREATED" \
    "s-1\tactive\t1700000000000" \
    "s-2\tactive\t1699900000000")
  code=0
}
sim_invoke_gateway_status() {
  out=$(pretty_json '{"status":"ok","uptimeMs":42000,"tenantCount":1,"pluginCount":0}')
  code=0
}
sim_invoke_product_list() {
  out=$(pretty_json '{"products":[{"id":"p-1","name":"Widget","price":9.99},{"id":"p-2","name":"Gadget","price":19.99}]}')
  code=0
}
sim_sessions_json() {
  out=$(compact_json "$SESSIONS")
  code=0
}
sim_watch_sessions() {
  # shape: snapshot once, then NDJSON events until Ctrl-C (exit 5)
  printf '   (snapshot)\n'
  echo "$SESSIONS" | compact_json
  printf '   (subscribed session.* — streaming NDJSON, Ctrl-C to stop)\n'
  sleep 1
  echo '{"type":"event","topic":"session.created","id":"ev-1","publishedAt":1700000001000,"payload":{"sessionId":"s-3"}}'
  sleep 1
  echo '{"type":"event","topic":"session.updated","id":"ev-2","publishedAt":1700000002000,"payload":{"sessionId":"s-1","status":"suspended"}}'
  if [ "$INTERACTIVE" = "-i" ]; then
    printf '   (interactive: Ctrl-C → exit 5)\n'
    while :; do sleep 0.2; done
  fi
  printf '   (SIGINT received → exit 5)\n'
  code=5
}
sim_bad_token() {
  err="error: auth.error — token rejected (close 1008)"
  code=4
}
sim_missing_token_file() {
  err="error: token file not found: /tmp/nope.jwt"
  code=2
}
sim_no_url() {
  err="error: gateway URL required (--url, PLATFORM_GATEWAY_URL, or config file)"
  code=2
}
sim_tls_fail() {
  err="error: TLS handshake failed"
  code=3
}
sim_config_warn() {
  out=$(keyvalue "tenants: 1" "plugins: 0" "audit log: 4096 bytes" "uptime: 3ms")
  err="warning: /tmp/agentide-cfg.toml is group/world-readable — consider chmod 600"
  code=0
}

# -------- the 12 PRD Simulation Contract commands --------
echo "== agentide-cli-consumer PRE-IMPL sim — shape of the feature (stubs) =="
echo "   design locked: GRILL Q1-Q5 · no real gateway · no real binary"
if [ "$INTERACTIVE" = "-i" ]; then
  echo ""
  echo "interactive: pick a scenario (enter number), Ctrl-C to exit"
  echo "  1  in-process status     5  invoke gateway.status   9  bad token → 4"
  echo "  2  in-process caps       6  invoke product.list    10  missing token file → 2"
  echo "  3  remote caps           7  --json sessions        11  no URL non-TTY → 2"
  echo "  4  sessions              8  --watch sessions       12  wss:// TLS → 3"
  echo " 13  config 0644 warning   0  run all"
  while :; do
    printf '> '; read -r choice || break
    case "$choice" in
      1) sim_in_process_status ;;
      2) sim_in_process_capability_list ;;
      3) sim_remote_capability_list ;;
      4) sim_sessions ;;
      5) sim_invoke_gateway_status ;;
      6) sim_invoke_product_list ;;
      7) sim_sessions_json ;;
      8) sim_watch_sessions ;;
      9) sim_bad_token ;;
      10) sim_missing_token_file ;;
      11) sim_no_url ;;
      12) sim_tls_fail ;;
      13) sim_config_warn ;;
      0) INTERACTIVE=""; break ;;
      *) continue ;;
    esac
    [ -n "$out" ] && echo "$out" | sed 's/^/   /'
    [ -n "$err" ] && echo "$err" | sed 's/^/   err: /'
    echo "   → exit $code"
    out=""; err=""
  done
  [ -n "$INTERACTIVE" ] && exit 0
fi

# run-all: each scenario asserts the locked expected exit code
check() { # name want code
  local name="$1" want="$2" got="$3"
  if [ "$got" -eq "$want" ]; then
    echo "ok:   $name (exit $got)"; PASS=$((PASS+1))
    RESULTS+=("{\"name\":\"$name\",\"expectedExit\":$want,\"exit\":$got,\"ok\":true}")
  else
    echo "FAIL: $name (want $want got $got)"; FAIL=$((FAIL+1))
    RESULTS+=("{\"name\":\"$name\",\"expectedExit\":$want,\"exit\":$got,\"ok\":false}")
  fi
}

out=""; err=""
sim_in_process_status;     check "in-process status (S1/S3 key:value)" 0 "$code"
echo "$out" | sed 's/^/   /'; [ -n "$err" ] && echo "$err" | sed 's/^/   err: /'
out=""; err=""
sim_in_process_capability_list; check "in-process capability list (table)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_remote_capability_list; check "remote capability list (S2 alias→cap)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_sessions; check "sessions alias (S2 session.list)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_invoke_gateway_status; check "invoke gateway.status (S4 pretty JSON)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_invoke_product_list; check "invoke product.list (business cap)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_sessions_json; check "sessions --json (S3 compact)" 0 "$code"
echo "$out" | sed 's/^/   /'
out=""; err=""
sim_watch_sessions > /dev/null 2>&1; check "watch sessions (S7 NDJSON → Ctrl-C=5)" 5 "$code"
out=""; err=""
sim_bad_token; check "bad.jwt (S5 exit 4)" 4 "$code"; echo "$err" | sed 's/^/   err: /'
out=""; err=""
sim_missing_token_file; check "path:/nope.jwt (S1 exit 2)" 2 "$code"; echo "$err" | sed 's/^/   err: /'
out=""; err=""
sim_no_url; check "no URL non-TTY (S1 exit 2)" 2 "$code"; echo "$err" | sed 's/^/   err: /'
out=""; err=""
sim_tls_fail; check "wss:// TLS (S5 exit 3)" 3 "$code"; echo "$err" | sed 's/^/   err: /'
out=""; err=""
sim_config_warn; check "config 0644 (S6 one warning)" 0 "$code"
echo "$out" | sed 's/^/   /'; echo "$err" | sed 's/^/   err: /'

# ---- write sim-state.json (interconnected convention) ----
{
  echo "{"
  echo "  \"updated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"stage\": \"pre-impl\","
  echo "  \"binary\": \"packages/agentide/dist/bin.js (not built yet)\","
  echo "  \"backend\": \"hardcoded stubs (design shape)\","
  echo "  \"pass\": $PASS, \"fail\": $FAIL,"
  echo "  \"scenarios\": ["
  i=0
  for r in "${RESULTS[@]}"; do
    [ "$i" -gt 0 ] && echo "    ,"
    echo "    $r"; i=$((i+1))
  done
  echo "  ]"
  echo "}"
} > "$STATE"

echo ""
echo "== result: $PASS pass, $FAIL fail (design stubs — expected all ok) =="
echo "   state: $STATE"
[ "$FAIL" -eq 0 ]
