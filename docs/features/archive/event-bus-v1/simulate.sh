#!/usr/bin/env bash
# simulate.sh — Event Bus canonical simulation
#
# Mirrors the real implementation in packages/event-bus/src/.
# Use this to see what @platform/event-bus actually does, not just what
# the docs say. Run alongside any code that uses the bus to spot drift.
#
# Run interactively:
#   bash simulate.sh
# Or pipe commands:
#   echo "subscribe session.*"    | bash simulate.sh
#   echo "publish session.created {\"id\":\"s1\"}" | bash simulate.sh
#
# Commands:
#   subscribe <pattern>          register a handler for a pattern
#   publish <name> [json]        publish an event (async; awaits handlers)
#   list                         show all active subscriptions in order
#   unsub <pattern> [id]        remove a subscription (matches pattern;
#                                if multiple, the most recent first)
#   reset                        clear all subscriptions + event log
#   status                       show diagnostics
#   help                         show this help
#   quit / exit                  exit

set -uo pipefail

# ─── state ────────────────────────────────────────────────────────────────────

# ordered list of subscription ids (insertion order — preserved exactly)
SUBS=()
# subscription id -> pattern|handler file path
declare -A SUB_PATTERN=()
declare -A SUB_HANDLER=()
declare -A SUB_ORDER=()
NEXT_SUB_ID=1

# event log (in-memory; not persisted across runs)
EVENTS=()
NEXT_EVENT_ID=1

# ─── validation (mirrors packages/event-bus/src/match.ts) ────────────────────

