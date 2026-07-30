# IMPL: gateway-plugin-dispatch

**Slug:** gateway-plugin-dispatch
**Status:** Approved
**Date:** 2026-07-30

## Phase Plan

**Before Phase 1:** no new external deps — Node ESM `import()` is stdlib, no `ws`-style third-party package needed. Skip `opensrc`.

### Phase 1: plugin-manager handler loading — ✅ Complete 2026-07-30 (commit 162b4b2)

**Build:**
- `packages/plugin-manager/src/types.ts` — extend `PluginManifest.runtime` with optional `entry?: string`. Add `PluginHandler` interface. Add `PluginHandlerLoadedPayload` and `PluginHandlerErrorPayload` event payload types. Add `handleInvocation` to the `PluginManager` interface.
- `packages/plugin-manager/src/manifest.ts` — `coerceTypeKey` passes through optional `entry` for `runtime`; rejects non-string `entry`.
- `packages/plugin-manager/src/errors.ts` — three new error codes: `HANDLER_NOT_FOUND`, `HANDLER_LOAD_FAILED`, `HANDLER_ERROR`.
- `packages/plugin-manager/src/events.ts` — `EventPublisher.handlerLoadFailed` and `handlerInvokeFailed` methods publishing on `plugin.handler.loaded` and `plugin.handler.error`.
- `packages/plugin-manager/src/handler-loader.ts` (NEW) — `HandlerRegistry` class, `loadHandlers`, `dropHandlers`, `get`, `has`, `setDisabled`, `resolveEntryPath`, `asHandlerMap` (runtime shape check).
- `packages/plugin-manager/src/index.ts` — `createPluginManager` factory wires the registry; install/reload call `tryLoadHandlers`; disable/enable flip `disabled` flag (awaited); uninstall calls `dropHandlers`; new `handleInvocation` method resolves pluginId from capability owner and invokes the handler.

**Verify (already passed at commit):**
- [x] All 9 gates from PRD-TRD scenarios covered (6 unit tests + 3 by wiring).
- [x] `pnpm --filter @platform/plugin-manager test` — 6/6 handler-loading tests pass.
- [x] `vitest run` across workspace — 445/445 (was 439; +6).
- [x] `pnpm -r build` clean across 9 packages.
- [x] `pnpm -r lint` — 0 warnings, 0 errors.
- [x] `bash scripts/check-banned-types.sh` — clean.
- [x] `pnpm -r typecheck` — 0 errors.

**Blocked by:** nothing. Phase 1 done.

### Phase 2: lifecycle-integration tests — ⏳ Pending

**Build:**
- Add tests to `packages/plugin-manager/src/__tests__/handler-loading.test.ts`:
  - **`reload` re-imports handlers`** — install plugin, mutate the entry module on disk, reload, invoke — verify the new handler runs.
  - **`uninstall` drops handlers`** — install, uninstall, verify `handleInvocation` for the now-uninstalled cap throws `CAPABILITY_NOT_FOUND` (not `HANDLER_NOT_FOUND`).
  - **`disable` then `enable` round-trip** — install, disable, invoke (fail), enable, invoke (succeed) — same handler map, no re-import.
  - **Startup reinstall loads handlers for persisted plugins** — write a record to the in-mem fs's installRecordPath BEFORE creating the manager; assert that handler is loaded on `createPluginManager`.

**Verify:**
- [ ] `pnpm --filter @platform/plugin-manager test` — 10/10 tests pass (was 6; +4).
- [ ] `vitest run` workspace — no regressions.

**Blocked by:** Phase 1 (done).

### Phase 3: gateway-core error codes — ⏳ Pending

**Build:**
- `packages/gateway-core/src/errors.ts` — add two `GATEWAY_*` codes per the approved Option B:
  - `GATEWAY_HANDLER_NOT_FOUND { retryable: false }` — maps from `PLUGIN_HANDLER_NOT_FOUND`.
  - `GATEWAY_HANDLER_ERROR { retryable: false }` — maps from `PLUGIN_HANDLER_ERROR`.
- PRD-TRD approved a two-error mapping (NOT_FOUND + ERROR). `HANDLER_LOAD_FAILED` does NOT surface as a kernel error; it surfaces only as the `plugin.handler.loaded` event (Phase 1 already has this).

**Verify:**
- [ ] `pnpm --filter @platform/gateway-core build` — compiles.
- [ ] `pnpm --filter @platform/gateway-core test` — no regressions. (Existing `handle-invocation.test.ts` may need a minimal update if it asserts exact error-code counts.)

