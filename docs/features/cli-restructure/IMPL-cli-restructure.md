# IMPL: cli-restructure

**Slug:** cli-restructure
**Status:** ALL PHASES COMPLETE (1-6). P1 tree/dispatcher + review fix (group-form live dispatch, 0.8.0); P2 world refusals + "gateway not running"; P3 tree help; P4 deprecation notes; P5 interactive shell; P6 post-impl sim (20/20 PASS). CLI split into cli-tree/cli-utils/commands/client/dispatcher/shell — cli.ts < 350 lines (D-68 closed).
**Date:** 2026-08-08/09

## Phase 1 delivery notes (2026-08-08)

Built exactly per the Phase Plan below, with four documented deviations:

1. **World-refusal checks deferred to Phase 2.** Phase 1's dispatch description mentions a world check, but Phase 2 owns the refusal helpers + tests. Phase 1 keeps existing behavior (no `--url` refusal for offline groups yet).
2. **Deprecation stderr note deferred to Phase 4.** Old-name ROUTING is live (Slice 3); the one-release stderr note per PRD-TRD S4 lands with the Phase 4 help rewrite.
3. **`session create|resume|destroy|touch` and `plugin install|uninstall|enable|disable|reload` → "not implemented in v1" exit 1.** The tree declares the full PRD-TRD S3 surface, but v1 ships only the existing handlers (session list / plugin list). Dispatch errors clearly instead of pretending.
4. **`capability describe` stays in-process in v1** (PRD-TRD S5 marks it live; wiring to the live gateway is a follow-up — NOTE[agent] in cli.ts).
5. **Review fix (post-impl review 2026-08-08, report `agentide/.reports/20260808-184933-drift-cli-restructure.md`):** the Phase 1 plan's "consumer path via the mapped command" (L33) was never wired — `agentide gateway status|health|metrics|version`, `plugin list --url`, `session list` all failed with `unrecognized remote command: <group>` (exit 2) even against a live gateway; only the old one-word names worked. Fixed in `consumer.ts` (resolveAlias maps group form → legacy alias; `metrics`/`version` aliases added — `gateway.metrics`, `system.version`), `cli-tree.ts` (`gateway version` description corrected to `system.version`), and 6 new live-adapter tests in `cli.test.ts` pinning the group forms (Gap 2: the old dead-endpoint tests passed for the wrong reason — connect fails before alias resolution).

## Phase 2-6 delivery notes (2026-08-09)

- **P2 (world refusals):** `refuseForWorld` gates executable dispatch (offline refuses --url/--token; live refuses --data-dir + pid-file "gateway not running" unless explicit --url). `capability describe` re-worlded to **offline** (in-process registry in v1, per note 4) so the live refusal can't break it. Top-level `init` (offline) + `invoke`/`watch` (live) get the same checks inline. `pidFile` seam added to CliOptions (deterministic tests). New `cli-split.test.ts` (13 tests).
- **P3 (help):** `buildHelp` derived from the GROUPS tree; deprecated old names listed once. Pinned help strings kept (remote section) for the migration window.
- **P4 (deprecation notes):** dispatchTokens rewrites old names + prepends ONE stderr note (exact PRD S4 wording). The parse → old-name → dispatch core extracted as `dispatchTokens` — the P5 shell seam. 7 new tests.
- **P5 (shell):** `shell.ts` — readline loop, `agentide (<dataDir>)> ` prompt, builtins exit/quit/help/history/pwd/cd/clear, prefix tolerance + "already in the shell" message, per-dir `shell-history` (consecutive dedupe, reload after cd), Tab completion (tree words + tenants from `tenants.json` — real store per Risk Note 2; caps have no disk artifact → tree-only), Ctrl-C clears line (no-op SIGINT listener, unit-pinned). stdin/stdout/env/cwd seams. 21 tests.
- **P6 (post-impl sim):** `simulate.sh` — drives the real bundled CLI through S1-S8 with pass/fail echoes; **20/20 PASS**. Ctrl-C is a soft WARN in the sim (PTY byte delivery env-dependent; unit-pinned in shell.test.ts).
- **Split (D-68):** cli.ts (861 ln) → `cli-utils.ts` (parse/help/version/result, 193), `commands.ts` (init/tenant/token/capability/plugin, 249), `client.ts` (176), `dispatcher.ts` (209), `shell.ts` (236), `cli.ts` (78). No import cycles.

D-117 (status tenantCount: 0) is RESOLVED-by-restructure: the local `runStatus`/`defaultPidFile` paths were deleted; `status` is live-only (S6). D-118 (init double-registers the default tenant) was surfaced by the same change — open, low.

## Phase Plan

