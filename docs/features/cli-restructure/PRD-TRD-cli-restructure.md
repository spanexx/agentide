# PRD-TRD: cli-restructure

**Slug:** cli-restructure
**Status:** Draft
**Date:** 2026-08-08

## Why This Exists

The `agentide` CLI grew organically: a flat mix of operator commands (`init`, `start`, `stop`, `status`, `tenant`, `client`, `token`, `capability`, `plugin`) plus remote consumer aliases (`sessions`, `capabilities`, `plugins`, `health`, `invoke`, `watch`) — each with different flag conventions and no shared shape. Operator feedback (GRILL Q1/Q6): "the cli is not structured to be clear everything is layed out on the terminal, no sub commands that targets each command and its subcommand".

Two other usability gaps: bare `agentide` dumps the whole help screen (useless for exploration), and operators re-type `--data-dir`/`--url` per command even when context already pins it.

> **2026-08-09 (surgical change — global data-dir default):** "context" is no longer a per-directory `./.agentide/data` folder. Default ambient data dir = shared store `<home>/.local/share/agentide/<repo-key>/data` (repo-key = sha256 of the repo root, first 12 hex; outside a repo the cwd itself is the key) — per-repo isolation WITHOUT polluting the repo. Legacy `./.agentide/data` is opt-in via config `data_dir = "repo"` or an explicit `--data-dir` / `AGENTIDE_DATA_DIR` pin. Priority: flag > env > config > global default.

This pack restructures the CLI into a command→subcommand tree, adds an interactive shell for bare invocation, and makes context ambient per-directory. CLI surface only — gateway/capability behavior untouched (GRILL non-goal).

## Behavioral Spec

### Scenario 1: bare `agentide` opens the interactive shell (TTY)

