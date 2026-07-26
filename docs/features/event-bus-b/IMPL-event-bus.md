# Implementation Plan: Event Bus

## Status

- Type: Phased implementation plan
- Audience: Backend, frontend, QA
- Scope: In-process, typed publish/subscribe event delivery mechanism for the platform's
  Control Plane and Execution Plane components — no consumers required yet.
- Status: Approved 2026-07-26. **All five phases shipped** as an upgrade from v1 `@platform/event-bus`. Code split into `types.ts` + `match.ts` + `index.ts` (see §3 deviations). 29 behaviour tests pass; build, lint, typecheck green.
- PRD: [PRD-event-bus.md](./PRD-event-bus.md)
- TRD: [TRD-event-bus.md](./TRD-event-bus.md)
- FLOW: [FLOW-event-bus.md](./FLOW-event-bus.md)

## 1. Planning Principles

1. **Build snapshot-based dispatch from Phase 1, not retrofitted later.** The re-entrant
   unsubscribe case (Flow 6c) only behaves correctly if `publish()` iterates a snapshot of
   subscriptions rather than a live, mutable list. Getting this right from the first working
   version avoids the classic mutation-during-iteration bug class entirely, rather than
   patching around it once Phase 4 needs it.
2. **Exact-name matching ships complete and tested before wildcard matching is introduced.**
   Wildcard support (Phase 2) is additive complexity layered on a working simple case, not
   intertwined with it — if Phase 2 breaks something, the bug is isolated to matching logic,
   not dispatch.
3. **`event.handler_failed` is a first-class event through the same bus**, not a special
   out-of-band callback — this keeps the Phase 3 recursion guard (Flow 6d) consistent with
   how every other event in the system behaves, rather than a special case to remember.
4. **Zero new dependencies at any phase.** The ADR's "custom, zero-dependency" decision is a
   hard constraint for the whole plan, not just Phase 0 — no phase should reach for an
   external package to solve a problem the custom implementation already owns.
5. **Every phase's tests pass before the next phase starts.** `capability-registry`,
   `session-manager`, and `plugin-manager` (Tier 1) will build directly on this package's
   public API once it ships — nothing partially-working should be left mid-plan for a future
   phase to "come back to."

## 2. Current Baseline

Nothing exists yet — `packages/` is empty. There is no existing behavior to preserve; every
phase below is purely additive, per TRD §1.4 and §4.1.

## 3. Phase Plan

---

### Phase 0: Foundation

**Goal**: Scaffold `packages/event-bus` as a workspace package with its supporting type
definitions in place. No runtime behavior yet.

**Why this phase first**: `PlatformEvent`, `EventHandler`, `Subscription`, and
`HandlerFailedPayload` (TRD §2.2) are referenced by every later phase's implementation and
tests. Settling their shape once, before any logic depends on them, avoids reshaping types
mid-implementation.

#### Backend tasks

- [x] Create `packages/event-bus/package.json` — name `@platform/event-bus`, `private: true`
      within the workspace (publishing is a separate future decision, out of scope here).
- [x] Create `packages/event-bus/tsconfig.json` extending `../../tsconfig.base.json`, with
      `composite: true` and an `outDir`.
- [x] Add `{ "path": "packages/event-bus" }` to the root `tsconfig.json`'s `references`
      array, replacing the placeholder comment left during Bootstrap.
- [x] Create `packages/event-bus/src/types.ts` with `PlatformEvent`, `EventHandler`,
      `Subscription`, and `HandlerFailedPayload`, exactly per TRD §2.2.
- [x] Create `packages/event-bus/src/index.ts` re-exporting the public types (implementation
      exports added in Phase 1).

#### Frontend tasks

Not applicable — no frontend surface for this package (TRD §1.3, §2.4).

#### Validation condition

`npm run typecheck` passes with the new package referenced. `npm run build
--workspace=@platform/event-bus` succeeds, producing type declarations only — no runtime
logic exists yet, so no test suite is expected to pass meaningfully at this phase.

#### Regression check

`npm run build && npm test && npm run lint` at the monorepo root still pass. Trivially true
since nothing else exists yet — run anyway to confirm the scaffold didn't break root tooling.

---

### Phase 1: Exact-name publish/subscribe core

**Goal**: A caller can subscribe to an exact event name and receive events published under
that exact name. `publish()` resolves once the handler has completed.

**Blocked by**: Phase 0

#### Backend tasks

- [x] Implement the `EventBus` class in `packages/event-bus/src/event-bus.ts`, with
      `publish()` and `subscribe()` supporting **exact-name matching only** — wildcard
      support is deliberately deferred to Phase 2.
- [x] `publish()` constructs a `PlatformEvent` (UUID `id`, `publishedAt` via `Date.now()`),
      shallow-freezes the payload with `Object.freeze()`, and freezes the constructed event
      object itself.