6 phases, ordered so the shell (highest novelty) lands after the tree mechanics are proven. Phases 1-3 build the tree + dispatcher; phase 4 rewrites help/old-name surface; phase 5 adds the shell; phase 6 builds the post-impl sim. Each phase keeps the full suite green.

### Phase 1: tree table + dispatcher refactor (cli-tree.ts)

**Build:**
- New `packages/agentide/src/cli-tree.ts` — the static command tree per PRD-TRD S3/S5:
  - `GROUPS: Record<string, { subs: Record<string, SubDef>, world: "offline" | "live" | "dual" }>` — `gateway` (start/stop/status/health/metrics/version, live; start/stop actually offline-ish pid-file ops — see Risk Note 1), `tenant`/`client`/`token` (offline), `capability` (list dual, describe live), `plugin` (list dual, install/uninstall/enable/disable/reload live), `session` (live), top-level `init`/`invoke`/`watch`.
  - `OLD_NAME_NEW` map per PRD-TRD S4: `start|stop|status|health → gateway.*`, `sessions → session list`, `capabilities → capability list`, `plugins → plugin list`.
  - `groupHelp(group)` — the group-with-no-subcommand list (PRD-TRD S3).
- `packages/agentide/src/cli.ts:runCliInner` (L232-292) — replace the 15-way switch with tree-driven dispatch:
  - top-level: `init`, `invoke`, `watch` unchanged (their existing handlers).
  - group command: look up `GROUPS[cmd]`; missing sub → `groupHelp` exit 0; unknown sub → exit 2 with the group's list; known sub → world-check (offline: refuse `--url`/`--token`; live: refuse `--data-dir`, `--url`-less → require_live via pid file "gateway not running" message) then call the existing handler.
  - `capability list` / `plugin list` dual-mode: keep the existing `hasUrlSource` check (cli.ts:271) → consumer vs disk.
  - `gateway status/health/metrics/version` → consumer path via the mapped command (status was already dual-mode; per PRD-TRD S6 it becomes live-only).
  - old names → run the mapped command + one stderr deprecation note (PRD-TRD S4).
- New `packages/agentide/src/__tests__/cli-tree.test.ts` — tree table integrity (every group/sub in PRD-TRD S3 exists, worlds match S5), old-name map completeness.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/cli-tree.test.ts` — new tests pass.
- [ ] `pnpm --filter @spanexx/agentide test` — full suite green (existing cli.test.ts covers today's surface; only the switch internals moved).
- [ ] `pnpm --filter @spanexx/agentide typecheck` + lint.

**Blocked by:** nothing.

### Phase 2: local-vs-remote refusal + gateway-not-running message

**Build:**
- `packages/agentide/src/cli-tree.ts` — `worldOf(cmd, sub)` helper: returns the world + the checks.
- `packages/agentide/src/cli.ts` — refusal helpers: offline command + `--url`/`--token` flag → `result("", "error: <cmd> is offline (data-dir) — remove --url/--token\n", 1)`; live command + `--data-dir` → analogous error; live command without `--url`/config → pid-file check (`readPidFile` from lifecycle.ts, cli.ts:372) → missing/dead → `error: gateway not running (start it with: agentide gateway start)` exit 1 (PRD-TRD S5). Never surface ECONNREFUSED (consumer's own message is already pre-flight; but the offline-gateway case must be caught BEFORE the connect attempt).
- New tests in `cli-tree.test.ts` or `__tests__/cli-split.test.ts` — refusal per world, gateway-not-running wording, exit 1 each.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/cli-split.test.ts` — pass.
- [ ] Manual: `agentide tenant list --url ws://x` → refused, exit 1. `agentide gateway status` (no gateway) → "gateway not running", exit 1. `agentide capability list --data-dir /tmp/x` → refused, exit 1.
- [ ] Full suite green.

**Blocked by:** Phase 1.

### Phase 3: group help + per-command help

