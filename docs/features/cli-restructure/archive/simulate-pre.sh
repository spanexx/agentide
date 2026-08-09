#!/usr/bin/env bash
# simulate-pre.sh — cli-restructure design rehearsal (feature-pipeline Phase 0.5)
# Mirrors the locked GRILL: command->subcommand tree, `agentide>` shell,
# per-directory context (./.agentide/data), auto-complete, local-vs-remote
# split, one-release old names. DESIGN sim: simulated files, no real gateway.
# Run it from a scratch dir; `--demo` shows the full operator flow.

set -uo pipefail

_orig_data_dir="${AGENTIDE_DATA_DIR:-}"

VERSION="0.8.0-sim (cli-restructure pre-impl)"

data_dir() { echo "${AGENTIDE_DATA_DIR:-$PWD/.agentide/data}"; }

ensure_state() {
  local d; d="$(data_dir)"
  mkdir -p "$d"
  for f in tenants clients caps sessions plugins; do [ -f "$d/$f.txt" ] || touch "$d/$f.txt"; done
  [ -s "$d/tenants.txt" ] || echo "default" > "$d/tenants.txt"
  [ -s "$d/caps.txt" ] || printf 'product.list\norder.submit\ncustomer.read\n' > "$d/caps.txt"
}

list_lines() { [ -f "$1" ] && cat "$1"; }
add_line()   { mkdir -p "$(dirname "$1")"; grep -qxF "$2" "$1" 2>/dev/null || echo "$2" >> "$1"; }
del_line()   { [ -f "$1" ] && { grep -vx "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }; }
cap_exists() { list_lines "$(data_dir)/caps.txt" | grep -qxF "$1" || echo "$1" | grep -qxE "($(echo "${PLATFORM_CAPS[*]}" | tr ' ' '|'))"; }

cfg_set() { local f="$1" k="$2" v="$3"; mkdir -p "$(dirname "$f")"; [ -f "$f" ] || touch "$f"; sed -i "/^$k = /d" "$f"; echo "$k = \"$v\"" >> "$f"; }

gw_running()   { [ -f "$(data_dir)/gateway.pid" ]; }
gw_url()       { local f="$(data_dir)/config.toml"; [ -f "$f" ] && sed -n 's/^gateway_url = "\(.*\)"/\1/p' "$f" | head -1; }
require_live() { refuse_data_dir "$1" || return $?; gw_running || { echo "error: gateway not running (start it with: agentide gateway start)" >&2; return 1; }; }

PLATFORM_CAPS=(capability.list capability.describe gateway.status gateway.health gateway.metrics gateway.version session.create session.list session.resume session.destroy session.touch plugin.list plugin.install plugin.uninstall plugin.enable plugin.disable plugin.reload tenant.create tenant.list tenant.suspend tenant.delete client.create client.list client.grant client.revoke client.rotate client.redeem auth.token.issue auth.token.revoke)

TREE=(
  "init                                   one-time setup (stays top-level)"
  "gateway  start|stop|status|health|metrics|version"
  "tenant   create|list|suspend|delete"
  "client   create|list|grant|revoke|rotate|redeem"
  "capability list|describe"
  "plugin   list|install|uninstall|enable|disable|reload"
  "session  create|resume|destroy|touch|list"
  "token    issue|revoke"
  "invoke   <capability> [--args ...]     escape hatch (top-level)"
  "watch    <alias> [--topic ...]         escape hatch (top-level)"
)
GROUPS=(gateway tenant client capability plugin session token)
declare -A GROUP_SUBS
GROUP_SUBS=(
  [gateway]="start stop status health metrics version"
  [tenant]="create list suspend delete"
  [client]="create list grant revoke rotate redeem"
  [capability]="list describe"
  [plugin]="list install uninstall enable disable reload"
  [session]="create resume destroy touch list"
  [token]="issue revoke"
)
declare -A OLD_NAME_NEW
OLD_NAME_NEW=(
  [start]="gateway start"
  [stop]="gateway stop"
  [status]="gateway status"
  [health]="gateway health"
  [sessions]="session list"
  [capabilities]="capability list"
  [plugins]="plugin list"
)

ag_help() {
  echo "agentide — operator CLI (cli-restructure pre-impl sim)"
  echo
  echo "every command is a group with subcommands:"
  for l in "${TREE[@]}"; do
    if [[ "$l" == *"  "* ]]; then printf '  %-42s %s\n' "${l%%  *}" "${l#*  }"; else printf '  %s\n' "$l"; fi
  done
  echo
  echo "bare 'agentide' opens the interactive shell (agentide>)"
  echo "one-shot 'agentide <group> <subcommand>' works the same"
  echo "local-vs-remote: offline = init/tenant/client/token (data-dir only),"
  echo "  live = gateway/invoke/session/plugin-mutators/capability describe"
  echo "  (needs a running gateway); capability list + plugin list are dual-mode"
  echo "old names still work this release with a note: $(echo "${!OLD_NAME_NEW[*]}" | tr ' ' '|')"
}

# --- flag split: --url / --json / --data-dir out of the arg stream ---
split_flags() {
  URL_FLAG=""; JSON_FLAG=""; POS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --url)        URL_FLAG="${2:-}"; shift;;
      --url=*)      URL_FLAG="${1#*=}";;
      --json)       JSON_FLAG=1;;
      --data-dir)   [ $# -gt 1 ] && AGENTIDE_DATA_DIR="${2:-}"; shift;;
      --data-dir=*) AGENTIDE_DATA_DIR="${1#*=}";;
      *)            POS+=("$1");;
    esac
    shift
  done
}
refuse_url()     { [ -n "$URL_FLAG" ] && { echo "error: --url is a live-mode flag; $1 is offline (data-dir only)" >&2; return 1; }; return 0; }
refuse_data_dir() { [ -n "${AGENTIDE_DATA_DIR:-}" ] && [ "${AGENTIDE_DATA_DIR:-}" != "${_orig_data_dir:-}" ] && { echo "error: --data-dir is an offline-mode flag; $1 is live" >&2; return 1; }; return 0; }

