#!/usr/bin/env bash
# sim-event-bus.sh — Event Bus simulation (interconnected)
# Sources lib-event-bus.sh, shares state with all other simulations.
# Run:     bash scripts/sim-event-bus.sh
# Pipe:    printf 'subscribe session.*\npublish session.created {}\n' | bash scripts/sim-event-bus.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib-event-bus.sh"

show_help() {
  cat <<'EOF'
Commands:
  subscribe <pattern>  subscribe (* = all, prefix.* = namespace wildcard)
  publish <name> [json]  publish an event
  list                list active subscriptions
  unsub <pattern>    remove first matching subscription
  status             show state diagnostics
  reset              clear all state
  help               show this help
  quit / exit        exit
EOF
}

dispatch() {
  local cmd="$1"; shift
  case "$cmd" in
    subscribe)
      if [[ $# -lt 1 ]]; then echo "usage: subscribe <pattern>"; return 1; fi
      bus_subscribe "$1"
      ;;
    publish)
      if [[ $# -lt 2 ]]; then echo "usage: publish <name> [json]"; return 1; fi
      bus_publish "$1" "$2"
      ;;
    list)  bus_list ;;
    unsub)
      if [[ $# -lt 1 ]]; then echo "usage: unsub <pattern>"; return 1; fi
      bus_unsub "$1"
      ;;
    status) bus_status ;;
    reset)  bus_reset ;;
    help|--help|-h) show_help ;;
    quit|exit|q) echo "[bus] exiting"; exit 0 ;;
    *) echo "unknown command: $cmd  (type 'help')" ;;
  esac
}

parse_and_run() {
  local line="$1"
  line=$(echo "$line" | sed 's/^[[:space:]]\+//; s/[[:space:]]\+$//')
  [[ -z "$line" ]] && return 0
  [[ "$line" =~ ^# ]] && return 0

  # Handle publish specially: "publish <name> <json>"
  if [[ "$line" == publish\ * ]]; then
    local after="${line#publish }"
    after="${after# }"
    # First space-separated token is the event name; rest is the JSON payload
    local name="${after%% *}"
    local payload="${after#$name}"
    payload="${payload# }"
    [[ -z "$payload" ]] && payload="{}"
    dispatch publish "$name" "$payload"
    return 0
  fi

  # All other commands: first token = cmd, rest = arg
  local cmd="${line%% *}"
  local rest="${line#$cmd}"
  rest="${rest# }"
  [[ -z "$rest" ]] && dispatch "$cmd" || dispatch "$cmd" "$rest"
}

bus_init

if [[ -t 0 ]]; then
  echo "event-bus simulation (interconnected) — type 'help' for commands"
  echo "state: $STATE_FILE"
  echo "---"
  while true; do
    printf "\n> "
    IFS= read -r line || { echo ""; break; }
    parse_and_run "$line"
  done
else
  while IFS= read -r line || [[ -n "$line" ]]; do
    parse_and_run "$line"
  done
fi
