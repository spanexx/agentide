# IMPL: sdk-browser (Browser SDK)

**Slug:** sdk-browser
**Status:** Draft
**Date:** 2026-08-02

## Phase Plan

**Before Phase 1:** new external dev-deps `jsdom@^30.0.1` (plus `vitest@^4.1.10`, already in repo). opensrc findings recorded in Dependency Analysis below. No new runtime deps — only `@platform/event-bus` (workspace:*), same as sdk-node.

### Phase 1: package skeleton + types + config

**Build:**
- `packages/sdk-browser/package.json` — name `@platform/sdk-browser`, `"type": "module"`, ESM-only exports with `import` condition only (no `browser` field, no IIFE — GRILL T6)
- `packages/sdk-browser/tsconfig.json` — extends `../../tsconfig.base.json`; `"lib": ["ES2022","DOM","DOM.Iterable"]`; NO `@types/node` / `@types/ws`; references `../event-bus` + `../backend-runtime` (type-only for `BackendValue`)
- `packages/sdk-browser/src/types.ts` — `SdkOptions` (`gateway, appId, token, observeRoot?, defaultTier?, defaultVersion?`), `CapabilityView`, `ConnectionState = 'connecting'|'connected'|'reconnecting'|'disconnected'`, `Sdk` interface (PRD-TRD §Data Models / §API Contracts)
- `packages/sdk-browser/src/index.ts` — public exports: `createSdk`, types

**Verify:**
- [ ] `pnpm -C packages/sdk-browser build` succeeds
- [ ] `pnpm -C packages/sdk-browser typecheck` clean
- [ ] `pnpm -C packages/sdk-browser lint` clean
- [ ] `bash scripts/check-banned-types.sh` clean

**Blocked by:** nothing

### Phase 2: observer + dedup (DOM is the manifest)

**Build:**
- `packages/sdk-browser/src/observer.ts` — initial scan on `createSdk()` over `observeRoot` (default `document.body`) + `MutationObserver({ subtree, childList, attributes, attributeFilter: ['data-sdk-cap'] })`; reads ONLY `data-sdk-cap`; no shadow DOM/iframe piercing; `sdk.observe(rootEl)` for extra roots; count-based dedup: register 0→1, unregister 1→0 (PRD-TRD S2, §Architecture Notes)
- Caps tracked pre-connect; registered only while connected
- `packages/sdk-browser/src/__tests__/observer.test.ts` — jsdom env; 6+ tests: initial scan finds annotated elements; dedup 3× → 1 entry count=3; attribute change re-reads; add 0→1, remove 1→0; observe(extraRoot); ignore elements without data-sdk-cap

**Verify:**
- [ ] Observer tests pass
- [ ] Dedup count semantics match PRD-TRD S1/S2

**Blocked by:** Phase 1 (skeleton)

### Phase 3: dispatcher — CustomEvent fan-out + form-fill fallback

**Build:**
- `packages/sdk-browser/src/dispatch.ts` — on Gateway `sdk.invoke`, dispatch `CustomEvent("sdk:cap:<name>", { detail: { input, ctx: { token } } })` on EVERY annotated element; dev filters via `document.addEventListener` + `e.target.closest('[data-sdk-cap=...]')`; form-fill fallback: if no listener called `preventDefault()`, SDK writes `input` into a contained `<input>`; wire reply `sdk.invoke.result` / `sdk.invoke.error` (PRD-TRD S3/S4)
- `packages/sdk-browser/src/__tests__/dispatch.test.ts` — 6+ tests: fan-out on all annotated elements; detail payload `{ input, ctx: { token } }` with JWT verbatim; closest-filter scenario (pid match); form-fill writes value; preventDefault blocks fallback; invoke.error on missing cap

**Verify:**
- [ ] Dispatch tests pass (jsdom)
- [ ] Matches PRD-TRD S3/S4 exactly

**Blocked by:** Phase 2 (observer — needs cap inventory)

### Phase 4: WebSocket client + auth + reconnect

**Build:**
- `packages/sdk-browser/src/client.ts` — wraps `globalThis.WebSocket` (throws if missing — PRD-TRD S6); auth = first message after `onopen` `{ type: "sdk.auth", token }`, NO Authorization header (S5); origin binding handled by backend-runtime (close 1008 on mismatch → `disconnected`, no reconnect); reconnect backoff 1s,2s,4s,8s,16s,30s cap ±20% jitter (sdk-node parity); heartbeat: none — server-initiated only (zero SDK code)
- `packages/sdk-browser/src/__tests__/client.test.ts` — `/** @vitest-environment jsdom */`, WebSocket via `vi.stubGlobal`; 6+ tests: throws without WebSocket; auth first message on open; backoff sequence with fake timers + jitter bounds; 1008 → disconnected no reconnect; reconnecting state; deliberate disconnect

**Verify:**
- [ ] Client tests pass
- [ ] Backoff + auth match PRD-TRD S5/S6

**Blocked by:** Phase 1

### Phase 5: lifecycle + state surface

