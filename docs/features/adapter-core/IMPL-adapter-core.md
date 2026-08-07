# IMPL: adapter-core — shared door pipeline (A7: WS migration)

**Slug:** adapter-core
**Status:** Draft
**Date:** 2026-08-07

## Phase Plan

Ordered phases, each leaves the tree green. Blockers noted. No new external deps →
no opensrc run needed (Dependency Analysis skipped per IMPL-FORMAT).

### Phase 1: scaffold @spanexx/adapter-core

**Build:**
- Create `packages/adapter-core/` — `package.json` (`@spanexx/adapter-core`, private? — follow sibling door pattern; check `pnpm-workspace.yaml` glob + `tsconfig.base.json` include), `tsconfig.json` extending base, `vitest.config.ts` or rely on root config, `src/index.ts` exporting canonical re-exports only (additive, nothing imported yet).
- Contracts: PRD-TRD Scenario 1 (canonical surface); A1 own-bytes rule — doors will import ONLY this package.

**Verify:**
- [ ] `pnpm install` resolves new workspace package
- [ ] `pnpm --filter @spanexx/adapter-core build` compiles
- [ ] `pnpm vitest run packages/adapter-websocket` still green (no imports changed)

**Blocked by:** nothing (pure additive).

### Phase 2: readClaims

**Build:**
- `src/auth/readClaims.ts` (or flat) — port of MCP `decodeScopeFromToken` (`adapter-mcp/src/translate.ts:54-73`): base64url payload parse, `[]` defensiveness for empty scope, returns claims with `scope`.
- Contract: PRD-TRD Technical Design (A2/A6); Scenario 8.

**Verify:**
- [ ] New unit tests in `packages/adapter-core/src/__tests__/` (valid token, malformed, empty scope, expired-shape claims)
- [ ] `pnpm build && pnpm test` (core + WS + MCP) green

**Blocked by:** Phase 1.

### Phase 3: error converter + fallback

**Build:**
- `src/errors/converter.ts` — shared `gatewayErrorToPayload`-style converter; default fallback `-32006` + `${code}: ${message}` (A5, Option A); door-configurable via `errors: table`.
- Contract: PRD-TRD Technical Design (A5); Scenario 8.

**Verify:**
- [ ] Unit tests: mapped code → payload, unmapped → default, table override honored
- [ ] `pnpm build && pnpm test` green

**Blocked by:** Phase 1.

### Phase 4: generic RecordRegistry

**Build:**
- `src/registry.ts` — generic `RecordRegistry<T>`: `add/get/remove/snapshot/clear/count` over caller-supplied record shape (A1).
- Contract: PRD-TRD Technical Design (A1/Q2). WS `ConnectionRegistry` becomes a thin wrapper **in Phase 5**.

**Verify:**
- [ ] Unit tests with a dummy record shape + one with `ws-<n>`-style id generation
- [ ] `pnpm build && pnpm test` green

**Blocked by:** Phase 1.

### Phase 5: auth policy early mode + WS delegation

**Build:**
- `src/auth/policy.ts` — `createAuthPolicy({mode: "early"|"lazy"})` (A2); early verifies once at open, caches identity; auth-failure behavior frozen (phrases stay door-local).
- Edit `packages/adapter-websocket/src/auth.ts` — `authenticateToken` body delegates to policy, keeps exact signature + AUTH_ERROR_CODES phrases.
- Contract: PRD-TRD Scenario 4 (exports identical), A2.

**Verify:**
- [ ] WS auth tests pass **unedited** (`__tests__/auth.test.ts`)
- [ ] Core unit tests for policy early/lazy modes
- [ ] `pnpm build && pnpm test` green

**Blocked by:** Phase 3 (converter), Phase 4.

### Phase 6: response channel

**Build:**
- `src/response/channel.ts` — `ResponseChannel` (A4): `emit(chunk)`, `end(result|error)`, `event(topic,payload)`; one call id; `end` exactly once; `emit` after `end` errors; `event` only before `end`; chunks shared intermediate, packaging door-local.
- Edit `packages/adapter-websocket/src/invoke.ts` — parse + render delegates to core; WS channel renders `invoke.partial`/`invoke.end`.
- Contract: PRD-TRD Technical Design (A4); Scenario 5 (wire bytes).