**Given** the operator runs `agentide` with no arguments from an interactive terminal
**When** the CLI starts
**Then**:
1. The shell opens with prompt `agentide>`.
2. The shell resolves context from the ambient data dir — default the shared per-repo store `<home>/.local/share/agentide/<repo-key>/data`, or the legacy `./.agentide/data` relative to cwd when `data_dir = "repo"` is configured (or an explicit `--data-dir`/`AGENTIDE_DATA_DIR` pin wins over everything; see the 2026-08-09 note above).
3. Shell builtins: `exit` / `quit` (leave), `help`, `history`, `pwd`, `cd <dir>` (switches the shell's data-dir context), `clear` (clears screen).
4. `cd` reloads the context + history for the new directory.

### Scenario 2: bare `agentide` in a script prints help, exits 0 (non-TTY)

**Given** stdin is not a real terminal (script, CI, pipe, redirect)
**When** the operator runs `agentide` with no arguments
**Then**: the CLI prints the help text and exits 0 — same as today.

### Scenario 3: the command tree

**Given** the operator runs any one-shot command
**When** the CLI parses it
**Then** the surface is exactly:

```
agentide init                     (one-time setup, stays top-level)
agentide gateway  start|stop|status|health|metrics|version
agentide tenant   create|list|suspend|delete
agentide client   create|list|grant|revoke|rotate|redeem
agentide capability list|describe
agentide plugin   list|install|uninstall|enable|disable|reload
agentide session  create|resume|destroy|touch|list
agentide token    issue|revoke
agentide invoke   <capability> [--args ...]   (top-level escape hatch)
agentide watch    <alias> [--topic ...]        (top-level escape hatch)
```

Group with no subcommand prints just that group's subcommand list + usage (e.g. `agentide gateway` → `usage: agentide gateway <subcommand>` + `subcommands: start stop status health metrics version`), exits 0. Unknown subcommand → `error: unrecognized subcommand: <sub>` + the group's list, exit 2. (NOTE: the exact error word is "unrecognized" — the repo's banned-type gate (check-banned-types.sh) rejects the literal `: unknown` pattern in source, and the unpre-impl sim matched it too.)

### Scenario 4: one-release old names

**Given** the operator runs a pre-restructure name (`start`, `stop`, `status`, `health`, `sessions`, `capabilities`, `plugins`)
**When** the CLI parses it
**Then**:
1. The command runs exactly as before — except `status`, which is already live-only this release per Scenario 6 (its old in-process/pid-file disk path was deleted; `status --data-dir` is refused). The migration window applies to the other eight names; `status` is "effectively already removed", documented in IMPL + D-117.
2. A note prints once, on stderr, naming the new tree command, e.g. `note: 'agentide status' is deprecated — use 'agentide gateway status' (removed next release)`.
3. Old names are removed in the release after this one.

### Scenario 5: local-vs-remote split

**Given** the operator runs a command with its world's flag (or none)
**When** the CLI parses it
**Then**:
- **Offline (disk)** — `init`, `tenant`, `client`, `token`: use the data-dir only; refuse `--url`/`--token` with a clear error, exit 1.
- **Live (gateway)** — `gateway *` (status/health/metrics/version), `invoke`, `session *`, `plugin install|uninstall|enable|disable|reload`: always remote; gateway down → error `gateway not running (start it with: agentide gateway start)` from the pid file — never a raw ECONNREFUSED; refuse `--data-dir`, exit 1. (World-table note: `gateway start`/`stop` and `capability describe` ship as **offline/data-dir** in v1 — start/stop are pid-file spawn ops that must work with no gateway up (Risk Note 1), and describe reads the in-process registry (IMPL delivery note 4). The world table below reflects the shipped worlds.)
- **Dual-mode** — `capability list`, `plugin list`: read disk by default; `--url` switches to the live gateway.
- `--json` stays global. `--data-dir` and `--url`/`--token` never mix on the same command.
- Zero-flag remote works after `init` + `start` via the config file (`gateway_url` + `token`).

### Scenario 6: `gateway start`/`stop`/`status` rehome

**Given** the operator runs `agentide gateway start` / `gateway stop` / `gateway status`
**Then**:
1. `gateway start` = the existing `start` (detached, `--all-doors`, `--port-*`, `--foreground`, `--data-dir`, `--pid-file` all carry over unchanged).
2. `gateway stop` = the existing `stop` (pid-file based, unified rc 0 per D-83).
3. `gateway status` = the **live** `gateway.status` capability (GRILL Q7 — the gateway group is live-only): gateway down → `gateway not running (start it with: agentide gateway start)` from the pid file, exit 1. The old in-process/pid-file `status` path (cli.ts `runStatus`, L369) dies with the old name after the one-release window — its disk-side questions are answered by the pid-file check in the "gateway not running" error and by the live gateway itself.

### Scenario 7: shell auto-complete

**Given** the operator is in the `agentide>` shell and presses Tab
**Then**:
1. Tab completes the command + subcommand tree (e.g. `gateway sta<Tab>` lists `start`/`status`, and inserts the unique match).
2. Tab completes tenant ids from the data-dir store (e.g. `tenant delete acm<Tab>` → `tenant delete acme `). NOTE: the v1 `tenant delete`/`suspend` handlers take `--id <tenant>` (pre-existing flag surface); the completed positional is the value target — type `--id acme` to use it. Capability names are NOT completed in v1 (no disk artifact ships them; the shell falls back to tree-only completion — see IMPL Risk Note 2).
3. Tab does NOT complete live capability names (no gateway round-trip on Tab) and does NOT complete filesystem paths.

### Scenario 8: shell history and prefix tolerance

**Given** the operator is in the `agentide>` shell
**When** they use shell history or type a full binary prefix
**Then**:
1. Arrow up/down recall previous commands from the shared store's history (`shell-history` inside the resolved data dir — global store by default, see the 2026-08-09 note above), across shell sessions — loaded at shell start and reloaded after `cd` (only when no env/`--data-dir` pin forces the context; with a pin, `cd` keeps the pinned store — the repo-key switch on cd is unit-tested).
2. `agentide gateway status` typed inside the shell works (prefix stripped); bare `agentide` inside the shell prints `(you are already in the agentide shell — type help)`.
3. Ctrl-C clears the current line; it does not kick the operator out of the shell.

> **2026-08-09 (surgical fix D-120 + D-121):** two shell-hardening notes. **(1) Quotes:** arguments may be wrapped in single/double quotes — pairs are stripped and whitespace inside quotes groups into ONE argument (`--scope '*'` → scope `*`; `--args '{"a":1}'` → one JSON token). No escapes in v1; an unterminated quote prints a friendly error and stays in the shell. **(2) Ctrl-C is enforced at PROCESS level** for the whole shell lifetime (not just readline), so even while a long-running command (e.g. `watch`) is dispatching — after its own one-shot SIGINT handler has fired — a further Ctrl-C can never hit the process default and kill the shell.

> **2026-08-09 (surgical fix D-122):** two output-rendering hardenings. **(1) Dispatch output is newline-terminated** like one-shot mode (CID:cli-014 parity): results such as `[]` or `}`-ended JSON previously lost their final line when the prompt redrew on the same row — visible as `invoke client.list` printing "nothing". **(2) `clear` now wipes the scrollback too** (`\x1b[2J\x1b[3J\x1b[H`) so captured/terminal rows don't linger.

## Simulation Contract

The post-impl sim (`simulate.sh`) must demonstrate every scenario above. The pre-impl sims (`simulate-pre.sh` + `simulate-pre.html`, design-time, user-approved 2026-08-08) get archived after drift is settled.

```bash
# Scenario 1/2: bare agentide
agentide                          # TTY → agentide> shell; non-TTY → help, exit 0
# Scenario 3: tree + group-with-no-subcommand + unknown subcommand
agentide gateway                  # → subcommand list, exit 0
agentide gateway bogus            # → unrecognized subcommand, exit 2
# Scenario 4: old names
agentide status                   # → runs + stderr note 'use agentide gateway status'
# Scenario 5: split
agentide tenant list --url ws://x # → refused, exit 1
agentide gateway status           # gateway down → "gateway not running", exit 1
agentide capability list          # disk by default; --url → live
# Scenario 6: rehomed gateway commands carry today's flags
agentide gateway start --data-dir /tmp/x --all-doors
agentide gateway stop
agentide gateway status            # gateway down → "gateway not running", exit 1
# Scenario 7/8 (shell, via scripted stdin):
#   gateway sta<Tab> → inserted; arrow-up recalls last command; clear; 
#   "agentide gateway status" tolerated; Ctrl-C does not exit
```

## Technical Design

### Data Models

- **Command tree** (new `packages/agentide/src/cli-tree.ts`): static table `{ group: { subcommand: { description, flags?, world: "offline" | "live" | "dual" } } }` + `OLD_NAME_NEW` map (`start/stop/status/health → gateway.*`, `sessions → session list`, `capabilities → capability list`, `plugins → plugin list`).
- **Shell state**: resolved from `dataDir = AGENTIDE_DATA_DIR ?? ./ .agentide/data` per cwd (existing convention). No new state files beyond `shell-history` (plain text, one command per line, deduped consecutive).
- **Tree naming maps 1:1 to capability families** (gateway.*, tenant.*, client.*, plugin.*, session.*, auth.token.*) per GRILL Q6.

### API Contracts

- `runCliInner` (cli.ts:232) — the 15-way switch at cli.ts:251 becomes tree-driven: `cmd` → group lookup → subcommand dispatch. Existing handlers (`runInit`, `runDetachedStart`/`runStop` from start.ts, `runTenant`, `runToken`, `runClient`, `runCapability`, `runPlugin`, `runConsumer`) stay; dispatch order changes, signatures mostly unchanged.
- New `runShell(dataDir, opts)` — interactive loop (readline), resolves `./.agentide/data` per cwd on `cd`.
- Exit codes: keep the existing ladder — 0 ok, 1 error/live-down/refusal, 2 unknown command/subcommand (unchanged from cli.ts:286); non-TTY bare → help + 0. Remote commands keep the consumer ExitCode 0..5 ladder (exit-codes.ts) untouched.
- `buildHelp()` (cli.ts:116) rewritten to the new tree; `agentide <group> --help` and bare-group show the group's list.

### Dependencies

No new external deps. Node built-ins only: `node:readline` (shell), `node:fs/promises` (history file), existing `node:path`. Shell history uses bash-like `readline` via the Node `readline` module; no readline-native Tab insertion is needed (custom completer callback).

### Architecture Notes

- Shell and one-shot share the same dispatch core: one line from the shell = one argv array into the same tree dispatcher (the pre-impl sim's `run_line` pattern). Prefix stripping (`agentide gateway status`) and `--data-dir`/`--url` defaulting from the shell's context happen at the shell boundary, not inside handlers.
- Local-vs-remote is decided once per group in the dispatcher (offline/live/dual table + refusal checks), not per handler.
- Deprecation notes: one wrapper point in the dispatcher (match old name → run mapped command + emit stderr note), not scattered per handler.
- `packages/agentide/src/cli.ts` is 733 lines — over the AGENTS.md 350 cap (D-68, pre-existing). This pack splits it: `cli-tree.ts` (tree table + group help), `shell.ts` (interactive shell), and keeps the dispatcher + handlers in `cli.ts`. Splitting is part of this pack's scope because the tree introduces the natural seam.
- Watch topic mapping (kept from the sim): `watch status|health` → `gateway.*`, `watch <something.with.dots>` → verbatim, else `<alias>.*` — existing consumer.ts behavior, unchanged.

## Non-Goals

- Changing gateway/capability/session/plugin behavior — CLI surface only.
- Removing one-shot invocation — both paths coexist.
- Tab completion of live capability names or filesystem paths — excluded by user lock (GRILL follow-up 1).
- Renaming capability names or flags inside groups (`tenant create --id` stays, etc.) — only the tree shape changes.
- History sharing across directories (per-dir by lock).
- Renaming `invoke`/`watch` flags or adding new flags anywhere.
- Changing remote consumer exit codes or the W1–W6 wire surface.

## Out of Scope (Future)

- `gateway logs` / `gateway metrics` real output depth — metrics/version subcommands land with today's stub-ish depth; real implementations are separate packs.
- Removal of old names — explicitly the release AFTER this one (Q3 lock).
- Fuzzy/flex search in the shell, multi-line commands, shell scripting mode (`agentide -c "..."`).
- A `daemon` subcommand consolidating start/stop/status.

## References

- `docs/features/cli-restructure/GRILL-cli-restructure.txt` — locked decisions Q1–Q8 + follow-up locks
- `docs/features/cli-restructure/simulate.sh` — post-impl sim (canonical, drives the real CLI; update this one, not the archived originals)
- `docs/features/cli-restructure/archive/simulate-pre.sh` + `archive/simulate-pre.html` — pre-impl design sims (user-approved 2026-08-08, archived after drift settled)
- `packages/agentide/src/dispatcher.ts` — tree dispatcher + world refusals (L-comments)
- `packages/agentide/src/shell.ts` — interactive shell
- `packages/agentide/src/consumer.ts` — remote consumer commands
- `packages/agentide/src/exit-codes.ts` — the 0..5 ladder (unchanged)
- `docs/drift.md` — D-68 (cli.ts > 350 lines, closed by this pack's split), D-117 (status rehome), D-118 (init not tenant-idempotent, open)
