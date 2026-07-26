# Implementation Plan: Event Bus

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: Ship first `@platform/event-bus` workspace package with deterministic in-process publish/subscribe behavior.
- Status: Approved 2026-07-26. **All four phases shipped** (Phase 0 package foundation → Phase 1 core publish/subscribe → Phase 2 async + failure surfacing → Phase 3 immutability + types + finish). Implementation lives in [packages/event-bus/](../../../packages/event-bus/); 29 behaviour tests pass; build, lint, typecheck green.
- PRD: [PRD-event-bus.md](./PRD-event-bus.md)
- TRD: [TRD-event-bus.md](./TRD-event-bus.md)
- FLOW: [FLOW-event-bus.md](./FLOW-event-bus.md)

## 1. Planning Principles

- Keep package custom and dependency-free. Do not add `eventemitter3`, Node
  `events`, or any broker package during implementation.
- Preserve replaceability through one small public seam: callers know
  `createEventBus`, `publish`, `subscribe`, and unsubscribe only.
- Make internal Event Bus rules observable through behavior tests, not through
  exposed storage internals or debug-only hooks.
- Keep implementation additive. This repo has no existing package behavior to
  migrate, so every phase should add working surface without compatibility
  shims.
- Lock reserved namespace and wildcard grammar in code from first commit so
  later features do not build on ambiguous behavior.

## 2. Current Baseline

What already works and must not regress.

- Root workspace builds with no packages referenced yet.
- Root validation commands are already defined:
  - `npm run build`
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
- `packages/` is intentionally empty before this feature lands.
- PRD, TRD, and FLOW docs are approved and define final behavior for wildcard
  matching, failure surfacing, unsubscribe semantics, and reserved namespace
  ownership.

## 3. Phase Plan

---

### Phase 0: Package Foundation

**Goal**: Create first workspace package and build/test wiring with no finished
Event Bus behavior yet.

**Why this phase first**: Package structure, root references, and test wiring
must exist before behavior slices can land safely.

#### Backend tasks

- [ ] Create `packages/event-bus/package.json` with package name
      `@platform/event-bus`, build entry points, and workspace-local scripts as
      needed.
- [ ] Create package `tsconfig.json` aligned with root composite build model.
- [ ] Add root `tsconfig.json` project reference to `packages/event-bus`.
- [ ] Create initial source entry file and test file locations.

#### Frontend tasks

- [ ] None. This package has no frontend work.

#### Validation condition

> Root workspace recognizes `packages/event-bus` as valid package and build
> graph input without requiring any consumer package.

#### Regression check

> Existing baseline behavior is 100% unchanged. Run:
> `npm run build && npm test && npm run lint && npm run typecheck`

---

### Phase 1: Core Publish / Subscribe Behavior

**Goal**: Ship exact-match and wildcard subscription, ordered dispatch,
unsubscribe, and isolated bus instances.

**Blocked by**: Phase 0

#### Backend tasks

- [ ] Implement `createEventBus` and public `EventBus` interface.
- [ ] Implement subscription storage that preserves registration order.
- [ ] Implement exact-name matching plus wildcard rules for `*` and `**`.
- [ ] Implement unsubscribe handle removal for future publishes.
- [ ] Ensure unsubscribe during in-flight dispatch does not mutate current
      dispatch snapshot.
- [ ] Ensure each Event Bus instance keeps isolated subscription state.

#### Frontend tasks

- [ ] None.

#### Tests required

- [ ] Verify exact subscriptions, `*`, and `**` match only intended names.
- [ ] Verify repeated publishes preserve subscription order.
- [ ] Verify unsubscribe stops later deliveries.
- [ ] Verify unsubscribe during handler does not change current dispatch.
- [ ] Verify separate Event Bus instances never see each other's events.

#### Validation condition

> A reviewer can create subscribers, publish named events, observe correct
> pattern matching and order, unsubscribe, and prove separate instances are
> isolated.

---

### Phase 2: Async Completion and Failure Surfacing