**Build:**
- `packages/agentide/src/cli.ts:buildHelp` (L116-145) — rewrite the Usage block to the new tree (PRD-TRD S3). Keep `--version`, remote section (invoke/watch), common flags, config note.
- `groupHelp` already built (P1) — wire `--help`/bare-group through it (PRD-TRD S3: "group with no subcommand prints just that group's subcommand list").
- `gateway --help` + `agentide gateway` → the gateway subcommand list; same for every group.
- New test in `cli-tree.test.ts` — `agentide gateway` → list, exit 0; `agentide gateway --help` → same; `agentide` bare non-TTY → full help, exit 0 (PRD-TRD S2 — existing behavior kept, pin it with a test if not present).

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test` — green.
- [ ] Manual: `agentide gateway`, `agentide tenant`, `agentide plugin` — each prints its subcommand list, exit 0.

**Blocked by:** Phase 1.

### Phase 4: old-name deprecation notes

**Build:**
- `packages/agentide/src/cli.ts` — old-name branch: resolve via `OLD_NAME_NEW`, run the mapped command, then prepend stderr `note: '<cmd>' is deprecated — use 'agentide <mapped>' (removed next release)\n` (PRD-TRD S4). Exactly one note per invocation; stdout untouched (scripts parse stdout).
- `start`/`stop`/`status`/`health` top-level → these notes; `sessions`/`capabilities`/`plugins` → notes to their mapped group subs (they currently route to `runConsumer` — mapped target must preserve the consumer path).
- New tests in `cli-tree.test.ts` — each old name: command still works, one note on stderr, correct mapped name in the note.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test` — green (existing tests asserting old names still pass — they keep working, only stderr gains a line; check cli.test.ts for strict stderr assertions and update if the note is expected).
- [ ] Manual: `agentide status` → runs + note names `agentide gateway status`; `agentide sessions` → runs + note names `agentide session list`.

**Blocked by:** Phase 1.

### Phase 5: interactive shell (shell.ts)

