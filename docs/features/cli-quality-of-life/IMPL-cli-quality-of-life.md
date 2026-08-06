# IMPL: cli-quality-of-life

**Slug:** cli-quality-of-life
**Status:** Complete
**Date:** 2026-08-06

## Phase Plan

4 phases, all surgical. Phases 1-2 are independent. Phases 3-4 are independent. Phases can ship in any order; the IMPL orders them by risk-isolation (filesystem safety first, then pid format, then exit codes, then help text).

### Phase 1: D-78 — `init` mkdir (cli.ts:runInit)

**Build:**
- `packages/agentide/src/cli.ts:runInit` (L292) — at the top, after tenant-id parsing, do `await mkdir(dataDir, { recursive: true })`. Import `mkdir` from `node:fs/promises` at the top of the file.
- New unit test `packages/agentide/src/__tests__/cli-init.test.ts`: 3 cases — fresh dir (mkdir happens), existing dir (no-op), InMemoryFs (mock the mkdir call).

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/cli-init.test.ts` — 3 tests pass.
- [ ] Manual: `rm -rf /tmp/ag-init-fresh && agentide init --data-dir /tmp/ag-init-fresh --default-tenant acme` succeeds, exit 0, token printed.
- [ ] Manual: re-run the same command (dir exists) — succeeds, no error.

**Blocked by:** nothing.

### Phase 2: D-81 — pid file as JSON (lifecycle.ts + start.ts + cli.ts:runStatus)

**Build:**
- `packages/agentide/src/lifecycle.ts:writePidFile(path, pid, dataDir, startedAt)` — new signature. Writes `{"pid":...,"dataDir":...,"startedAt":...}\n` with mode 0o644. `startedAt` is an ISO 8601 string.
- `packages/agentide/src/lifecycle.ts:readPidFile(path)` — returns `null | { pid, dataDir, startedAt } | { pid }` (legacy). Try JSON parse first; if it fails, try `parseInt`; if that fails, return null.
- `packages/agentide/src/start.ts:runDetachedStart` (L337) — pass `dataDir` and `new Date().toISOString()` to `writePidFile`.
- `packages/agentide/src/cli.ts:runStatus(dataDir, opts, pidFile?)` — new optional `pidFile` arg. If supplied and the file has a `dataDir` field, override the function's `dataDir` param.
- `packages/agentide/src/cli.ts:runCli` (the `case "status"` branch, L245-249) — read the default pid file and pass it to `runStatus`. The existing `--pid-file` flag continues to work.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/lifecycle-pidfile.test.ts` (new file) — 4 cases: write+read round-trip, legacy pid file falls back, malformed file returns null, missing file returns null.
- [ ] Manual: `agentide start --data-dir /tmp/foo --no-mcp --port-sdk 7350`, then `cd / && agentide status` reads `/tmp/foo` and prints live counts.
- [ ] Manual: hand-write `1234` to the pid file, `agentide status` — falls back to the default cwd-relative data-dir (current behavior for legacy).

**Blocked by:** nothing.

### Phase 3: D-83 — `stop` rc 0 (start.ts:runStop L257)

**Build:**
- `packages/agentide/src/start.ts:runStop` (L246) — change `return result("", \`no gateway running (no pid file at ${pidFile})\n\`, 1);` to `return result("", \`no gateway running (no pid file at ${pidFile})\n\`, 0);`. One character.
- No new tests (existing `detached-start.test.ts` already covers the pid file present branch).

**Verify:**
- [ ] Manual: `agentide stop` (no gateway) → exit 0, message `no gateway running (no pid file at /tmp/agentide.pid)`.
- [ ] Manual: `agentide stop && echo "next"` → prints `next` (idempotent stop in a shell chain works).
- [ ] `pnpm --filter @spanexx/agentide test` — full suite still 975/975 pass.

**Blocked by:** nothing.

### Phase 4: D-84 — per-subcommand help (cli.ts:runClient)