# ================= groups =================
cmd_init() {
  refuse_url init || return $?
  ensure_state
  local f; f="$(data_dir)/config.toml"
  cfg_set "$f" token "sim-token-$(date +%s)"
  echo "# Bootstrap token saved to $f"
  echo "initialized $(data_dir) (tenant: default)"
}

cmd_gateway() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide gateway <subcommand>"; echo "subcommands: ${GROUP_SUBS[gateway]}"; return 0; fi
  case "$sub" in
    start)
      ensure_state; echo "$$" > "$(data_dir)/gateway.pid"
      cfg_set "$(data_dir)/config.toml" gateway_url "ws://127.0.0.1:7300/ws"
      echo "gateway started (all doors, ws://127.0.0.1:7300/ws) — pid $$";;
    stop)
      gw_running || { echo "error: gateway not running" >&2; return 1; }
      rm -f "$(data_dir)/gateway.pid"; echo "gateway stopped";;
    status)
      require_live "gateway status" || return $?; local u; u="$(gw_url)"
      echo "status: running"; echo "url:     ${u:-ws://127.0.0.1:7300/ws}"; echo "tenant:  $(head -1 "$(data_dir)/tenants.txt")";;
    health)  require_live "gateway health" || return $?; echo 'status: ok';;
    metrics) require_live "gateway metrics" || return $?; echo "invocations: $(list_lines "$(data_dir)/caps.txt" | wc -l) total";;
    version) require_live "gateway version" || return $?; echo "agentide 0.7.0 (sim)";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[gateway]})" >&2; return 2;;
  esac
}

