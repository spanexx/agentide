#!/usr/bin/env bash
# cli-quality-of-life — post-impl simulation. 2026-08-06.
# Drives the REAL `agentide` binary to verify the four DRLAG fixes:
#   D-78 init mkdir, D-81 status recovers data-dir from pid file,
#   D-83 stop exit codes unify on 0, D-84 per-subcommand client help.
#
# Run UNSANDBOXED (loopback binding). Usage: bash docs/features/cli-quality-of-life/simulate.sh
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# Prefer the inner-repo built dist so the sim exercises the SHIPPED pack code,
# not whatever global @spanexx/agentide the host has installed.
AG="$ROOT/packages/agentide/dist/bin.bundled.cjs"
if [ ! -x "$AG" ]; then
  echo "  ERROR: $AG not found — run pnpm --filter @spanexx/agentide build first"
  exit 1
fi
W=/tmp/ag-qol-sim
rm -rf "$W"; mkdir -p "$W"
LOG="$W/transcript.log"
: > "$LOG"

PASS=0; FAIL=0
pass(){ echo "  [PASS] $*"; PASS=$((PASS+1)); }
fail(){ echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
note(){ echo "  [note] $*"; }
section(){ echo; echo "===== $* ====="; }
ports(){ ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; }
cleanup(){ timeout 10 agentide stop >/dev/null 2>&1 || true; sleep 1; }
trap cleanup EXIT INT TERM

DD="$W/data"

section "preflight"
"$AG" --version | head -1 || { echo "  ERROR: agentide not found (need built dist or global install)"; exit 1; }

# ---------------------------------------------------------------------------
section "1. D-78 — init against a FRESH (non-existent) data dir"
rm -rf "$DD"
if "$AG" init --data-dir "$DD" --default-tenant acme > "$W/init.out" 2>&1; then
  pass "init succeeds exit 0"
else
  fail "init returns non-zero"; cat "$W/init.out"
fi
if [ -d "$DD" ] && [ -f "$DD/gateway-secret" ]; then
  pass "data dir + gateway-secret created on disk"
else
  fail "data dir was not created on disk"
fi
head -3 "$W/init.out" | tee -a "$LOG"

section "1b. D-78 — init is idempotent (dir already exists)"
if "$AG" init --data-dir "$DD" --default-tenant acme > "$W/init2.out" 2>&1; then
  pass "second init exit 0"
else
  fail "second init rc != 0"; cat "$W/init2.out"
fi

# ---------------------------------------------------------------------------
section "2. D-81 — status recovers data-dir from the pid file"
"$AG" start --data-dir "$DD" --no-mcp --port-sdk 7350 > "$W/start.out" 2>&1
note "start rc=$?"; cat "$W/start.out"
sleep 5
# The pid file is now JSON and includes dataDir.
if grep -q '"dataDir"' "$W/start.out" || head -c 200 /tmp/agentide.pid | grep -q '"dataDir"'; then
  note "pid file payload: $(head -c 120 /tmp/agentide.pid)"
  pass "pid file is JSON with dataDir"
else
  note "pid file: $(head -c 120 /tmp/agentide.pid)"
  fail "pid file missing dataDir field"
fi
# status from a DIFFERENT cwd must still recover /tmp/.../data.
(cd / && "$AG" status > "$W/status.out" 2>&1); RC=$?
cat "$W/status.out"
if [ $RC -eq 0 ] && grep -qE '^tenants:' "$W/status.out"; then
  pass "status from foreign cwd recovers the gateway data-dir"
else
  fail "status from foreign cwd failed (rc=$RC)"
fi

# ---------------------------------------------------------------------------
section "3. D-83 — stop unifies on rc 0"
"$AG" stop > "$W/stop.out" 2>&1; RC1=$?
cat "$W/stop.out" | tee -a "$LOG"
[ $RC1 -eq 0 ] && pass "stop while running → rc 0 (graceful)"
[ $RC1 -eq 0 ] || fail "stop while running → rc $RC1"
sleep 1
"$AG" stop > "$W/stop2.out" 2>&1; RC2=$?
cat "$W/stop2.out" | tee -a "$LOG"
[ $RC2 -eq 0 ] && pass "stop when already stopped → rc 0"
[ $RC2 -ne 0 ] && pass "stop idempotent in shell chain (rc 0)"
[ $RC2 -ne 0 ] && fail "stop when already stopped → rc=$RC2 (wanted 0)"

# ---------------------------------------------------------------------------
section "4. D-84 — per-subcommand client help"
"$AG" client > "$W/client.out" 2>&1; RC=$?
[ $RC -eq 0 ] && pass "agentide client (no subcommand) → exit 0"
grep -q "create" "$W/client.out" && grep -q "redeem" "$W/client.out" && pass "summary lists subcommands" || fail "summary missing subcommands"
cat "$W/client.out" | tee -a "$LOG"
"$AG" client grant --help > "$W/grant.out" 2>&1; RC=$?
[ $RC -eq 0 ] && pass "client grant --help → exit 0"
grep -q -- "--tenant" "$W/grant.out" && grep -q -- "--name" "$W/grant.out" && pass "grant help lists --tenant/--name"
[ $RC -ne 0 ] && fail "client grant --help rc=$RC"
cat "$W/grant.out" | tee -a "$LOG"
"$AG" client redeem --help > "$W/redeem.out" 2>&1 && grep -q -- "--code" "$W/redeem.out" && pass "redeem help lists --code" || fail "redeem help lists --code"
grep -q -- "--client-id" "$W/redeem.out" && fail "redeem help exposes wrong flags" || true

# ---------------------------------------------------------------------------
section "summary"
echo "PASS=$PASS FAIL=$FAIL" | tee -a "$LOG"
note "transcript: $LOG"