**Build:**
- `packages/agentide/src/cli.ts` — new `clientHelp(sub?: string)` function near `buildHelp()` (L115-144). Returns the top-level summary when `sub === undefined`, or the per-subcommand block when `sub` is a known subcommand.
- `packages/agentide/src/cli.ts:runClient` (L430) — at the top, before `createPlatform`:
  ```ts
  if (sub === undefined || flags["help"] === true) {
    return result(clientHelp(sub));
  }
  ```
  Drop the `--data-dir` global flag from per-subcommand help (it's documented at the top level).
- `packages/agentide/src/__tests__/cli-client-help.test.ts` (new) — 4 cases: no subcommand prints summary; `create --help` prints create help; unknown subcommand falls through (existing rc 1 path); `--help` after a subcommand prints that subcommand's help.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/cli-client-help.test.ts` — 4 tests pass.
- [ ] Manual: `agentide client` → prints summary, exit 0.
- [ ] Manual: `agentide client grant --help` → prints grant-specific help, exit 0.

**Blocked by:** nothing.

## Phase Dependencies

All 4 phases are independent. They can ship in any order. The IMPL orders them by risk-isolation (filesystem safety first).

```
Phase 1 (init mkdir) ───┐
Phase 2 (pid file)    ───┤  (all independent)
Phase 3 (stop rc 0)   ───┤
Phase 4 (client help) ───┘
```

## Test Strategy

- **Unit tests:** 4 new test files (one per phase), 14 new test cases total:
  - `cli-init.test.ts` (3 cases)
  - `lifecycle-pidfile.test.ts` (4 cases)
  - `cli-client-help.test.ts` (4 cases)
  - Phase 3 (D-83) is a one-character change covered by the existing `detached-start.test.ts`; no new tests.
- **Integration tests:** none. The 975 existing tests (which include `start.test.ts`, `detached-start.test.ts`, `cli.test.ts`, `consumer.test.ts`) cover the surface these changes touch. Full suite must stay green.
- **E2E sim:** the post-impl `simulate.sh` (built in this pack) drives the real binary against a real gateway and demonstrates all 4 scenarios.
- **Run order:** per phase — write tests (RED) → implement (GREEN) → run full suite + precommit.

## Dependency Analysis (opensrc)

No new external deps. Built-ins only:
- `node:fs/promises` (mkdir) — already used by the test framework.
- `node:fs` (read/write) — already used in lifecycle.ts.

## Rollout

- All 4 phases ship in a single release (e.g. `agentide@0.3.2`).
- No migration concerns: the pid file format change (D-81) is backward-compatible — old-format pid files still parse via the legacy fallback.
- No flag flips.
- The behavior changes are operator-visible: `init` now "just works" on fresh dirs; `status` now follows the running gateway; `stop` is now idempotent in shell chains; `client` subcommands now have per-subcommand help.

## Risk Notes

- **Phase 2 (pid file format change):** the JSON pid file is human-readable. If an operator edits it manually, the JSON parse may fail; the legacy fallback handles `parseInt` for plain-number files; otherwise returns null and `status` falls back to the default data-dir. Operators get a clear "no gateway running" diagnostic in the worst case.
- **Phase 4 (per-subcommand help):** the new `clientHelp` function adds ~50 lines. The new test file adds ~80 lines. Both fit under AGENTS.md rule 9 (350 lines per file).
- **Phase 1 (mkdir):** the `mkdir({ recursive: true })` is idempotent. No risk of data loss. The `init` flow already prints the path, so the operator sees the new dir's location.
- **All 4 phases:** the 975 existing tests must still pass. The signature changes (`writePidFile` adds args; `runStatus` adds optional arg) are backward-compatible. `runStop` exit code change is a behavior change, but only in the "no gateway running" branch which currently exits 1 — operators who relied on the rc 1 were already in the broken-script territory the drift documented.