cmd_tenant() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide tenant <subcommand>"; echo "subcommands: ${GROUP_SUBS[tenant]}"; return 0; fi
  refuse_url tenant || return $?
  ensure_state; local f="$(data_dir)/tenants.txt" s="$(data_dir)/suspended.txt"
  case "$sub" in
    create)   [ -z "${1:-}" ] && { echo "usage: agentide tenant create <name>" >&2; return 2; }; add_line "$f" "$1"; echo "tenant created: $1";;
    list)     echo "tenants:"; list_lines "$f" | while read -r t; do st="active"; [ -f "$s" ] && grep -qxF "$t" "$s" && st="suspended"; echo "  $t ($st)"; done;;
    suspend)  [ -z "${1:-}" ] && { echo "usage: agentide tenant suspend <name>" >&2; return 2; }; del_line "$f" "$1"; add_line "$s" "$1"; echo "tenant suspended: $1";;
    delete)   [ -z "${1:-}" ] && { echo "usage: agentide tenant delete <name>" >&2; return 2; }; del_line "$f" "$1"; del_line "$s" "$1"; echo "tenant deleted: $1";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[tenant]})" >&2; return 2;;
  esac
}

cmd_client() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide client <subcommand>"; echo "subcommands: ${GROUP_SUBS[client]}"; return 0; fi
  refuse_url client || return $?
  ensure_state; local f="$(data_dir)/clients.txt"
  case "$sub" in
    create) local id="client_$(date +%s)"; add_line "$f" "$id"; echo "client created: $id (secret shown once, offline)";;
    list)   echo "clients:"; list_lines "$f" | sed 's/^/  /';;
    grant|revoke|rotate|redeem) [ -z "${1:-}" ] && { echo "usage: agentide client $sub <clientId>" >&2; return 2; }; echo "$sub: $1 (simulated)";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[client]})" >&2; return 2;;
  esac
}

cmd_capability() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide capability <subcommand>"; echo "subcommands: ${GROUP_SUBS[capability]}"; return 0; fi
  ensure_state
  case "$sub" in
    list) # dual-mode: disk by default, --url switches live
      if [ -n "$URL_FLAG" ]; then require_live "capability list" || return $?; echo "capabilities (live @ $URL_FLAG):"; else echo "capabilities (disk):"; fi
      list_lines "$(data_dir)/caps.txt" | sed 's/^/  /'
      for c in capability.list capability.describe gateway.status session.list plugin.list; do echo "  $c"; done;;
    describe)
      [ -z "${1:-}" ] && { echo "usage: agentide capability describe <name>" >&2; return 2; }
      require_live "capability describe" || return $?
      if cap_exists "$1"; then echo "capability $1: version 1.0.0, tier act (simulated)"; else echo "error: GATEWAY_CAPABILITY_NOT_FOUND: $1" >&2; return 1; fi;;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[capability]})" >&2; return 2;;
  esac
}

cmd_plugin() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide plugin <subcommand>"; echo "subcommands: ${GROUP_SUBS[plugin]}"; return 0; fi
  ensure_state; local f="$(data_dir)/plugins.txt"
  case "$sub" in
    list) if [ -n "$URL_FLAG" ]; then require_live "plugin list" || return $?; echo "plugins (live @ $URL_FLAG):"; else echo "plugins (disk):"; fi
      list_lines "$f" | sed 's/^/  /';;
    install|uninstall|enable|disable|reload)
      require_live "plugin $sub" || return $?
      local src="${1:-}"; [ "$sub" = install ] && [ -z "$src" ] && { echo "usage: agentide plugin install --source <path>" >&2; return 2; }
      case "$sub" in install) add_line "$f" "$src";; uninstall|disable) del_line "$f" "$src";; esac
      echo "plugin $sub: ${src:-(all)} (simulated)";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[plugin]})" >&2; return 2;;
  esac
}

