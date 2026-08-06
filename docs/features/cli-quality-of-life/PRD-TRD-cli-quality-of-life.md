# PRD-TRD: cli-quality-of-life

**Slug:** cli-quality-of-life
**Status:** Draft
**Date:** 2026-08-06
**Parent:** agentide-cli-consumer (row 28); follows the cli-consumer-ux pack (commit 1a6bfca).

## Why This Exists

Four operator-facing drifts in `docs/drift.md` were intentionally deferred from cli-consumer-ux (they were tagged "Owner: agentide CLI pack (next)"):

* **D-78 (High):** First-run UX is broken. `agentide init --data-dir <fresh>` returns `ENOENT` and the operator must `mkdir -p` first. The CLI is the bootstrap path — it must be self-sufficient.
* **D-81 (Medium):** `agentide status` from any cwd other than where `start` was run fails with `ENOENT ./ .agentide/data/gateway-secret` because the pid file does not track the data-dir. The pid file is the canonical artifact — it should carry the data-dir so `status` can recover it.
* **D-83 (Low):** `agentide stop` exits 0 vs 1 inconsistently for the same "nothing running" state. Operators scripting `stop && do_x` get non-zero exits in one branch but not the other.
* **D-84 (Low):** `agentide client grant` (and the other client subcommands) need different flag sets; the top-level help lists subcommands without per-subcommand flags. The operator guesses.

This pack is a small, surgical fix to all four. No new surface, no new dependencies, no consumer-websocket changes.

## Behavioral Spec

### Scenario 1: `init` against a non-existent data dir succeeds (D-78)

**Given** `/tmp/agentide-cli-test/fresh` does not exist
**When** the operator runs `agentide init --data-dir /tmp/agentide-cli-test/fresh --default-tenant acme`
**Then**:
1. The CLI creates the directory (recursive).
2. The CLI prints `# Initialized Agentide in /tmp/agentide-cli-test/fresh` (existing line).
3. The CLI prints the bootstrap token, exits 0.

If the directory already exists, behavior is unchanged (the existing `init` flow).

### Scenario 2: `status` recovers the running gateway's data-dir (D-81)

**Given** the operator ran `agentide start --data-dir /tmp/foo`
**When** the operator runs `agentide status` from any other cwd (e.g. `cd /tmp && agentide status`)
**Then**:
1. The CLI reads the pid file, parses the JSON `{"pid": ..., "dataDir": "/tmp/foo", "startedAt": "..."}`.
2. The CLI uses `/tmp/foo` as the data-dir, runs `runStatus` against it.
3. Prints `tenants: ...`, `plugins: ...`, etc. with the live data.

If the pid file is missing, `status` returns `no gateway running (no pid file at /tmp/agentide.pid)` and exits 1 (unchanged from today).

### Scenario 3: `stop` unifies on rc 0 for "nothing running" (D-83)

**Given** no gateway is running
**When** the operator runs `agentide stop`
**Then**:
1. **If pid file missing:** prints `no gateway running (no pid file at /tmp/agentide.pid)`, exits 0.
2. **If pid file present, pid dead:** prints `Gateway (PID <pid>) was already not running. Pid file removed.`, exits 0.

Both branches exit 0. The stderr messages differ so the operator still sees the diagnostic. The `&&` chain in shell scripts always proceeds.

### Scenario 4: per-subcommand help for `client` (D-84)

**Given** the operator runs `agentide client grant --help` (or any client subcommand with `--help` / no subcommand)
**When** the CLI parses the command
**Then**:
1. `agentide client` (no subcommand): prints the per-subcommand summary and exits 0.
2. `agentide client create --help`: prints the per-subcommand help for `create` and exits 0.
3. Same for `list`, `grant`, `revoke`, `rotate`, `redeem`.

The per-subcommand help lists only the flags each subcommand takes. The current top-level summary (`agentide client {create|list|grant|revoke|rotate|redeem} [...]`) stays unchanged on the root help screen.

## Simulation Contract

The post-impl sim (`simulate.sh`) must demonstrate every scenario above. The pre-impl sim (`simulate-pre.sh`, design-time with hardcoded state) will be archived after drift is settled.

```bash
# Scenario 1: init against a fresh dir
rm -rf /tmp/ag-qol-test/fresh
agentide init --data-dir /tmp/ag-qol-test/fresh --default-tenant acme
# → directory created, token printed, exit 0

# Scenario 2: status from foreign cwd
cd /tmp
agentide status
# → reads data-dir from pid file, prints live counts, exit 0

# Scenario 3: stop unifies on rc 0
agentide stop
# → "no gateway running" or "was already not running", exit 0
# then
agentide stop
# → "no gateway running" again, exit 0 (idempotent)

# Scenario 4: per-subcommand help
agentide client
agentide client grant --help
agentide client create --help
# → each prints the right per-subcommand help and exits 0
```

## Technical Design

### D-78 — `init` mkdir

`packages/agentide/src/cli.ts:runInit` (L292-321). At the top of `runInit`, after the tenant id parsing, do:

```ts
import { mkdir } from "node:fs/promises";
await mkdir(dataDir, { recursive: true });
```