# validatePattern: pattern must be non-empty, segments non-empty, `*` only
# as the final segment. Throws on invalid input.
validate_pattern() {
  local pattern="$1"
  if [[ -z "$pattern" ]]; then
    echo "ERROR: invalid subscription pattern (empty)" >&2
    return 1
  fi
  # bash regex split on '.' — IFS=. read -ra
  local segs i=0 seg last_index
  IFS='.' read -ra segs <<< "$pattern"
  last_index=$((${#segs[@]} - 1))
  for seg in "${segs[@]}"; do
    if [[ "$seg" == "*" ]]; then
      if (( i != last_index )); then
        echo "ERROR: '*' is only valid as the final segment of a pattern. Got '$pattern'." >&2
        return 1
      fi
    elif [[ "$seg" == *\** ]]; then
      echo "ERROR: invalid wildcard grammar in pattern '$pattern' (* must be its own segment)." >&2
      return 1
    elif [[ -z "$seg" ]]; then
      echo "ERROR: invalid wildcard grammar in pattern '$pattern' (empty segment)." >&2
      return 1
    fi
    (( i++ ))
  done
  return 0
}

# validate_event_name: name must be non-empty, no empty segments
validate_event_name() {
  local name="$1"
  if [[ -z "$name" ]]; then
    echo "ERROR: invalid event name (empty)" >&2
    return 1
  fi
  if [[ "$name" == *".."* ]]; then
    echo "ERROR: invalid event name '$name' (empty segment)." >&2
    return 1
  fi
  return 0
}

RESERVED_INTERNAL_PREFIX="event."

# ─── matching (mirrors packages/event-bus/src/match.ts matches()) ────────────

# matches: pattern ↔ name. `*` final segment = prefix wildcard.
# Other patterns must match segment-for-segment.
matches() {
  local pattern="$1" name="$2"
  local p_segs n_segs
  IFS='.' read -ra p_segs <<< "$pattern"
  IFS='.' read -ra n_segs <<< "$name"

  local last=$((${#p_segs[@]} - 1))
  if [[ "${p_segs[$last]}" == "*" ]]; then
    # prefix wildcard: prefix length must be <= name length, all match
    if (( ${#p_segs[@]} > ${#n_segs[@]} + 1 )); then return 1; fi
    # Actually: pattern has `*` last so its segments = prefix. n_segs.length
    # must be >= prefix.length (because * matches one or more remaining).
    # Real impl: `if (prefix.length > nSegs.length) return false`.
    local prefix_len=$((${#p_segs[@]} - 1))
    if (( prefix_len > ${#n_segs[@]} )); then return 1; fi
    local i
    for (( i=0; i<prefix_len; i++ )); do
      if [[ "${p_segs[$i]}" != "${n_segs[$i]}" ]]; then return 1; fi
    done
    return 0
  fi

  # exact segment match
  if (( ${#p_segs[@]} != ${#n_segs[@]} )); then return 1; fi
  local i
  for (( i=0; i<${#p_segs[@]}; i++ )); do
    if [[ "${p_segs[$i]}" != "${n_segs[$i]}" ]]; then return 1; fi
  done
  return 0
}

# ─── subscribe / unsubscribe (mirrors packages/event-bus/src/index.ts) ───────

# subscribe: NO deduplication. Each call adds a new subscription.
# Returns the sub id (the real bus returns a Subscription handle).
bus_subscribe() {
  local pattern="$1" handler="$2"
  validate_pattern "$pattern" || return 1

  local id=$NEXT_SUB_ID
  NEXT_SUB_ID=$((NEXT_SUB_ID + 1))

  SUBS+=("$id")
  SUB_PATTERN[$id]="$pattern"
  SUB_HANDLER[$id]="$handler"
  SUB_ORDER[$id]=$id   # insertion order = id order

  echo "[bus] subscribed: id=$id pattern='$pattern'"
  echo "$id"   # returned as "handle" — caller can use it for unsub
}

# unsubscribe: remove by id (or first matching pattern if no id)
bus_unsub() {
  local target="$1"
  local id_to_remove=""

  if [[ "$target" =~ ^[0-9]+$ ]]; then
    id_to_remove="$target"
  else
    # first subscription matching pattern, in reverse order (most recent first)
    local i
    for (( i=${#SUBS[@]}-1; i>=0; i-- )); do
      local sid="${SUBS[$i]}"
      if [[ "${SUB_PATTERN[$sid]}" == "$target" ]]; then
        id_to_remove="$sid"
        break
      fi
    done
  fi

  if [[ -z "$id_to_remove" ]]; then
    echo "[bus] no subscription matching '$target'"
    return 1
  fi

  # remove from SUBS array
  local new_subs=()
  for sid in "${SUBS[@]}"; do
    [[ "$sid" != "$id_to_remove" ]] && new_subs+=("$sid")
  done
  SUBS=("${new_subs[@]}")
  unset "SUB_PATTERN[$id_to_remove]"
  unset "SUB_HANDLER[$id_to_remove]"
  unset "SUB_ORDER[$id_to_remove]"

  echo "[bus] unsubscribed: id=$id_to_remove"
}

# ─── publish (mirrors packages/event-bus/src/index.ts publish + dispatch) ────

# publish: async semantics. Snapshots matching subs in order, invokes each
# handler, catches failures, emits event.handler_failed. Awaits async handlers.
bus_publish() {
  local name="$1" payload="${2:-{\}}"
  validate_event_name "$name" || return 1
  if [[ "$name" == "${RESERVED_INTERNAL_PREFIX}"* ]]; then
    echo "[bus] ERROR: reserved namespace 'event.' — only the Event Bus may publish events with this prefix. Got '$name'." >&2
    return 1
  fi

  local id=$NEXT_EVENT_ID
  NEXT_EVENT_ID=$((NEXT_EVENT_ID + 1))

  echo ""
  echo "[bus] publishing: name='$name' id=evt-$id payload=$payload"

  # ── snapshot matching subs in order (AC-15: in-flight dispatch is immutable) ──
  local dispatch_list=()
  for sid in "${SUBS[@]}"; do
    if matches "${SUB_PATTERN[$sid]}" "$name"; then
      dispatch_list+=("$sid")
    fi
  done

  # ── invoke each handler in order; surface failures via event.handler_failed ──
  local matched=0
  for sid in "${dispatch_list[@]}"; do
    local pattern="${SUB_PATTERN[$sid]}"
    local handler="${SUB_HANDLER[$sid]}"
    matched=$((matched + 1))

    echo "[bus]   -> dispatching to id=$sid pattern='$pattern'"
    # Invoke handler in subshell with event variables exported. This mirrors
    # the real bus's snapshot semantics (AC-15) and isolates failures so a
    # crash in one handler doesn't affect subsequent ones.
    local EVENT_NAME="$name" EVENT_ID="evt-$id" EVENT_PAYLOAD="$payload"
    if ! ( export EVENT_NAME EVENT_ID EVENT_PAYLOAD; eval "$handler" ); then
      emit_handler_failed "$name" "$pattern" "handler exited non-zero"
    fi
  done

  # log event
  EVENTS+=("evt-$id|$name|$payload")

  echo "[bus] dispatched to $matched subscription(s)"
}

# emit_handler_failed: bus's internal event for handler failures.
# Bypasses reserved-namespace guard (mirrors dispatchInternal in real code).
emit_handler_failed() {
  local event_name="$1" pattern="$2" reason="$3"
  echo "[bus]   !! handler failed: pattern='$pattern' reason='$reason'"
  echo "[bus]   -> emitting event.handler_failed (eventName='$event_name', pattern='$pattern')"
  # In real code, this would re-enter dispatch — but handler_failed handlers
  # can't fail (they're internal). We just log it.
}

# ─── diagnostics ─────────────────────────────────────────────────────────────

bus_list() {
  if (( ${#SUBS[@]} == 0 )); then
    echo "[bus] no active subscriptions"
    return
  fi
  for sid in "${SUBS[@]}"; do
    echo "  <Subscription id=$sid pattern='${SUB_PATTERN[$sid]}' order=${SUB_ORDER[$sid]}>"
  done
}

bus_reset() {
  SUBS=()
  SUB_PATTERN=()
  SUB_HANDLER=()
  SUB_ORDER=()
  EVENTS=()
  NEXT_SUB_ID=1
  NEXT_EVENT_ID=1
  echo "[bus] state reset"
}

bus_status() {
  echo "[bus] subscriptions : ${#SUBS[@]}"
  echo "[bus] events fired  : ${#EVENTS[@]}"
  echo "[bus] next sub id   : $NEXT_SUB_ID"
  echo "[bus] next evt id   : $NEXT_EVENT_ID"
}

# ─── command parsing ──────────────────────────────────────────────────────────

parse_publish() {
  # rest is "name [json]" — split on first space
  local rest="$1"
  local name="${rest%% *}"
  local payload="${rest#"$name"}"
  payload="${payload# }"
  [[ -z "$payload" ]] && payload="{}"
  echo "$name|$payload"
}

# Handlers in this sim are short shell snippets stored verbatim and eval'd
# at dispatch time. To keep the CLI sane, a handler must be ONE shell word —
# use shell functions for anything fancier. Example:
#   subscribe session.* 'echo got=$name'
# The quotes are required because the handler contains spaces.
run_command() {
  local cmd="$1"; shift
  case "$cmd" in
    subscribe)
      if [[ $# -lt 2 ]]; then
        echo "usage: subscribe <pattern> <handler>" >&2
        return 1
      fi
      bus_subscribe "$1" "$2"
      ;;
    publish)
      if [[ $# -lt 1 ]]; then
        echo "usage: publish <name> [json]" >&2
        return 1
      fi
      bus_publish "$1" "${2:-{}}"
      ;;
    unsub)
      if [[ $# -lt 1 ]]; then
        echo "usage: unsub <pattern-or-id>" >&2
        return 1
      fi
      bus_unsub "$1"
      ;;
    list)   bus_list ;;
    reset)  bus_reset ;;
    status) bus_status ;;
    help|--help|-h)
      cat <<'EOF'
Commands:
  subscribe <pattern> <handler>    register handler for pattern
                                    (handler is a single shell word —
                                     quote it if it has spaces)
  publish <name> [json]            publish an event
  list                             show subscriptions in order
  unsub <pattern-or-id>            remove a subscription
  reset                            clear all state
  status                           show diagnostics
  help                             show this help
  quit / exit                      exit

Handler variables available inside the handler snippet:
  $EVENT_NAME    the event name being dispatched
  $EVENT_ID      the event id (evt-N)
  $EVENT_PAYLOAD  the payload string

Examples:
  subscribe 'session.*' 'echo "got=$EVENT_NAME"'
  publish session.created '{"id":"s1"}'
  unsub 'session.*'
EOF
      ;;
    quit|exit|q) echo "[bus] exiting"; exit 0 ;;
    *) echo "unknown command: $cmd  (type 'help')" >&2 ;;
  esac
}

dispatch_line() {
  local line="$1"
  line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
  line="${line%"${line##*[![:space:]]}"}"   # trim trailing whitespace
  [[ -z "$line" ]] && return 0
  [[ "$line" == \#* ]] && return 0

  local cmd="${line%% *}"
  local rest="${line#"$cmd"}"
  rest="${rest# }"

  if [[ "$cmd" == "subscribe" ]]; then
    # subscribe <pattern> <handler> — handler may be quoted (e.g. "echo got $name")
    # Strip one layer of surrounding double-quotes if present.
    local pattern="${rest%% *}"
    local handler="${rest#"$pattern"}"
    handler="${handler# }"
    if [[ -z "$handler" ]]; then
      echo "usage: subscribe <pattern> <handler>" >&2
      return 1
    fi
    # Trim matching outer quotes (single or double)
    if [[ "${handler:0:1}" == '"' && "${handler: -1}" == '"' ]]; then
      handler="${handler:1:-1}"
    elif [[ "${handler:0:1}" == "'" && "${handler: -1}" == "'" ]]; then
      handler="${handler:1:-1}"
    fi
    bus_subscribe "$pattern" "$handler"
  elif [[ "$cmd" == "publish" ]]; then
    local parsed
    parsed=$(parse_publish "$rest")
    local name="${parsed%%|*}"
    local payload="${parsed#*|}"
    bus_publish "$name" "$payload"
  else
    if [[ -z "$rest" ]]; then
      run_command "$cmd"
    else
      run_command "$cmd" "$rest"
    fi
  fi
}

# ─── main loop ────────────────────────────────────────────────────────────────

if [[ -t 0 ]]; then
  echo "event-bus simulation — type 'help' for commands"
  echo "-----------------------------------------------"
  while true; do
    printf "\n> "
    IFS= read -r line || { echo ""; break; }
    dispatch_line "$line"
  done
else
  while IFS= read -r line || [[ -n "$line" ]]; do
    dispatch_line "$line"
  done
fi