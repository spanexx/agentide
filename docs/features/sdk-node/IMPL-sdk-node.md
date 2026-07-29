# IMPL: sdk-node (Backend SDK)

**Slug:** sdk-node
**Status:** Draft
**Date:** 2026-07-29

## Phase Plan

**No new external dependencies.** All work uses existing packages: `@platform/event-bus`, `ws` (already in package.json), `yaml` (already in package.json), standard `node:*` modules.

### Phase 1: package skeleton + types + config

**Build:**
- `packages/sdk-node/package.json` (new package, name `@platform/sdk-node`)
- `packages/sdk-node/tsconfig.json` (extends repo `tsconfig.base.json`)
- `packages/sdk-node/src/index.ts` — public exports: `createSdk`, `SdkConfig`, `SdkInstance`, `HandlerContext`
- `packages/sdk-node/src/types.ts` — `SdkConfig`, `SdkInstance`, `HandlerContext`, `Handler` type
- `packages/sdk-node/README.md` — short intro: install, configure, connect, register

**Verify:**
- [ ] `pnpm -C packages/sdk-node build` succeeds (no errors)
- [ ] `pnpm -C packages/sdk-node typecheck` clean
- [ ] `pnpm -C packages/sdk-node lint` clean
- [ ] `bash scripts/check-banned-types.sh` clean (no `any`, no `unknown` in non-catch position)

**Blocked by:** nothing

### Phase 2: manifest parser + handler loader

**Build:**
- `packages/sdk-node/src/manifest.ts` — read YAML/JSON, validate against schema, return `ParsedManifest` type
- `packages/sdk-node/src/handler-loader.ts` — dynamic import the handlers module, return `Record<name, Handler>` map
- `packages/sdk-node/src/__tests__/manifest.test.ts` — 6+ tests:
  - reads valid YAML manifest
  - reads valid JSON manifest
  - rejects missing `app` field
  - rejects missing `capabilities` array
  - rejects capability without `name`
  - rejects capability without `permissions`
  - rejects capability name without dot

**Verify:**
- [ ] Manifest tests pass
- [ ] Handler loader handles ESM and CJS modules
- [ ] Handler loader throws when path doesn't resolve

**Blocked by:** Phase 1 (package skeleton)

### Phase 3: WebSocket client + connect()

**Build:**
- `packages/sdk-node/src/client.ts` — `WsClient` class wrapping `ws` library
  - `open(url, token): Promise<void>` — connects, performs auth handshake
  - `close(): Promise<void>` — closes cleanly
  - `on(event, handler): void` — event subscription
  - Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, capped at 30s)
  - Emits events: `open`, `close`, `error`, `reconnect_scheduled`
- `packages/sdk-node/src/connect.ts` — `connect(sdk): Promise<void>` orchestrates client + emits `sdk.connected`
- `packages/sdk-node/src/__tests__/connect.test.ts` — 5+ tests using a mock WebSocket server

**Verify:**
- [ ] Connect tests pass (mock server, real URL failure, auth failure)
- [ ] Reconnect fires on close, with correct backoff timing (use fake timers)
- [ ] `sdk.connected` event fires with correct payload

**Blocked by:** Phase 1 (package skeleton)

### Phase 4: register() — manifest-to-Gateway round-trip

**Build:**
- `packages/sdk-node/src/register.ts` — `register(sdk): Promise<void>` reads manifest, imports handlers, registers each capability via `client.send({type: 'register.capability', payload: ...})`
- Mismatch handling: if handler not found for a manifest capability, throw with a clear error
- Emit `sdk.capability.registered` per successful registration
- `packages/sdk-node/src/__tests__/register.test.ts` — 5+ tests

**Verify:**
- [ ] Register tests pass (valid manifest, missing handler, Gateway rejection)
- [ ] Re-register on reconnect (covered by Phase 5 lifecycle test)
- [ ] Bus event `sdk.capability.registered` fires per capability

**Blocked by:** Phase 2 (manifest parser), Phase 3 (WebSocket client)

### Phase 5: invoke() — handle dispatch + result/error return

**Build:**
- `packages/sdk-node/src/invoke.ts` — `dispatch(sdk, msg): Promise<void>` parses incoming invoke message, looks up handler, calls it, returns result or error
- `HandlerContext` built per call (call.id, capability, token, sessionId, logger)
- Result sent back: `client.send({type: 'invoke.result', callId, payload})`
- Error sent back: `client.send({type: 'invoke.error', callId, code, message})`
- Emit `sdk.invoke.started`, `sdk.invoke.completed`, `sdk.invoke.failed`
- `packages/sdk-node/src/__tests__/invoke.test.ts` — 6+ tests

**Verify:**
- [ ] Invoke tests pass (success, error, missing handler, async handler)
- [ ] Bus events fire with correct payloads
- [ ] Handler context is well-formed

**Blocked by:** Phase 4 (register)

### Phase 6: lifecycle integration + reconnect-on-failure

**Build:**
- `packages/sdk-node/src/lifecycle.ts` — orchestrates `connect`, `register`, auto-reconnect-then-reregister
- After reconnect: re-register every previously-registered capability automatically
- Emit `sdk.disconnected` on close, `sdk.connected` on reconnect, `sdk.capability.registered` per re-registration
- `packages/sdk-node/src/__tests__/lifecycle.test.ts` — 4+ tests:
  - full happy path: connect → register → invoke → disconnect → reconnect → re-register → invoke
  - reconnect with backoff timing
  - handler error during invoke (no impact on connection)
  - Gateway rejection on re-registration (reconnect but no re-registration)