Place it before `createPlatform({ dataDir, ... })`. The `init` flow's existing banner (`# Initialized Agentide in ${dataDir}`) already prints the path. No new stderr message needed.

### D-81 — pid file as JSON

`packages/agentide/src/lifecycle.ts:writePidFile / readPidFile` (L102-114). Change `writePidFile(path, pid)` → `writePidFile(path, pid, dataDir, startedAt)` (new args). The file format changes from `1234\n` to `{"pid":1234,"dataDir":"/tmp/foo","startedAt":"2026-08-06T..."}\n`.

`readPidFile` returns a discriminated union:
- `null` (no file)
- `{ pid: number, dataDir: string, startedAt: string }` (JSON parsed)
- `{ pid: number }` (legacy fallback when JSON parse fails but the file is just a number — covers pid files written by older versions)

`start.ts:runDetachedStart` (L337) calls `writePidFile(pidFile, detached.childPid, dataDir, new Date().toISOString())`.

`cli.ts:runStatus` (L324-339) signature changes to accept a `pidFile` and read the data-dir from it (or fall back to the default). The existing `dataDir` parameter is now the **default**, overridden by the pid file's data-dir when present.

The pid file `0o644` mode stays; the JSON content is small and not security-sensitive.

### D-83 — `stop` exit code

`packages/agentide/src/start.ts:runStop` (L246-268). Change line 257 from:
```ts
return result("", `no gateway running (no pid file at ${pidFile})\n`, 1);
```
to:
```ts
return result("", `no gateway running (no pid file at ${pidFile})\n`, 0);
```

The "already not running. Pid file removed." branch (returned by the "graceful/forced/already-gone" message) already returns `result(...)` with no explicit exit code, which defaults to 0. The unification is one line.

### D-84 — per-subcommand help

`packages/agentide/src/cli.ts:runClient` (L430-). At the top of `runClient`, before the `createPlatform` call, check for the help flag or missing subcommand:

```ts
const sub = subArgs[0];
if (sub === undefined || flags["help"] === true) {
  return result(clientHelp(sub));
}
```

A new `clientHelp(sub?: string)` function returns the per-subcommand help text. Each subcommand gets its own block:

```
agentide client create  --tenant <id> --name <name> [--scope <csv>] [--print] [--data-dir <path>]
agentide client list    [--tenant <id>] [--data-dir <path>]
agentide client grant   --tenant <id> --name <name> [--scope <csv>] [--ttl-min <n>] [--data-dir <path>]
agentide client revoke  --client-id <id> [--data-dir <path>]
agentide client rotate  --client-id <id> [--data-dir <path>]
agentide client redeem  --code <rc_...> [--data-dir <path>]
```

The unknown-subcommand branch at the end of `runClient` keeps its current `unknown client subcommand: <sub>` rc 1.

A small bonus: the top-level `buildHelp()` line 142 (`Run \`agentide <command> --help\` for command-specific options.`) becomes accurate for the `client` subcommand. The same dispatcher pattern can be added to `tenant`, `token`, `capability`, `plugin` in a future pack if needed.

### Dependencies

No new external deps. Built-ins: `node:fs/promises` (mkdir), `node:fs` (JSON read/write — already used).

### Architecture Notes

The four fixes are independent. No cross-file ripple beyond:
- `runStatus` signature change (adds optional `pidFile` arg) — all current call sites pass no pid file; backward-compatible.
- `writePidFile` signature change — internal; one caller in `runDetachedStart`.
- New `clientHelp` export from `cli.ts` — no other consumer.

## Non-Goals

- Per-subcommand help for `tenant`, `token`, `capability`, `plugin` — same pattern, separate pack.
- Changing the `start` command's exit codes or UX.
- Renaming the `client grant` flag set (Option C in the GRILL) — would break existing operators.
- Any change to the websocket adapter, the platform, or the SDK surfaces.
- Behavior change to `init` beyond the mkdir (e.g. auto-detecting an existing tenant and reusing it).

## Out of Scope (Future)

- `agentide session create` / `agentide session destroy` top-level aliases (from the D-79 "To fix" recommendation) — deferred; the cli-consumer-ux pack already covers the headline use case via auto-mint.
- Auto-detecting the data-dir from `~/.agentide/last-data-dir` (D-81 Option C) — current approach (pid file) is sufficient.
- A `daemon` subcommand that consolidates start/stop/status — a separate UX pack if needed.

## References

- `agentide/docs/features/cli-quality-of-life/GRILL-cli-quality-of-life.txt` — locked decisions Q1, Q2, Q3, Q4
- `agentide/docs/drift.md` — D-78, D-81, D-83, D-84 (this pack closes them), D-85..D-89 (already accepted, not in scope)
- `agentide/packages/agentide/src/cli.ts` — runInit (L292), runStatus (L324), runClient (L430+)
- `agentide/packages/agentide/src/start.ts` — runStop (L246), runDetachedStart (L335+)
- `agentide/packages/agentide/src/lifecycle.ts` — writePidFile / readPidFile (L102-114)
- `agentide/docs/testing/2026-08-06-issues.md` — original e2e findings