**Build:**
- New `packages/agentide/src/shell.ts` — `runShell(dataDir, opts)`. Node `node:readline` (interface with `history` enabled), prompt `agentide>` (PRD-TRD S1).
- One line in → one dispatch into the same tree dispatcher (share `runCliInner`'s dispatch core — extract a `dispatchTree(argv, {dataDir, opts})` used by both one-shot and shell). Shell boundary handles:
  - builtins `exit`/`quit`/`help`/`history`/`pwd`/`cd <dir>`/`clear` (PRD-TRD S1, S8).
  - `cd` re-resolves dataDir from the new cwd + reloads history file (S8).
  - prefix tolerance: strip leading `agentide `; bare `agentide` → `(you are already in the agentide shell — type help)` (S8).
  - history: per-dir file `<dataDir>/shell-history`, one command per line, consecutive dedupe; loaded at start + after cd; saved per line (S7/S8).
  - Tab completion via readline `completer`: tree words + tenant/capability names from `<dataDir>/tenants.txt`/`caps.txt`… (see Risk Note 2) — inserts the unique match, lists on ambiguity, no live round-trip, no paths (S7).
  - Ctrl-C (SIGINT) clears the line, does not exit; Ctrl-D (EOF) exits.
- `packages/agentide/src/cli.ts:runCliInner` — bare `agentide` (cmd undefined, no --help/--version): `process.stdin.isTTY` → `runShell`; else → `buildHelp()` exit 0 (PRD-TRD S1/S2). TTY detection needs `opts` to expose stdin (check `CliOptions` in cli-types.ts — add `stdin` seam like the `home` seam; bin.ts pass-through).
- New `packages/agentide/src/__tests__/shell.test.ts` — scripted stdin (non-TTY seam) drives: builtins, dispatch, prefix tolerance, history file write + reload, clear, Tab completion insertion (inject a custom input object or test the completer function directly), Ctrl-C-then-continue via crafted input, exit codes.
- CliOptions: add `stdin` (or `isTTY` override) seam — needed for TTY-vs-non-TTY testing.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/shell.test.ts` — pass.
- [ ] Manual (real TTY): `agentide` → shell; `gateway start`, `gateway sta<Tab>`, arrow-up recalls, `cd /tmp/other && pwd`, `agentide gateway status` works, `clear`, Ctrl-C stays in, `exit` leaves.
- [ ] Manual (non-TTY): `echo "" | agentide` → help, exit 0.
- [ ] Full suite + typecheck + lint green.

**Blocked by:** Phase 1. Builds on P1's shared dispatcher.

### Phase 6: post-impl simulation (simulate.sh)

**Build:**
- `docs/features/cli-restructure/simulate.sh` — drives the real bundled CLI (`packages/agentide` dist or `agentide` global) against a scratch dir + live gateway (start via `agentide gateway start --data-dir <scratch> --no-mcp --port-sdk <free>`, or in-process platform if the binary can't detach in CI — check `start.test.ts`/`detached-start.test.ts` patterns). Demonstrates every PRD-TRD scenario (S1-S8) per the Simulation Contract block, with pass/fail echoes and exit 0 on full pass.
- Shell scenarios via piped stdin (non-TTY is fine for shell feature-testing? — see Risk Note 3: if the shell requires TTY, the sim uses `script -qec` like the pre-impl verification did).
- `simulate-pre.sh` + `simulate-pre.html` move to `docs/features/cli-restructure/archive/` AFTER drift check (Phase 5 of the pipeline) — not before.

**Verify:**
- [ ] `bash docs/features/cli-restructure/simulate.sh` — all scenario echoes PASS, exit 0.
- [ ] Run pre-impl sim + post-impl sim side by side — no unexpected divergence in the 8 scenarios.

**Blocked by:** Phases 1-5.

## Phase Dependencies

```
P1 (tree+dispatcher) ──► P2 (split refusal) ──► P3 (help)
     │
     ├──► P4 (old names)                     (P3/P4 independent of P2)
     └──► P5 (shell) ──► P6 (sim)
```

P2, P3, P4 all depend only on P1 and are mutually independent; ordered by risk (refusals first). P5 depends on P1's shared dispatcher (and benefits from P3's help). P6 needs everything.

## Test Strategy

- **New unit files:** `cli-tree.test.ts` (P1-P4: table integrity, split refusals, group help, old-name notes), `shell.test.ts` (P5: builtins, dispatch, history, Tab completer, prefix, Ctrl-C). ~25-35 new cases.
- **Existing tests:** `cli.test.ts`, `start.test.ts`, `detached-start.test.ts`, `consumer.test.ts`, `cli-client-help.test.ts`, `cli-init.test.ts`, `cli-stop.test.ts` must stay green — they pin today's behavior; where the tree rehomes a command, update the test's argv (same output contract, new group name) only if the assertion is on the old shape.
- **TTY seam:** `CliOptions` gains a stdin/isTTY seam (mirrors the `home` seam pattern, CID:cli-013) so shell-vs-help is unit-testable.
- **E2E:** post-impl `simulate.sh` (P6) drives the real CLI end to end.
- **Run order per phase:** RED (write test) → GREEN (implement) → full suite + `pnpm --filter @spanexx/agentide typecheck` + lint + `check-banned-types.sh` (repo precommit convention).

## Dependency Analysis (opensrc)

No new external deps. `node:readline` (built-in) for the shell; existing `node:fs`/`node:path`. No opensrc needed.

## Rollout

- Single release (e.g. `agentide@0.8.0`). Old names keep working with notes (P4) — this IS the migration window; removal happens in the next release per GRILL Q3.
- Flag compatibility: all existing flags (`--data-dir`, `--pid-file`, `--all-doors`, `--port-*`, `--foreground`, `--url`, `--token`, `--json`, `--config`, `--no-save`) keep their meaning — only the command path changes.
- Config file (`gateway_url` + `token`) unchanged — zero-flag remote keeps working.
- Pid file format unchanged (already JSON from cli-quality-of-life).

## Risk Notes

1. **`gateway start`/`stop` world:** they're pid-file/disk ops, not websocket ops — but PRD-TRD S5/S6 lock the gateway group as live-facing. Implementation: `gateway stop` works with no gateway up (rc 0, D-83); `gateway start` is the detached-spawn path (needs no running gateway). Only `gateway status/health/metrics/version` + `capability describe` + `session *` + `plugin` mutators do the live check. The world table should encode this per-sub (status/health/metrics/version = live; start/stop = offline-ish; document in `worldOf`).
2. **Tab completion source:** tenant/capability names come from the data-dir files. The real CLI stores tenants in gateway state, not `.txt` files — the shell must read the real sources: tenant list via the gateway's `listTenants()` (in-process, like `runStatus`) or a `data-dir`-side artifact if one exists. Verify at P5: read `<dataDir>` contents (existing files) rather than inventing `tenants.txt` (that was sim-only). If no disk artifact exists, fall back to tree-only completion + document the lock's intent (state names when available).
3. **TTY in sim:** Node `readline` works on pipes (non-TTY) — the shell will run under piped stdin, so `simulate.sh` can feed it directly; no `script` wrapper needed unless echo/ANSI behavior matters. Verify during P5; use `script -qec` if piped stdin breaks the interface.
4. **cli.ts line count:** stays over 350 until P4/P5 land (D-68); the P5 extraction of `shell.ts` + P1's `cli-tree.ts` split is what brings it under. Don't reorder phases or the cap check (AGENTS.md rule 9) fails mid-pack — acceptable since the pack's own plan includes the split, but run the check at the end.
5. **Old-name stderr note vs tests:** several existing tests assert exact stderr. P4 must update those assertions (note appended) — grep `stderr` in `__tests__` before wiring the note.

## Status Updates

- Phase 1: ✅ Complete (tree + dispatcher + old-name routing; review fix: group-form live dispatch) — shipped in agentide 0.8.0
- Phase 2: ✅ Complete (world refusals + gateway-not-running, cli-split.test.ts)
- Phase 3: ✅ Complete (tree-derived buildHelp)
- Phase 4: ✅ Complete (one stderr deprecation note per old name)
- Phase 5: ✅ Complete (interactive shell, shell.test.ts)
- Phase 6: ✅ Complete (simulate.sh 20/20 PASS)