**Blocked by:** Phase 2 (so the contract is stable before the kernel imports it).

### Phase 4: dispatch.ts swap — ⏳ Pending

**Build:**
- `packages/gateway-core/src/dispatch.ts:88-103` — replace the `MANAGER_UNAVAILABLE` stub with a synchronous call to `pluginManager.handleInvocation(name, input, sessionId)`. Wrap in try/catch that translates `PluginManagerError` codes to `GatewayError` codes per PRD-TRD-approved Option B:
  - `PLUGIN_HANDLER_NOT_FOUND` → `GATEWAY_HANDLER_NOT_FOUND`
  - `PLUGIN_HANDLER_ERROR` → `GATEWAY_HANDLER_ERROR`
  - Anything else (registry/lifecycle errors) → pass through unchanged.
- `packages/gateway-core/src/handle-invocation.ts` — extend the existing plugin-resolution path to populate the same `owner` and `pluginId` lookups that `dispatch.ts` now uses, so `handle-invocation` and `dispatch` don't drift. (Inspect whether `handle-invocation` already has this — if so, mirror its logic.)

**Verify:**
- [ ] Manual review: `dispatch.ts:88-103` now calls `pluginManager.handleInvocation` instead of throwing `MANAGER_UNAVAILABLE`.
- [ ] New unit test in `packages/gateway-core/src/__tests__/dispatch.test.ts` (or extend existing) covering Option B mapping — feed `PluginManagerError` codes, expect `GatewayError` codes.
- [ ] `pnpm --filter @platform/gateway-core test` — passes, including the new mapping test.

**Blocked by:** Phase 3 (error codes land first so dispatch can reference them).

### Phase 5: integration test — ⏳ Pending

**Build:**
- Extend `packages/agentide/src/__tests__/backend-runtime.test.ts` (the existing end-to-end integration) OR add `packages/agentide/src/__tests__/gateway-plugin-dispatch.test.ts`:
  - Stand up `createPlatform({ backendRuntimePort: 0 })` — that wires the runtime, audit, gateway, plugin-manager, and capability registry.
  - Install a plugin via `createPlatform.backendRuntime.pluginManager.install(...)`.
  - Invoke via `createPlatform.gateway.handleInvocation(...)` — assert the handler result flows back through the full pipeline.
  - Cover **all 8 PRD-TRD scenarios** — disabled plugin, missing cap name, handler throws, entry load fails, concurrent invocations, uninstall, etc.
- This is the test that proves Phase 4's dispatch swap actually works through the full kernel.

**Verify:**
- [ ] Integration test passes — all 8 PRD-TRD scenarios green.
- [ ] `vitest run` workspace — 445+N tests pass (N = integration test count).
- [ ] `pnpm -r lint && pnpm -r typecheck && bash scripts/check-banned-types.sh` — all clean.

**Blocked by:** Phase 4.

### Phase 6: drift check + post-impl sim + ship — ⏳ Pending