**Verify:**
- [ ] Lifecycle tests pass
- [ ] All 7 PRD-TRD scenarios demonstrably pass via the lifecycle test suite

**Blocked by:** Phase 5 (invoke)

### Phase 7: post-impl simulation

**Build:**
- `docs/features/sdk-node/simulate.html` — copy of `simulate-pre.html` with the engine swapped to drive the real `@platform/sdk-node` package
- The UI shell (lifecycle, cards, event log, xterm.js terminal) stays identical
- The engine (`commands` object) replaces hardcoded sample manifest + handlers with real SDK calls
- `state.capabilities` populated by reading the SDK's actual registered list

**Verify:**
- [ ] `simulate.html` opens in a browser and demonstrates all 7 scenarios
- [ ] Output matches the pre-impl sim's behavior (proves no design drift)
- [ ] Auto-reconnect actually re-registers (test by stopping/starting a fake Gateway)

**Blocked by:** Phase 6 (lifecycle)

### Phase 8: drift check (sub-agent)

**Build:**
- Spawn a sub-agent via `feature-pipeline-review` skill
- It compares:
  - PRD-TRD Behavioral Spec (7 scenarios) vs real implementation
  - PRD-TRD Simulation Contract vs `simulate.html` output
  - IMPL plan (8 phases) vs what got built
- Output: `.reports/<timestamp>-drift-sdk-node.md`

**Verify:**
- [ ] Drift report shows zero gaps (or accepted drift items)
- [ ] User signs off on the report

**Blocked by:** Phase 7 (post-impl sim)

### Phase 9: reconcile simulations

**Build:**
- Read both `simulate-pre.html` and `simulate.html`
- Keep the UI shell, replace hardcoded data with real SDK calls
- Move `simulate-pre.html` to `archive/simulate-pre.html`
- Keep `simulate.html` as canonical

**Verify:**
- [ ] One simulation file remains (`simulate.html`)
- [ ] Reconciled sim is no longer than pre-impl
- [ ] No scenario contradicts PRD-TRD Behavioral Spec

**Blocked by:** Phase 8 (drift check)

## Phase Dependencies

```
Phase 1 (skeleton + types)
  ├── Phase 2 (manifest parser) ──────┐
  ├── Phase 3 (WebSocket client) ─────┤
  │                                   │
  │   ┌───────────────────────────────┘
  │   │
  │   ├── Phase 4 (register)
  │   │     └── Phase 5 (invoke)
  │   │           └── Phase 6 (lifecycle)
  │   │                 └── Phase 7 (post-impl sim)
  │   │                       └── Phase 8 (drift check)
  │   │                             └── Phase 9 (reconcile)
```

Each phase depends on the previous; no parallel work.

## Test Strategy

- **Per-package unit tests** live in `packages/sdk-node/src/__tests__/`. Every new function gets a test in the same PR.
- **Integration tests** in `packages/sdk-node/src/__tests__/lifecycle.test.ts` exercise the full happy path + reconnect.
- **End-to-end check** via `simulate.html` (Phase 7) using a real Gateway in a test harness.
- **Run commands:**
  - `pnpm -C packages/sdk-node test` — all unit + integration tests
  - `pnpm -C packages/sdk-node typecheck`
  - `pnpm -C packages/sdk-node lint`
  - `bash scripts/check-banned-types.sh`

## Dependency Analysis (opensrc)

**No new external dependencies.** All work uses existing packages:

- `ws` — WebSocket client. Already in package.json (gateway-core uses it). MIT license, actively maintained. Use directly.
- `yaml` — YAML parser. Already in package.json. ISC license, actively maintained.
- `@platform/event-bus` — workspace package. Used for emitting events.
- `node:fs/promises`, `node:path` — Node built-ins.

If a phase adds a new external dep, run `opensrc` skill first and record findings here. v1 introduces none.

## Rollout

No flag flip — dev. The first app to use sdk-node will be the platform's own example app (a customer-service demo) plus the MCP adapter (pack #9) which exercises it.

Migration story: none. This is the first SDK release. Future major versions of the SDK are tracked in `future.md`.

## Risk Notes

- **WebSocket reconnect storm.** If many SDKs reconnect simultaneously after a Gateway restart, the Gateway could be overwhelmed. Mitigation: jitter the backoff (random ±20% per attempt). Implement in Phase 6.
- **Manifest schema drift.** If a future SDK version adds manifest fields, old apps must continue working. Mitigation: ignore unknown fields on parse; only require known ones. Implement in Phase 2.
- **Handler exception swallowing.** A throwing handler must not crash the SDK. Mitigation: try/catch around the handler call, send error to Gateway, emit `sdk.invoke.failed`. Implement in Phase 5.
- **Token expiry during long-lived connection.** Drift #14 — not in v1. Documented; v2.1 fixes.

## Status Updates

Mark each phase inline as it completes:

```
### Phase 1: skeleton + types — ✅ Complete
### Phase 2: manifest parser — ✅ Complete (manifest.test.ts, 11 tests)
### Phase 3: WebSocket client + connect — ✅ Complete (client.test.ts, 6 tests)
### Phase 4: register() — ✅ Complete (register.test.ts, 4 tests)
### Phase 5: invoke() — ✅ Complete (invoke.test.ts, 8 tests)
### Phase 6: lifecycle integration — ⏳ Pending
### Phase 7: post-impl sim — ⏳ Pending
### Phase 8: drift check — ⏳ Pending
### Phase 9: reconcile — ⏳ Pending
```

Then update `docs/Feature_Backlog.md` and run `update-backlog` skill after each phase completes.