**Goal**: Add async-settling semantics, failure isolation, and internal
`event.handler_failed` emission.

**Blocked by**: Phase 1

#### Backend tasks

- [ ] Extend dispatch path to accept sync and async handlers in one ordered
      pass.
- [ ] Make `publish()` resolve only after all invoked async handlers settle.
- [ ] Catch thrown and rejected handler failures without rejecting original
      `publish()`.
- [ ] Emit one internal `event.handler_failed` event per failing handler with
      original event, handler index, and error.
- [ ] Block external publish attempts into `event.*` while still allowing
      Event Bus internal failure emission.

#### Frontend tasks

- [ ] None.

#### Tests required

- [ ] Verify mixed sync/async handlers are invoked in registration order.
- [ ] Verify `publish()` waits for delayed async handlers to settle.
- [ ] Verify throwing handler does not stop later handlers.
- [ ] Verify rejected async handler does not stop later handlers.
- [ ] Verify original `publish()` resolves successfully even when handlers
      fail.
- [ ] Verify exactly one `event.handler_failed` event per failing handler.
- [ ] Verify external caller cannot publish `event.*`.

#### Validation condition

> A reviewer can trigger thrown and rejected handlers, still observe later
> deliveries, inspect emitted `event.handler_failed`, and see original
> `publish()` resolve successfully after all work settles.

---

### Phase 3: Immutability, Types, and Package Finish

**Goal**: Lock payload immutability contract, finalize exported types, and make
package ready for downstream consumers.

**Blocked by**: Phase 2

#### Backend tasks

- [ ] Shallow-freeze payload before dispatch.
- [ ] Define exported TypeScript types so payload properties are `readonly` by
      convention.
- [ ] Finalize package exports and public type surface.
- [ ] Add concise package README or top-level package comment only if needed
      for consumer clarity.

#### Frontend tasks

- [ ] None.

#### Tests required

- [ ] Verify attempted payload mutation does not change values seen by later
      handlers.
- [ ] Verify exported types support readonly payload declarations.
- [ ] Verify full package can be imported and used through public entry point
      only.

#### Validation condition

> A reviewer can mutate payload in publisher or subscriber and confirm shallow
> immutability holds, then import package from its public entry point without
> touching internals.

---

## 4. Dependency Checklist

This checklist is a **hard gate**. No phase may begin code implementation until
all packages used in that phase have `opensrc` complete.

### No external runtime package

- **Version**: n/a
- **Used in**: Phases 0-3
- **TRD section**: Section 3
- **opensrc command run**:
  ```bash
  # No package path run because Event Bus introduces no external runtime dependency.
  ```
- **Source files read**:
  - None
- **Call pattern confirmed from source**:
  ```ts
  // No third-party package call pattern applies in this feature.
  ```
- **Error cases to handle**:
  - None from third-party source; all error behavior is owned in-package
- **opensrc complete**: Yes — gate satisfied by "no external runtime package"

---

**Summary table**:

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| None | n/a | Phases 0-3 | Yes | No external runtime dependency introduced; implementation uses built-in JS/TS behavior only |

## 5. Test Requirements

Global test requirements across all phases.

- Test external behavior only: match rules, order, immutability, failure
  surfacing, unsubscribe semantics, and instance isolation.
- Prefer package-level behavior tests over testing private helper functions.
- Keep one test per observable rule from PRD acceptance criteria, with some
  tests covering multiple criteria where behavior naturally overlaps.
- Use small inline payload fixtures; no heavy mocks or fake frameworks needed.
- Run root validation commands after each completed phase because this package
  becomes first workspace reference and can affect build graph, lint scope, and
  typecheck behavior.

## 6. Rollout Notes

- No feature flag needed. Package is inert until another package imports and
  subscribes.
- No migration or compatibility shim needed because no prior Event Bus exists.
- Keep package files small and focused; if implementation starts to spread
  complex matching or dispatch rules across too many files, stop and refactor
  for locality before adding more behavior.