- [x] `publish()` takes a **snapshot** (array copy) of matching subscriptions before
      dispatching — built now, per Planning Principle 1, not deferred to Phase 4.
- [x] `subscribe()` registers the pattern + handler and returns a `Subscription` object. The
      `unsubscribe()` method's real removal logic is implemented in Phase 4; for now it can
      exist as part of the returned shape without needing to do anything meaningful yet.
- [x] Export `EventBus` from `packages/event-bus/src/index.ts`.

#### Frontend tasks

Not applicable.

#### Tests required

- [x] Flow 1 happy path: subscribe to an exact name, publish that event, handler is called
      exactly once with the correct `PlatformEvent`.
- [x] `publish()` resolves only after the handler (including an async handler) has completed.
- [x] Flow 6a: publishing with zero matching subscribers resolves normally, no error.
- [x] Published payload is frozen — mutating it inside a handler does not affect what the
      publisher or other reads of the same payload see [AC-6].

#### Validation condition

All Phase 1 tests pass. `npm run typecheck && npm run lint` pass. Flow 1's steps in
FLOW-event-bus.md are demonstrably true by running the test suite.

---

### Phase 2: Wildcard matching

**Goal**: A caller can subscribe to a namespace wildcard (`browser.*`) and receive every
event under that namespace at any depth. Malformed patterns are rejected at subscribe time.

**Blocked by**: Phase 1

#### Backend tasks

- [x] Implement matching logic in `packages/event-bus/src/match.ts` — kept separate from
      `event-bus.ts` per TRD §2.1, so it's unit-testable in isolation. Covers: exact match,
      prefix-based wildcard match (`a.b.*` matches any name starting with `a.b.`, any
      remaining depth), and bare `*` matching everything.
- [x] Add pattern validation to `subscribe()`: throw synchronously if `*` appears anywhere
      except as the final character of the pattern.
- [x] Wire `match.ts` into `EventBus.publish()`'s subscription lookup, replacing the
      exact-only lookup from Phase 1.

#### Frontend tasks

Not applicable.

#### Tests required

- [x] Flow 3: a `browser.*` subscriber receives a matching multi-segment event name (e.g.
      `browser.navigation.completed`).
- [x] Flow 3: a `browser.*` subscriber does not receive an unrelated event name
      (`session.created`).
- [x] Flow 6b: a malformed pattern (`*` not the final character) throws at `subscribe()`
      time.
- [x] Flow 6e: an exact-name subscriber and a wildcard subscriber both fire independently for
      the same matching event, now that both matching types coexist.
- [x] `match.ts` unit tests covering exact, wildcard, and bare `*` cases directly, independent
      of the full `EventBus`.

#### Validation condition

All Phase 2 tests pass, including the full Phase 1 regression suite. `npm run typecheck &&
npm run lint` pass.

---

### Phase 3: Failure isolation + observability

**Goal**: A subscriber's handler failing never blocks delivery to other subscribers for the
same event, and the failure is surfaced via `event.handler_failed` rather than dropped
silently.

**Blocked by**: Phase 1 (uses the snapshot-based dispatch already in place). Independent of
Phase 2 — behaves identically regardless of whether matching was exact or wildcard.

#### Backend tasks

- [x] Wrap each handler invocation inside `publish()`'s dispatch loop in a `try`/`catch` (for
      synchronous throws) and a `.catch()` (for rejected promises). On failure, call
      `this.publish('event.handler_failed', { eventName, subscriberPattern, error })`
      internally rather than propagating the error to the original caller.
- [x] Normalize whatever the handler threw or rejected with into `{ message, stack? }` before
      including it in the `event.handler_failed` payload.
- [x] Add the recursion guard: if dispatching to a subscriber of `event.handler_failed`
      itself fails, catch and drop it (log only — do not publish another
      `event.handler_failed`).

#### Frontend tasks

Not applicable.

#### Tests required

- [x] Flow 5: a handler throws synchronously — other subscribers to the same event still
      receive it, and `publish()` does not reject.
- [x] Flow 5: a handler's returned promise rejects — same isolation behavior holds.
- [x] Flow 5: `event.handler_failed` is published with the correct `eventName`,
      `subscriberPattern`, and `error.message`.
- [x] Flow 6d: a subscriber to `event.handler_failed` that itself throws does not cause
      infinite recursion or an unhandled rejection.

#### Validation condition

All Phase 3 tests pass, including Phase 1 and Phase 2 regression suites. `npm run typecheck
&& npm run lint` pass.

---

### Phase 4: Unsubscribe

**Goal**: A subscription can be explicitly cancelled. Double-unsubscribe is safe.
Unsubscribing mid-dispatch does not corrupt the current `publish()` call.

**Blocked by**: Phase 1 (snapshot mechanism), Phase 3 (so re-entrant unsubscribe can be
tested against a dispatch loop that also handles failures).

#### Backend tasks

- [x] Implement `Subscription.unsubscribe()` to remove the corresponding entry from
      `EventBus`'s internal subscription registry.