**Verify:**
- [ ] WS invoke tests pass **unedited**
- [ ] Core unit tests: terminal guarantees (`end` once, `emit` after `end` throws, `event` order)
- [ ] `pnpm build && pnpm test` green

**Blocked by:** Phase 5.

### Phase 7: createAdapterPipeline wiring

**Build:**
- `src/pipeline.ts` — `createAdapterPipeline({gateway, config, input, output, errors, response})` (A1); imports `@spanexx/gateway-core` at runtime; emits **no events**.
- Edit `packages/adapter-websocket/src/server.ts` — transport lifecycle stays, invocation path uses pipeline handlers (handles close codes 1008/1009/1011 unchanged).
- Contract: PRD-TRD Scenario 3 (sim 31/31), Scenario 5 (wire bytes), Scenario 6 (consumers).

**Verify:**
- [ ] WS server tests pass **unedited**
- [ ] Sim: `node packages/adapter-websocket/scripts/simulate-websocket-adapter.mjs` → 31/31
- [ ] `pnpm build && pnpm test` green across WS + agentide (CLI consumer)

**Blocked by:** Phase 6.

### Phase 8: capability lookup (ships unwired)

**Build:**
- `src/capabilities/lookup.ts` — `createCapabilityLookup` (A6): `list(token)`, `describe(name, token)`; scope from `readClaims(token).scope`; tier filtering delegated to kernel `capability.list` (`factory.ts:554-570`); empty scope → `[]`.
- **Not wired** into WS frames (no discovery frame).
- Contract: PRD-TRD Scenario 8; A6 byte-identical note.

**Verify:**
- [ ] Core unit tests: list filters by scope, describe returns entry, empty scope → `[]`
- [ ] `pnpm build && pnpm test` green
- [ ] WS exports diff vs pre-migration: identical (Scenario 4)

**Blocked by:** Phase 2 (readClaims).

## Phase Dependencies

```
1 scaffold → 2 readClaims ──> 8 lookup
          → 3 converter ──> 5 policy ──> 6 channel ──> 7 pipeline
          → 4 registry ────┘
```
Phases 2–4 independent once scaffold lands; 5 needs 3+4; 6 needs 5; 7 needs 6; 8 needs 2.

## Test Strategy

- **Core:** new `packages/adapter-core/src/__tests__/*.test.ts` — one file per moved
  primitive (readClaims, converter, registry, policy, channel, lookup, pipeline).
  TDD per phase: write failing test → implement → green.
- **WS:** existing suite is the migration oracle — `__tests__/` and `client.ts` must
  receive **zero edits**. Full run: `pnpm vitest run packages/adapter-websocket`.
- **Gate after every phase:** `pnpm build && pnpm test` (whole repo) + after Phase 7
  the wire sim 31/31.
- **MCP:** untouched until A8 — its suite must stay green (readClaims is a port, not
  a replace).

## Dependency Analysis (opensrc)

Skipped — zero new external deps. adapter-core imports only workspace packages
(`@spanexx/errors`, `@spanexx/gateway-core`) per A1.

## Rollout

Migration strategy: **extract-and-delegate**, not move-and-rewire. Internal files
tests import directly keep signatures; bodies delegate to core. adapter-core ships as
a new workspace package; `packages/adapter-websocket/package.json` gains the
dependency. Release: new package bumps independently (release-please config update
comes with its own commit — flag for the ci-cd skill).

## Risk Notes

- **Test-import surface:** any internal file a test imports directly must keep its
  export names + signatures — a rename silently breaks the zero-edit gate. Grep
  `__tests__/*.test.ts` imports per file before editing it.
- **Wire byte drift:** invoke/auth rendering must stay byte-identical — the sim's 31
  assertions + PRD Scenario 11 are the tripwire. No refactors of string building.
- **Close codes:** 1008/1009/1011 + `WS_ERROR_CODES` are door bytes (A5) — never move
  the table itself, only the converter.
- **Package scaffolding:** check `pnpm-workspace.yaml` glob includes the new dir and
  whether `tsconfig.base.json` needs an entry — sibling doors (`adapter-mcp`,
  `adapter-websocket`) are the pattern to copy.
- **release-please:** new package needs config + version bump; that's a separate
  release concern, not part of this pack's phases.
