# Handoff: cli-restructure Phase 1 COMPLETE

**Date:** 2026-08-08
**Pack:** `agentide/docs/features/cli-restructure/`
**CWD:** `/home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide`

## TL;DR

Phase 1 (tree + dispatcher refactor) is COMPLETE and green. Old-name routing is live (`status` → live-only `gateway status`). The pre-existing `status` tenantCount bug (D-117) was RESOLVED-by-restructure (local path deleted); a new low finding D-118 (init double-registers the default tenant) was surfaced and logged.

**Post-impl review (2026-08-08, `.reports/20260808-184933-drift-cli-restructure.md`) found Major Drift and it was FIXED in this session:** the new group-form live commands (`agentide gateway status|health|metrics|version`, `plugin list --url`, `session list`) errored `unrecognized remote command: <group>` (exit 2) — `consumer.ts`'s ALIASES only knew legacy one-word names. Fixed via `resolveAlias` + `metrics`/`version` aliases; 6 new live-adapter tests pin the group forms. Verified dynamically against the real gateway (127.0.0.1:7300) — all group forms exit 0 with correct payloads. **Awaiting user commit (manual commits per AGENTS.md rule 7).**

## Files changed this session

| File | Status | Notes |
|---|---|---|
| `packages/agentide/src/cli-tree.ts` | NEW (188 ln) | GROUPS + OLD_NAME_NEW + worldOf + groupHelp. CIDs cli-tree-001..008. |
| `packages/agentide/src/__tests__/cli-tree.test.ts` | NEW (~270 ln) | 30 tests: tree integrity, worlds, groupHelp, dispatch (bare/unknown/old-name/unimplemented). CIDs cli-tree-001/009. |
| `packages/agentide/src/cli.ts` | modified (~740 ln) | `let cmd`/`let positional`; OLD_NAME_NEW rewrite; generic GROUPS dispatch for all 7 groups; slimmed switch (init/invoke/watch only); DELETED runStatus + defaultPidFile (S6). CIDs cli-tree-010..014. |
| `packages/agentide/src/__tests__/cli.test.ts` | modified | `status` test rewritten: old name is live-only → exit != 0 via dead --url. |
| `packages/agentide/src/__tests__/integration.test.ts` | modified | 3 status probes → `tenant list` (acme/beta persistence); idempotent test pins acme x2 + D-118 NOTE. |
| `agentide/docs/drift.md` | modified | D-117 → RESOLVED (local status path deleted); D-118 added (init not tenant-idempotent, Low). Open 36 / Resolved 67. |
| `agentide/docs/features/cli-restructure/IMPL-cli-restructure.md` | modified | Status: Phase 1 COMPLETE + 5 delivery notes (5th = review fix). |
| `packages/agentide/src/consumer.ts` | modified (review fix) | CID:consumer-007 `resolveAlias` (group form → alias) + `metrics`/`version` aliases (gateway.metrics, system.version) + watch-alias message update. |
| `packages/agentide/src/cli-tree.ts` | modified (review fix) | `gateway version` description: `(gateway.version)` → `(system.version)`. |
| `packages/agentide/src/__tests__/cli.test.ts` | modified (review fix) | +6 live-adapter group-form tests (Gap 2). |
| `.reports/20260808-184933-drift-cli-restructure.md` | NEW (review) | Sub-agent drift report — Major Drift, record only. |
| `docs/handoff/cli-restructure-phase1-slices-1-2.md` | superseded | This file replaces it. |

## Dispatch behavior now (Phase 1)

- `agentide <group>` (bare) → groupHelp, exit 0
- `agentide <group> <unknown>` → `error: unrecognized subcommand: <sub>` + groupHelp, exit 2  (worded "unrecognized" because check-banned-types.sh bans `: unknown`)
- `agentide <group> <sub> --help` → handler-owned per-sub help (D-84)
- `agentide gateway start|stop` → pid-file/spawn handlers; `status|health|metrics|version` → consumer (live-only)
- `agentide tenant|client|token <sub>` → existing handlers
- `agentide capability list` / `plugin list` → dual (hasUrlSource ? consumer : disk)
- `agentide session list` → consumer ("sessions" alias); other session subs → "not implemented in v1" exit 1
- `agentide plugin install|uninstall|enable|disable|reload` → "not implemented in v1" exit 1
- Old names `start|stop|status|health|sessions|capabilities|plugins` → mapped via OLD_NAME_NEW (no stderr note yet — Phase 4)
- Top-level `init|invoke|watch` unchanged

## Verification