- [x] Make `unsubscribe()` idempotent — calling it more than once is a no-op, not an error.

#### Frontend tasks

Not applicable.

#### Tests required

- [x] Flow 4: after `unsubscribe()`, a later matching `publish()` no longer invokes the
      handler.
- [x] Flow 4: calling `unsubscribe()` twice does not throw.
- [x] Flow 6c: a handler that calls its own `unsubscribe()` mid-dispatch does not crash the
      current `publish()` call or affect delivery to other subscribers in the same call —
      this validates the Phase 1 snapshot mechanism under the specific case it was built for.

#### Validation condition

All Phase 4 tests pass, including Phase 1–3 regression suites. `npm run typecheck && npm run
lint` pass.

---

### Phase 5: Final integration & readiness

**Goal**: Confirm the full public API matches the TRD exactly, the complete FLOW QA checklist
passes end to end, and the package is genuinely ready for `capability-registry`,
`session-manager`, and `plugin-manager` to depend on.

This replaces the template's usual "remove deprecated paths" closing phase — there's nothing
to deprecate on a brand-new package with no prior version. Its purpose here is the final
integration gate instead.

**Blocked by**: Phases 0–4 complete and validated.

#### Tasks

- [x] Walk the full FLOW-event-bus.md Manual QA checklist end to end (not just the automated
      suite) and confirm every item.
- [x] Confirm `packages/event-bus/src/index.ts` exports exactly the public surface described
      in TRD §2.3 — no accidental internal exports (e.g. `match.ts`'s internals should not be
      exported from the package root).
- [x] Add `packages/event-bus/README.md` documenting the public API
      (`publish`/`subscribe`/`unsubscribe`) for whoever builds `capability-registry` next.
- [x] Add an entry to `docs/CONTEXT.md`'s Decisions Log noting `event-bus` shipped and is
      ready for Tier 1 dependents.

#### Architectural deviation from original plan

The IMPL originally specified a class-based architecture in `event-bus.ts` with `matches()`
in a separate `match.ts` file. The actual implementation uses a factory function
(`createEventBus()`) in `index.ts` with closure-scoped state, plus `types.ts` + `match.ts`
as sibling modules. The file breakdown is:

| Planned (IMPL) | Actual |
|---|---|
| `src/types.ts` | `src/types.ts` ✓ |
| `src/event-bus.ts` (class) | `src/index.ts` (factory function) |
| `src/match.ts` | `src/match.ts` ✓ |
| Tests in `src/` | Tests in `src/__tests__/` |

The factory-closure pattern was chosen over a class because:
- State (subscriptions list, registration counter) is naturally encapsulated without `#private`
  syntax or `WeakMap` tricks
- The factory returns exactly the `EventBus` interface — no internal methods leak on the
  returned object
- Private helpers (`dispatchToSnapshot`, `dispatchInternal`, `emitHandlerFailed`) live in the
  closure scope and are never exposed

This deviation was reviewed and accepted during the v2 upgrade refactor
(`improve-codebase-architecture` review). Future packages should follow the same
factory-closure pattern for consistency.

#### Validation condition

`npm run build && npm test && npm run lint && npm run typecheck` all pass at the monorepo
root. Every FLOW QA checklist item is checked off. `@platform/event-bus`'s exports match TRD
§2.3 exactly — nothing more, nothing less.

---

## 4. Dependency Checklist

**No dependencies.** This package introduces zero new external packages — see TRD §3 and
ADR-0001. The hard-gate requirement below is satisfied trivially: there is nothing to run
`opensrc` against, because nothing is being added.

**Summary table**

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| *(none)* | — | — | Yes (N/A — no packages added) | — |

## 5. Test Requirements

- Tests validate **external behavior only** — calling `publish`/`subscribe`/`unsubscribe` and
  observing handler invocations, event shapes, and timing. Never assert against `EventBus`
  internals (e.g. the shape of the internal subscription registry).
- **Prior art**: none yet — this is the first package in the repo. This test suite becomes
  the reference pattern for every later package's tests.
- **Test runner**: Vitest, per the monorepo root Bootstrap configuration.
- **Test data strategy**: no fixtures needed. All test events/payloads are constructed inline
  per test; no persistence, no seed data — consistent with the PRD's non-goals.
- Across all five phases plus the Phase 5 manual QA pass, every Acceptance Criterion (AC-1
  through AC-8) from the PRD must be covered by at least one test or checklist item.

## 6. Rollout Notes

- No feature flag needed — this package isn't wired into any running system yet (no
  consumers exist), so there's no user-facing rollout risk.
- No data migration, no new environment variables.
- Once complete, this package's structure (layout, test approach, TRD/FLOW adaptation
  pattern for a non-CRUD infra feature) becomes the reference for `capability-registry`,
  `session-manager`, and `plugin-manager` — any deviation from it in those features should be
  a deliberate choice, not accidental drift.