cmd_session() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide session <subcommand>"; echo "subcommands: ${GROUP_SUBS[session]}"; return 0; fi
  require_live "session $sub" || return $?
  ensure_state; local f="$(data_dir)/sessions.txt"
  case "$sub" in
    create) local id="session_$(date +%s)"; add_line "$f" "$id"; echo "$id";;
    list)   echo "sessions:"; list_lines "$f" | sed 's/^/  /';;
    resume) [ -z "${1:-}" ] && { echo "usage: agentide session resume <sessionId>" >&2; return 2; }; echo "resumed: $1";;
    destroy) [ -z "${1:-}" ] && { echo "usage: agentide session destroy <sessionId>" >&2; return 2; }; del_line "$f" "$1"; echo "destroyed: $1";;
    touch)  [ -z "${1:-}" ] && { echo "usage: agentide session touch <sessionId>" >&2; return 2; }; echo "touched: $1";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[session]})" >&2; return 2;;
  esac
}

cmd_token() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift
  if [ -z "$sub" ]; then echo "usage: agentide token <subcommand>"; echo "subcommands: ${GROUP_SUBS[token]}"; return 0; fi
  refuse_url token || return $?
  ensure_state
  case "$sub" in
    issue) cfg_set "$(data_dir)/config.toml" token "sim-token-$(date +%s)"; echo "# Token issued (scope: *, 1h) — saved to $(data_dir)/config.toml";;
    revoke) cfg_set "$(data_dir)/config.toml" token "revoked"; echo "token revoked";;
    *) echo "error: unknown subcommand: $sub (subcommands: ${GROUP_SUBS[token]})" >&2; return 2;;
  esac
}

cmd_invoke() {
  local name="${1:-}"
  [ -z "$name" ] && { echo "usage: agentide invoke <capability> [--args ...]" >&2; return 2; }
  require_live "invoke" || return $?
  if cap_exists "$name"; then
    echo "ok: $name v1.0.0 -> { \"result\": \"simulated output\" }"
  else
    echo "error: GATEWAY_CAPABILITY_NOT_FOUND: $name" >&2; return 1
  fi
}

cmd_watch() {
  local alias="${1:-}"
  [ -z "$alias" ] && { echo "usage: agentide watch <alias> [--topic ...]" >&2; return 2; }
  require_live "watch" || return $?
  local topic="${alias}.*"; case "$alias" in status|health) topic="gateway.*";; *.*) topic="$alias";; esac
  echo "watching $topic (snapshot taken, Ctrl-C to stop) — simulated"
}

# ================= dispatch =================
ag_dispatch() {
  local _dd="${AGENTIDE_DATA_DIR:-}" rc=0
  [ $# -eq 0 ] && { ag_help; return 0; }
  local cmd="$1"; shift
  split_flags "$@"
  case "$cmd" in
    help|-h|--help) ag_help;;
    init) cmd_init;;
    gateway) cmd_gateway "${POS[@]}";;
    tenant) cmd_tenant "${POS[@]}";;
    client) cmd_client "${POS[@]}";;
    capability) cmd_capability "${POS[@]}";;
    plugin) cmd_plugin "${POS[@]}";;
    session) cmd_session "${POS[@]}";;
    token) cmd_token "${POS[@]}";;
    invoke) cmd_invoke "${POS[@]}";;
    watch) cmd_watch "${POS[@]}";;
    -v|--version) echo "$VERSION";;
    start|stop|status|health|sessions|capabilities|plugins)
      # one-release compat (GRILL Q3): note + map to the new tree name
      local new="${OLD_NAME_NEW[$cmd]}"
      echo "note: 'agentide $cmd' is deprecated — use 'agentide $new' (removed next release)"
      ag_dispatch $new;;
    *) echo "error: unknown command: $cmd" >&2; echo "hint: agentide <group> with no subcommand shows that group's subcommands" >&2; (exit 2);;
  esac
  rc=$?
  AGENTIDE_DATA_DIR="$_dd"
  return $rc
}
# ================= interactive shell =================
# ─── Tab completion: inserts the match (bind -x can edit READLINE_LINE) ─
ALL_WORDS="init invoke watch help exit quit history pwd cd clear ${GROUPS[*]} ${GROUP_SUBS[*]}"
state_words() { list_lines "$(data_dir)/tenants.txt"; list_lines "$(data_dir)/caps.txt"; }
_ag_tab() {
  local line="${READLINE_LINE:-}" word c
  word="${line##* }"
  local matches=()
  for c in $ALL_WORDS $(state_words); do case "$c" in "$word"*) matches+=("$c");; esac; done
  if [ ${#matches[@]} -eq 1 ] && [ -n "$word" ]; then
    READLINE_LINE="${line%$word}${matches[0]} "
    READLINE_POINT=${#READLINE_LINE}
  elif [ ${#matches[@]} -gt 1 ]; then
    printf '\ncompletions: %s\n' "${matches[*]}"
  fi
}

run_line() { # one line from the shell (or demo): history + builtins + dispatch
  local line="$1" rc=0
  line="${line#agentide }"   # tolerate the binary prefix inside the shell
  [ "$line" = "agentide" ] && { echo "(you are already in the agentide shell — type help)"; return 0; }
  [ -n "$line" ] && add_line "$(data_dir)/shell-history" "$line"
  case "$line" in
    exit|quit|q) return 99;;
    help) ag_help;;
    clear) printf '\033[2J\033[H';;
    pwd) pwd;;
    history) echo "history ($(data_dir)/shell-history):"; list_lines "$(data_dir)/shell-history" | nl -ba | sed 's/^/  /';;
    cd) return 0;;
    cd\ *) cd "${line#cd }" 2>&1 || return 1; echo "context: $(data_dir)";;
    "") return 0;;
    *) read -ra _args <<< "$line"; ag_dispatch "${_args[@]}";;
  esac
}