**Build:**
- `packages/sdk-browser/src/lifecycle.ts` — visibility: pause reconnect while hidden, fire immediately on visible (S7); offline: mark socket dead + clear timer, online: reset backoff + fire reconnect immediately (S8); pagehide: best-effort `sdk.disconnect()` + `close(1000, "pagehide")`, skip if `event.persisted` (bfcache) (S9)
- `packages/sdk-browser/src/state.ts` — `sdk.onStateChange(cb)` 4 states, real transitions only; `sdk.state().connectionState` sync getter (S10)
- `packages/sdk-browser/src/events.ts` — 8 lifecycle events via `@platform/event-bus` (sdk-node parity): `sdk.connected`, `sdk.disconnected`, `sdk.capability.{registered,unregistered,rejected}`, `sdk.invoke.{started,completed,failed}`
- Register caps on connect (Phase 2 observer hooks here)
- `packages/sdk-browser/src/__tests__/lifecycle.test.ts` — 6+ tests: hidden pause/resume; visible immediate reconnect; offline/online; pagehide 1000 + bfcache skip; onStateChange transitions only; 8 events fire

**Verify:**
- [ ] Lifecycle tests pass
- [ ] All 10 PRD-TRD scenarios demonstrably pass via test suite

**Blocked by:** Phases 2–4

### Phase 6: post-impl simulation

**Build:** Post-impl sim driving the REAL `@platform/sdk-browser` package (per pipeline; sibling precedent D-33/D-34 = Node `.mjs` script in `agentide/scripts/` — confirm UI vs CLI with user). Pre-impl `simulate-pre.html` archived at reconcile.

**Verify:**
- [ ] Playwright (if UI) or script (if CLI) drives real SDK; commands map 1:1 to PRD-TRD §Simulation Contract

**Blocked by:** Phases 1–5

## Phase Dependencies

`1 → 2 → 3` (inventory → dispatch), `1 → 4` (client), `2+4+5` (register-on-connect), `5 → 6` (sim).

## Test Strategy

Vitest per-file `/** @vitest-environment jsdom */` docblock (T6 Q4 lock); WebSocket stubbed via `vi.stubGlobal`; fake timers for backoff/visibility. Tests live in `packages/sdk-browser/src/__tests__/`. Run: `pnpm -C packages/sdk-browser test`.

## Dependency Analysis (opensrc)

- **`vitest@^4.1.10`** — MIT, active (vitest-dev/vitest@4.1.10 fetched). Already repo runner. Alternatives: jest+jsdom (heavier), node:test (no jsdom ergonomics). Use per repo convention.
- **`jsdom@^30.0.1`** — MIT, active (jsdom/jsdom@30.0.1 fetched). Provides DOM for observer/dispatch tests. Alternatives: happy-dom (lighter but weaker MutationObserver/CustomEvent fidelity — the SDK's core). Chosen for standards fidelity.
- **`@platform/event-bus`** (workspace:*) — sole runtime dep; internal, no fetch needed.
- **`@platform/backend-runtime`** — type-only (`BackendValue`), erased at compile; tsconfig reference only.

## Rollout

New package, additive — no migration. Wire into `pnpm-workspace.yaml` if not auto-globbed; ensure repo-wide `pnpm install` links `@platform/sdk-browser`. Meta-package wiring (agentide/application) is a later pack concern.

## Risk Notes

- `MutationObserver` + `attributes:true` without filter would fire on every attribute change — the `attributeFilter` is load-bearing (PRD-TRD S2).
- Backoff tests need fake timers + `vi.stubGlobal` WebSocket mock that can emit `close` events on demand.
- jsdom lacks `navigator.onLine` mutation — offline/online tests dispatch synthetic `offline`/`online` events and mock the flag.
- `pagehide` doesn't exist in jsdom — fire synthetic `PageTransitionEvent`-ish `pagehide` on `window`.
- Origin mismatch (1008) arrives as `close` with code — must clear reconnect timer (zombie-reconnect bug class found in pre-impl sim; see `simulate-pre.html`).

## Open Drift Items (carried forward)

From the [drift review](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/.reports/20260802-0659-drift-sdk-browser.md) — all resolved at reconcile 2026-08-02, none open:

- **D-37** — GRILL T3 Q3 wire-message `sdk.disconnect` vs close-only code; GRILL amended, accepted (drift.md).
- **D-38** — post-impl sim placement `packages/agentide/scripts/simulate-sdk-browser.mjs` (Node ESM, D-33/D-34 precedent); accepted (drift.md).
- **D-39** — two naming nits (test name at `index.test.ts:297`, `events.ts:24` comment listing a non-emitted "drop" reason); fixed during reconcile.

Resolved in the D-40/D-43 follow-up fix (2026-08-02, see docs/drift.md):

- **D-40** — register frame was name-only, failing gateway validation (`register-failed` close). Fixed: `sendRegister` sends the full sdk-node-parity frame (description = cap name, version/tier from CapRegistry view, permissions "").
- **D-43** — gateway evicted the first connection on duplicate appId (two tabs of one app). Fixed: sdk-browser sends a per-instance `tabId` in `sdk.auth` (`SdkOptions.tabId`, auto-generated per JS context); backend-runtime keys connections `appId:tabId`.