**Build:**
- **Drift sub-agent**: spawn a fresh subagent (per feature-pipeline skill rule "drift check MUST be a sub-agent — inline drift checks not enough") with the read-only task of comparing this PRD-TRD against the implementation. Log findings in `docs/drift-issue-log.md` (next entry after #16).
- **Post-impl sim** at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs` — mirror the pre-impl sim, but drive the **real** packages. Must demonstrate all 8 PRD-TRD scenarios end-to-end. Each scenario prints PASS/FAIL.
- **Lint sweep** — run `pnpm -r lint`; resolve any new warnings.
- **Ship** — atomic commit per logical phase (already done for Phases 1 and any completed in Phases 2–5), merge to local main, ready for push.

**Verify:**
- [ ] Drift sub-agent report appended to `docs/drift-issue-log.md`.
- [ ] Post-impl sim exists at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs`.
- [ ] `node packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs` — 8/8 scenarios PASS.
- [ ] `vitest run` — no regressions.
- [ ] `pnpm -r lint && pnpm -r typecheck && bash scripts/check-banned-types.sh` — clean.
- [ ] Working tree clean on `main`. BI[8a] marked `SHIPPED YYYY-MM-DD` in `Feature_Backlog.md` row 8a.

**Blocked by:** Phase 5.

## Phase Dependencies

```
Phase 1 (done, plugin-manager API surface)
   │
   ▼
Phase 2 (lifecycle integration tests)
   │
   ▼
Phase 3 (gateway-core error codes)
   │
   ▼
Phase 4 (dispatch.ts swap + error mapping)
   │
   ▼
Phase 5 (end-to-end integration test)
   │
   ▼
Phase 6 (drift check + post-impl sim + ship)
```

## Test Strategy

- **Per-phase RED-GREEN-REFACTOR** per `tdd` skill: write failing tests first, implement minimally, refactor with confidence.
- **Plugin-manager unit tests** (Phases 1, 2): in `packages/plugin-manager/src/__tests__/handler-loading.test.ts`. Use `InMemoryFs` + `FixedClock` + a real Node ESM fixture (`browser-handlers.mjs`) loaded via the actual `import()` path.
- **Gateway-core mapping tests** (Phases 3, 4): in `packages/gateway-core/src/__tests__/dispatch.test.ts`. Mock the `pluginManager.handleInvocation` to return `PluginManagerError` instances with each of the two codes; assert dispatch throws the corresponding `GATEWAY_*` code.
- **End-to-end integration** (Phase 5): in `packages/agentide/src/__tests__/`. Real `createPlatform({ backendRuntimePort: 0 })`. No mocks.
- **Post-impl sim** (Phase 6): standalone `.mjs` file at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs`. Run with `node`.
- **Run order**: `pnpm -r build` (verify dist exists), then `vitest run` (verify tests), then `bash scripts/check-banned-types.sh`, then `pnpm -r lint`, then `pnpm -r typecheck`.

## Dependency Analysis (opensrc)

**No new external dependencies.** This pack uses:
- Node 14+ ESM `import()` for plugin entry loading (stdlib; no third-party equivalent is needed; alternatives are worse).
- Existing internal packages: `@platform/capability-registry`, `@platform/event-bus`, `@platform/gateway-core`, `@platform/agentide`.

`opensrc` skill rule satisfied vacuously.

## Rollout

**Zero migration.** This pack closes a stub that previously rejected every `plugin:<id>` invocation. No existing platform install has runtime plugins with handlers in the wild — Phase 1's manifest change is purely additive (optional new field); no migration path is needed.

Rollout order:
1. Phase 1+ (already shipped at commit `162b4b2`).
2. Phases 2–5 ship as a logical unit (single feature branch `feature/gateway-plugin-dispatch-wire`, or sequential atomic commits on `main` per `git-flow` skill).
3. Phase 6 ships once Phase 5 is green.

After Phase 6 ships:
- The DOC update: `docs/architecture/Capability_System.md` already documents where each handler lives per type (Phase 1 commit `0d0ccd0`); Phase 6 confirms the BI[8a] row works end-to-end.
- The backlog update: `docs/Feature_Backlog.md` row 8a flips from `GRILLED` to `SHIPPED 2026-MM-DD`.
- `docs/CONTEXT.md` Decisions Log gets a 2026-MM-DD entry recording the ship.

## Risk Notes

1. **Phase 4 dispatch swap can regress existing platforms-internal tests.** Existing integration tests in `packages/gateway-core/src/__tests__/dispatch.test.ts` may currently assert that `plugin:<id>` owners throw `MANAGER_UNAVAILABLE`. Those assertions are now wrong; they need to flip to asserting the new `HANDLER_NOT_FOUND` code. Inspection first, then targeted test updates.

2. **Option B's error mapping introduces a try/catch in dispatch.** A bug in the mapping (catch too broadly) would mask non-plugin-manager errors as `GATEWAY_HANDLER_NOT_FOUND`. Keep the catch narrow (only `PluginManagerError` with code in `{PLUGIN_HANDLER_NOT_FOUND, PLUGIN_HANDLER_ERROR}`); everything else rethrows.

3. **Phase 5 integration test depends on `backendRuntimePort` working.** That was BI[8b]; it should be solid, but if the integration test exposes a regression from BI[8b, the test still reveals it (which is the point of integration tests).

4. **Concurrent invocation test (PRD-TRD Scenario 8) needs a handler that takes ~50ms.** Use a `setTimeout`-based fake handler in the test fixture; don't add a real timeout dependency to the package. The test runs in <200ms normally.

5. **`asHandlerMap` ignores non-function entries in a plugin's default export.** That's by design (plugins may export mixed objects: handlers + config helpers). If a plugin's intent is to export ONLY handlers, that's a plugin-author concern — not enforced by us. Document in the Phase 5 README of `handler-loader.ts`.

6. **No pre-impl sim was authored for BI[8a**.** Per the format doc, pre-impl sim mirrors design with hardcoded state; the GRILL served that role here. If a future cycle wants a real pre-impl HTML/JS sim, that's a follow-up — but the GRILL + tests cover the design surface adequately.