shell_loop() {
  bind -x '"\C-i":_ag_tab' 2>/dev/null
  trap '' INT   # Ctrl-C clears the line, does not kick you out
  local line rc
  HISTFILE="$(data_dir)/shell-history"
  history -r "$HISTFILE" 2>/dev/null   # arrow-up/down across sessions, per dir
  echo "agentide interactive shell (cli-restructure pre-impl sim) — type help, exit to quit, Tab to complete"
  while true; do
    printf 'agentide (%s)> ' "$(data_dir)"
    read -r -e line || { echo; break; }
    [ -n "$line" ] && { add_line "$HISTFILE" "$line"; history -s "$line"; }
    run_line "$line"; rc=$?
    [ $rc -eq 99 ] && break
    [ $rc -ne 0 ] && echo "(exit $rc)"
    if [[ "$line" == cd* ]] && [ $rc -eq 0 ]; then
      HISTFILE="$(data_dir)/shell-history"
      history -c && history -r "$HISTFILE" 2>/dev/null
    fi
  done
}

# ================= demo =================
demo_run() {
  exec 2>&1
  local base="${TMPDIR:-/tmp}/agentide-sim-demo"
  rm -rf "$base"; mkdir -p "$base/proj-a" "$base/proj-b"
  local script=(
    "cd $base/proj-a"
    "init"
    "gateway"
    "tenant create acme"
    "tenant list --url ws://evil:7300"
    "gateway status"
    "gateway start"
    "gateway status --data-dir /tmp/other"
    "status"
    "capability list"
    "capability list --url ws://127.0.0.1:7300/ws"
    "invoke product.list"
    "invoke nope.nothere"
    "session create"
    "session list"
    "watch session"
    "plugins"
    "cd $base/proj-b"
    "tenant list"
    "history"
    "exit"
  )
  for ln in "${script[@]}"; do
    printf '\n$ %s\n' "$ln"
    run_line "$ln" || true
  done
  echo; echo "demo done — scratch dir: $base"
}

# ================= main =================
case "${1:-}" in
  --demo) shift; demo_run "$@";;
  *)
    if [ $# -gt 0 ]; then
      ag_dispatch "$@"; exit $?
    elif [ -t 0 ]; then
      shell_loop; exit 0
    else
      ag_help; exit 0   # non-TTY bare: help + exit 0 (GRILL Q8)
    fi;;
esac