| Check | Result |
|---|---|
| `pnpm exec vitest run` | 1159 pass / 2 pre-existing fails (release-yml-005 + consumer-ux url-default — unchanged from session start) |
| typecheck | clean |
| lint | clean |
| targeted (cli-tree/cli/integration/consumer) | 103/103 pass |
| dynamic live check (real gateway 127.0.0.1:7300) | `gateway status/health/metrics/version` exit 0 + correct payloads; `session list` 2 archived rows; `plugin list --url` exit 0; old names still work |

## Commits for the user (Conventional Commits, in order)

```
feat(agentide): add CLI command tree (cli-tree.ts) — table-driven dispatch

GROUPS (gateway/tenant/client/capability/plugin/session/token) +
OLD_NAME_NEW map (start/stop/status/health/sessions/capabilities/plugins)
+ worldOf + groupHelp. Single source of truth per PRD-TRD S3/S4/S5.
Tests: 30/30 cli-tree.test.ts; full suite 1153 pass / 2 pre-existing fails.

Refs: docs/features/cli-restructure/PRD-TRD-cli-restructure.md
```

```
refactor(agentide): tree-driven runCliInner — all groups dispatch via GROUPS

Bare group → groupHelp exit 0; unknown sub → exit 2; known sub → handler.
gateway status/health/metrics/version → live-only consumer (PRD-TRD S6);
old names route through OLD_NAME_NEW (stderr note in Phase 4). Deleted the
in-process runStatus/defaultPidFile paths (S6) — resolves D-117.

Refs: docs/features/cli-restructure/IMPL-cli-restructure.md Phase 1
```

```
test(agentide): pin post-restructure surface — status live-only, tenant list for persistence

- cli.test.ts: old `status` now live-only (exit != 0 without a gateway)
- integration.test.ts: tenant probes via `tenant list` (acme/beta survive
  restart); init twice → acme x2 (D-118, init not tenant-idempotent)
- drift.md: D-117 resolved (local status path deleted), D-118 added

Refs: docs/drift.md D-117, D-118
```

```
fix(agentide): group-form live commands reach the consumer (drift review Gap 1)

`agentide gateway status|health|metrics|version`, `plugin list --url`,
`session list` errored "unrecognized remote command: <group>" (exit 2) even
against a live gateway — consumer.ts's ALIASES only knew legacy one-word
names. Add resolveAlias (group form → alias) + metrics/version aliases
(gateway.metrics, system.version); fix gateway version description in the
tree. Verified live against the real gateway (127.0.0.1:7300).

Refs: .reports/20260808-184933-drift-cli-restructure.md
```

```
test(agentide): pin group-form live dispatch against a live adapter (Gap 2)

6 new tests in cli.test.ts drive gateway status/health/metrics/version,
session list, plugin list --url against a real websocket adapter; metrics
and version assert the invoked capability name. Dead-endpoint tests alone
passed for the wrong reason (connect fails before alias resolution).

Refs: .reports/20260808-184933-drift-cli-restructure.md
```

## Next session

1. User commits the 3 messages above.
2. **Phase 2** (IMPL L33-45): world-refusal helpers + `gateway not running` pid-file message. New tests `cli-split.test.ts`. Watch: `capability describe` world is "live" in the tree but runs in-process — Phase 2's live-refusal would break it; decide (defer describe refusal or re-world it).
3. Phase 3: buildHelp rewrite; Phase 4: deprecation notes; Phase 5: shell; Phase 6: post-impl sim.
4. Pre-impl sim comparison: `docs/features/cli-restructure/simulate-pre.sh` exists — post-impl sim (Phase 6) must demonstrate the same scenarios with the real binary.

## Residue / caution flags

- **Watch the revert phenomenon:** several edits to cli.ts/integration.test.ts were reverted between tool-call and next read (twice). If the user's IDE holds unsaved buffers, re-verify file state after each edit batch.
- A real gateway may run on 127.0.0.1:7300 (from earlier sessions) and real ~/.config/platform/config.toml exists — consumer-path tests MUST force `--url ws://127.0.0.1:1/ws` to be deterministic (done in the new tests).
- `cli.ts` is ~740 lines (>350 rule) — pre-existing; Phase 5 (shell) is the natural split point.
- `clientHelp` (cli.ts:520) still lives for per-sub help — not dead.
- 3 pre-existing stashes on main (not mine, untouched).

## Files to read first

- `docs/features/cli-restructure/PRD-TRD-cli-restructure.md` (spec)
- `docs/features/cli-restructure/IMPL-cli-restructure.md` (plan + Phase 1 delivery notes)
- `packages/agentide/src/cli-tree.ts` (tree data)
- `packages/agentide/src/cli.ts` (dispatcher — L232-330)
- `packages/agentide/src/__tests__/cli-tree.test.ts` (spec)
- `docs/drift.md` D-117 (resolved) + D-118 (open)
