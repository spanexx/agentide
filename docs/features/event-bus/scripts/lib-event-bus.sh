#!/usr/bin/env bash
# lib-event-bus.sh — Shared event bus library for interconnected simulations
# All sim scripts source this file. State lives in data/sim-state.json.

set -uo pipefail

# Walk up from this file until we find package.json (the repo root marker).
# Path: scripts/lib-event-bus.sh → ../.. → docs/features/event-bus → ../.. → docs/features → ../.. → <repo>
_resolve_sim_root() {
  local dir
  dir=$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}
SIM_ROOT="${SIM_ROOT:-$(_resolve_sim_root)}"
STATE_FILE="${SIM_STATE_FILE:-$SIM_ROOT/data/sim-state.json}"

JQ=$(command -v jq 2>/dev/null) || {
  echo "ERROR: jq required. Run: sudo apt install jq" >&2
  exit 1
}

# ── state helpers ────────────────────────────────────────────────────────────

state_get() {
  local key="$1"
  if [[ ! -f "$STATE_FILE" ]]; then echo ""; return; fi
  "$JQ" -r ".$key" "$STATE_FILE" 2>/dev/null || echo ""
}

state_set() {
  local key="$1" value="$2"
  local tmp="${STATE_FILE}.tmp.$$"
  [[ ! -f "$STATE_FILE" ]] && echo "{}" > "$STATE_FILE"
  "$JQ" --argjson v "$value" ".$key = \$v" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

state_mutate() {
  local jq_expr="$1"
  local tmp="${STATE_FILE}.tmp.$$"
  "$JQ" "$jq_expr" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# ── matching ────────────────────────────────────────────────────────────────

_matches() {
  local pattern="$1" name="$2"
  [[ "$pattern" == "*" ]] && return 0
  if [[ "$pattern" == *".*" ]]; then
    local prefix="${pattern%.\*}"
    [[ "$name" == "$prefix."* ]]
  else
    [[ "$pattern" == "$name" ]]
  fi
}

# ── bus operations ─────────────────────────────────────────────────────────

bus_init() {
  mkdir -p "$(dirname "$STATE_FILE")"
  if [[ ! -f "$STATE_FILE" ]]; then
    "$JQ" -n '{"subscriptions":[],"events":[],"plugins":[],"capabilities":[],"sessions":[],"audit":[]}' > "$STATE_FILE"
  fi
}

bus_subscribe() {
  local pattern="$1"
  local subs new_subs new_entry
  subs=$(state_get subscriptions)

  # Dedupe: if a subscription for this exact pattern already exists, no-op.
  if echo "$subs" | "$JQ" -e --arg p "$pattern" '.[] | select(.pattern == $p)' >/dev/null 2>&1; then
    echo "[bus] already subscribed: '$pattern'"
    return 0
  fi

  new_entry=$("$JQ" -n --arg p "$pattern" '{pattern: $p}')
  new_subs=$("$JQ" ". + [$new_entry]" <<< "$subs")
  state_set subscriptions "$new_subs"
  echo "[bus] subscribed: '$pattern'"
}

bus_publish() {
  local name="$1" payload="$2"
  local id ts new_evt subs matched

  id=$(date +%s%3N)
  ts=$(date -Iseconds)
  new_evt=$("$JQ" -n \
    --arg id "$id" \
    --arg name "$name" \
    --argjson payload "$payload" \
    --arg ts "$ts" \
    '{id: $id, name: $name, payload: $payload, publishedAt: $ts}')
  state_mutate ".events += [$new_evt]"

  echo ""
  echo "[bus] publishing: '$name'"
  echo "       payload  : $payload"
  echo "       id       : $id"

  subs=$(state_get subscriptions)
  matched=0
  for row in $(echo "$subs" | "$JQ" -r '.[] | @base64' 2>/dev/null); do
    local pattern
    pattern=$(echo "$row" | base64 -d | "$JQ" -r '.pattern')
    if _matches "$pattern" "$name"; then
      matched=$((matched + 1))
      echo "[bus]   -> handler matched: '$pattern'"
    fi
  done
  echo "[bus] dispatched to ${matched} subscriptions"
}

bus_list() {
  local subs count
  subs=$(state_get subscriptions)
  count=$(echo "$subs" | "$JQ" length)
  if ((count == 0)); then
    echo "[bus] no active subscriptions"
    return
  fi
  while IFS= read -r row; do
    local pattern
    pattern=$(echo "$row" | base64 -d | "$JQ" -r '.pattern')
    echo "  <Subscription pattern='$pattern'>"
  done < <(echo "$subs" | "$JQ" -r '.[] | @base64' 2>/dev/null)
}

bus_unsub() {
  local pattern="$1"
  local subs new_subs found
  subs=$(state_get subscriptions)
  new_subs="[]"
  found=0
  while IFS= read -r row; do
    local p obj
    p=$(echo "$row" | base64 -d | "$JQ" -r '.pattern')
    obj=$(echo "$row" | base64 -d)
    if ((!found)) && [[ "$p" == "$pattern" ]]; then
      found=1
      echo "[bus] unsubscribed: '$pattern'"
    else
      new_subs=$(echo "$new_subs" | "$JQ" ". + [$obj]")
    fi
  done < <(echo "$subs" | "$JQ" -r '.[] | @base64' 2>/dev/null)
  ((!found)) && echo "[bus] no subscription for pattern '$pattern'"
  state_set subscriptions "$new_subs"
}

bus_status() {
  echo "[bus] state file : $STATE_FILE"
  echo "[bus] plugins     : $(echo "$(state_get plugins)" | "$JQ" length)"
  echo "[bus] capabilities: $(echo "$(state_get capabilities)" | "$JQ" length)"
  echo "[bus] sessions    : $(echo "$(state_get sessions)" | "$JQ" length)"
  echo "[bus] events      : $(echo "$(state_get events)" | "$JQ" length)"
}

bus_reset() {
  rm -f "$STATE_FILE"
  bus_init
  echo "[bus] state reset"
}
