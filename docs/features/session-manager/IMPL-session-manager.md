# Implementation Plan: Session Manager

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: In-process session lifecycle manager — create, suspend, resume, destroy with resource tracking and Event Bus integration.
- PRD: [PRD-session-manager.md](./PRD-session-manager.md)
- TRD: [TRD-session-manager.md](./TRD-session-manager.md)
- FLOW: [FLOW-session-manager.md](./FLOW-session-manager.md)

## 1. Planning Principles

1. **Store first, side effects second.** The session store is a plain Map with no timers or events. Timers and events are layered on top. This keeps the core state machine testable in isolation.
2. **Timers are virtualizable.** TimerManager accepts a `setTimeout`/`clearTimeout` override so tests can fast-forward time without `vi.useFakeTimers` leaking across the whole suite.
3. **Events fire after state change.** All events are published after the store is updated. A failed publish never rolls back state.
4. **Resource tracking is an independent concern.** Resource records live in a separate Map from session records. The resource tracker and the session store are composed in the factory but could be split later.
5. **Event-bus is only dep.** No external npm packages. Only `@platform/event-bus` (workspace). OpenSRC is N/A — event-bus is self-built and its full source is already known.

## 2. Current Baseline

- Event bus is shipped and operational: `EventBus.publish()`, `EventBus.subscribe()`, `Subscription.unsubscribe()`, prefix wildcards, shallow freeze, `event.*` reserved namespace.
- Capability registry is shipped and operational: 23 tests pass, all 17 acceptance criteria covered.
- No session types, store, or timers exist anywhere in the codebase.
- No package `@platform/session-manager` exists.

Regression check for every phase: `npm run test -- --run && npm run typecheck && npm run lint` for all packages (event-bus, capability-registry, session-manager).

## 3. Phase Plan

---

### Phase 0: Package scaffold + types

**Goal**: Create the package, define all types, wire workspace dependency to event-bus. No runtime behavior yet.

**Why this phase first**: Every subsequent phase depends on these types being available.

#### Tasks

- [ ] Create `packages/session-manager/` with `package.json` following event-bus pattern (ESM, private, named `@platform/session-manager`)
- [ ] Add `@platform/event-bus` as workspace dependency in `package.json`
- [ ] Create `tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`, `outDir: dist`
- [ ] Define core data types in `src/types.ts`:
  - `SessionStatus = 'active' | 'suspended' | 'archived'`
  - `SessionRecord { id, status, ownerId, adapterType, createdAt, lastActivityAt, idleTimeoutMs, suspendedTtlMs, destroyedAt?, metadata? }`
  - `ResourceRecord { id, type, runtimeId, attachedAt }`
  - `SessionManagerConfig { defaultIdleTimeoutMs, defaultSuspendedTtlMs, archiveTtlMs, clock }`
  - `CreateSessionParams { ownerId, adapterType, metadata? }`
  - `SessionNotFoundError`, `SessionArchivedError`, `SessionAlreadyActiveError`, `SessionNotActiveError`, `DuplicateResourceError`, `ValidationError` (custom error classes or branded strings)
  - `EventPayloads`: `SessionCreatedPayload`, `SessionSuspendedPayload`, `SessionResumedPayload`, `SessionDestroyedPayload`, `CleanupResourcesPayload`
  - `SessionManager` interface with `create()`, `resume()`, `destroy()`, `getStatus()`, `attachResource()`, `detachResource()`, `listResources()`
- [ ] Create `src/index.ts` that re-exports from `types.ts` (factory placeholder)
- [ ] Add workspace reference in root `tsconfig.json`

#### Validation condition

> `npm run build` compiles successfully. `import { SessionStatus } from "@platform/session-manager"` resolves. `npm test` passes (placeholder test).

#### Regression check

> `npm run test -- --run` for event-bus and capability-registry still pass. Root `npm run typecheck` passes.

---

### Phase 1: Core store + session lifecycle API

**Goal**: In-memory session store with `create()`, `resume()`, `destroy()`, `getStatus()` — no timers, no events, no resource tracking.

**Blocked by**: Phase 0

#### Tasks

- [ ] Implement internal store type: `Map<SessionId, SessionRecord>`
- [ ] Implement `createSessionManager(config?)` factory that returns the `SessionManager` interface
- [ ] Implement `create(params)`:
  - Generate UUID v4 for session ID
  - Merge default config with per-session metadata overrides (idleTimeoutMs, suspendedTtlMs)
  - Validate input (non-empty ownerId, valid adapterType, timeout >= 1000)
  - Create `SessionRecord` with status `active`, timestamps set
  - Store in session map
  - Return the record
- [ ] Implement `resume(sessionId)`:
  - Look up session, throw `SessionNotFoundError` if missing
  - Throw `SessionArchivedError` if archived
  - Throw `SessionAlreadyActiveError` if active
  - Set status to `active`, update `lastActivityAt`
  - Return updated record
- [ ] Implement `destroy(sessionId, reason?)`:
  - Look up session, return no-op if already archived
  - Set status to `archived`, set `destroyedAt`
  - Return updated record
- [ ] Implement `getStatus(sessionId)`:
  - Look up session, throw `SessionNotFoundError` if missing
  - Return `status` field

#### Tests required

- [ ] `create()` returns session with `id`, status `active`, all timestamps set
- [ ] `create()` with metadata overrides applies `idleTimeoutMs` and `suspendedTtlMs`
- [ ] `create()` with missing ownerId throws `ValidationError`
- [ ] `create()` with invalid `idleTimeoutMs` (must be a positive finite number) throws `ValidationError`
- [ ] `create()` with invalid `suspendedTtlMs` (must be a positive finite number) throws `ValidationError`
- [ ] `resume()` on suspended session returns status `active`
- [ ] `resume()` on non-existent session throws `SessionNotFoundError`
- [ ] `resume()` on archived session throws `SessionArchivedError`
- [ ] `resume()` on already-active session throws `SessionAlreadyActiveError`
- [ ] `destroy()` on active session sets status to `archived` and sets `destroyedAt`
- [ ] `destroy()` on suspended session sets status to `archived`
- [ ] `destroy()` on already-archived session is a no-op (idempotent)
- [ ] `getStatus()` returns correct status for each state
- [ ] `getStatus()` on non-existent session throws `SessionNotFoundError`

#### Validation condition

> All session lifecycle operations work correctly without timers or events. Store state is verifiable after each operation.

---

### Phase 2: TimerManager — idle timeout + suspended TTL

**Goal**: Automatic state transitions on timeout — Active -> Suspended (idle), Suspended -> Archived (TTL). TimerManager with injectable time functions for testability.

**Blocked by**: Phase 1

#### Tasks

- [ ] Implement `TimerManager` class:
  - Accepts `setTimeout`/`clearTimeout` overrides (default: global `setTimeout`/`clearTimeout`)
  - Exposes `startIdleTimer(sessionId, timeoutMs, onTimeout)` — single-shot timer
  - Exposes `startSuspendedTimer(sessionId, timeoutMs, onTimeout)` — single-shot timer
  - Exposes `cancelAll(sessionId)` — cancels both timers for a session
  - Exposes `touch(sessionId)` — resets idle timer (cancel + restart)
  - Resolution: per-session timers drive every transition; no shared polling loop. `Clock` injection lets tests advance virtual time deterministically.
- [ ] Wire `TimerManager` into `createSessionManager` factory
- [ ] On `create()`: start idle timer; on timeout -> set status to `suspended`, start suspended TTL timer
- [ ] On `resume()`: cancel suspended TTL timer, restart idle timer
- [ ] On `destroy()`: cancel all timers for the session
- [ ] On every capability call (via internal `touch()`): reset idle timer
- [ ] On suspended TTL timeout: call `destroy(sessionId, "expired")`
- [ ] On idle timeout: transition session to `suspended`, update `lastActivityAt`, start suspended TTL timer

#### Tests required

- [ ] Idle timeout fires after `idleTimeoutMs` of no activity, session transitions to `suspended`
- [ ] `touch()` resets the idle timer (timeout does not fire before full duration)
- [ ] `touch()` on archived session is a no-op
- [ ] Suspended TTL fires after `suspendedTtlMs`, session transitions to `archived`
- [ ] `resume()` cancels suspended TTL and restarts idle timer
- [ ] `destroy()` cancels all timers (timeout does not fire after destroy)
- [ ] TimerManager with injected `setTimeout`/`clearTimeout` works correctly
- [ ] Multiple sessions each have independent timers

#### Validation condition

> Sessions auto-suspend after idle timeout and auto-archive after suspended TTL. TimerManager uses injectable time functions so tests control time without global `vi.useFakeTimers`.

---

### Phase 3: Event publishing

**Goal**: Publish all five `session.*` events on state transitions.

**Blocked by**: Phase 2

#### Tasks

- [ ] Implement internal `EventPublisher` class:
  - Accepts `EventBus` instance
  - Exposes methods: `created(record)`, `suspended(record)`, `resumed(record)`, `destroyed(record, reason)`, `cleanupResources(sessionId)`
  - Each method constructs the payload from the `SessionRecord` and calls `eventBus.publish(eventName, payload)`
- [ ] Wire `EventPublisher` into `createSessionManager` factory
- [ ] On `create()`: publish `session.created` after store update
- [ ] On idle timeout: publish `session.suspended` after store update
- [ ] On `resume()`: publish `session.resumed` after store update
- [ ] On `destroy()`: publish `session.cleanup_resources` first, then `session.destroyed` after
- [ ] No events published for failed operations (invalid session, no-op on archived)

#### Tests required

- [ ] `create()` publishes `session.created` with correct payload
- [ ] Idle timeout publishes `session.suspended` with correct payload
- [ ] `resume()` publishes `session.resumed` with correct payload
- [ ] `destroy()` publishes `session.cleanup_resources` before `session.destroyed`
- [ ] `destroy()` with reason `"explicit"` vs `"expired"` reflected in `session.destroyed` payload
- [ ] `destroy()` on already-archived session does not publish any events
- [ ] Failed `resume()` does not publish any events
- [ ] Event payload shapes match the TRD contracts

#### Validation condition

> All five session events are published at the correct times in the correct order. No events leak from error paths.

---

### Phase 4: Resource tracking

**Goal**: `attachResource()`, `detachResource()`, `listResources()` API with cleanup on destroy.

**Blocked by**: Phase 1 (needs store), Phase 3 (needs event publishing for cleanup_resources)

#### Tasks

- [ ] Implement internal `ResourceTracker` class:
  - Internal store: `Map<SessionId, ResourceRecord[]>`
  - Exposes `attach(sessionId, resource)` — validates session is active, checks duplicate resource ID
  - Exposes `detach(sessionId, resourceId)` — removes resource, no-op if not found
  - Exposes `list(sessionId)` — returns copy of resource list for active/suspended sessions, empty array for archived
  - Exposes `clear(sessionId)` — removes all resources for a session (called after cleanup)
- [ ] Wire `ResourceTracker` into `createSessionManager` factory
- [ ] Wire cleanup flow into `destroy()`:
  1. Set status to `archived`
  2. Publish `session.cleanup_resources`
  3. Call `resourceTracker.clear(sessionId)`
  4. Publish `session.destroyed`
- [ ] Implement `attachResource(sessionId, resource)` on public API
- [ ] Implement `detachResource(sessionId, resourceId)` on public API
- [ ] Implement `listResources(sessionId)` on public API

#### Tests required

- [ ] `attachResource()` adds resource to session, `listResources()` returns it
- [ ] `attachResource()` to non-existent session throws `SessionNotActiveError`
- [ ] `attachResource()` to archived session throws `SessionNotActiveError`
- [ ] Duplicate `attachResource()` throws `DuplicateResourceError`
- [ ] `detachResource()` removes resource, `listResources()` no longer returns it
- [ ] `detachResource()` on non-existent resource is a no-op
- [ ] `listResources()` on archived session returns empty array
- [ ] On `destroy()`, `session.cleanup_resources` fires before resources are cleared
- [ ] On `destroy()`, resources are cleared before `session.destroyed` fires

#### Validation condition

> Resources are trackable per session, reject operations against inactive sessions, and are bulk-cleared on destroy in the correct event order.

---

### Phase 5: Archive purge + integration tests

**Goal**: Archived metadata auto-purge, full integration test suite, QA checklist walkthrough.

**Blocked by**: Phase 4

#### Tasks

- [ ] Implement archive purge in `TimerManager`:
  - On `destroy()`, schedule a one-shot timer for `archiveTtlMs`
  - On timeout, remove the session record from the store
- [ ] Write integration tests that cover the full lifecycle from the FLOW doc:
  - Happy path: create -> touch -> destroy
  - Idle timeout: create -> wait -> auto-suspend -> resume -> destroy
  - TTL expiry: create -> wait -> auto-suspend -> wait -> auto-archive
  - Resource lifecycle: create -> attach -> detach -> destroy
  - Full event ordering: create -> suspended -> resumed -> cleanup_resources -> destroyed
  - Error flows: resume non-existent, resume archived, attach to archived, etc.
- [ ] Add tests with `TimerManager`'s injected time functions to cover timeout scenarios without real waits
- [ ] Walk through the complete Manual QA Checklist from FLOW doc

#### Tests required

- [ ] Archived metadata is purged after `archiveTtlMs`
- [ ] Archived session cannot be resumed after purge (returns `SessionNotFoundError`)
- [ ] Full integration: create -> attach resource -> (idle timeout) -> suspend -> resume -> (touch) -> destroy -> verify events
- [ ] All error flows return correct error types and no event leaks

#### Validation condition

> Full test suite passes. QA checklist from FLOW doc can be executed step by step. Archived records are purged on schedule.

---

## 4. Dependency Checklist

Only dependency is `@platform/event-bus`, a first-party workspace package. OpenSRC not required.

### Summary table

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| `@platform/event-bus` | workspace | Phase 3 | N/A (first-party) | `publish()` is async, accepts `name + TPayload`. `event.*` is reserved. Shallow-freezes payload. |

## 5. Test Requirements

- **External behavior only.** Tests verify state transitions, return values, published events, and error types — never internal store structure or timer implementation details.
- **Prior art:** follow the pattern in `packages/event-bus/src/__tests__/` and `packages/capability-registry/src/__tests__/` (vitest, `describe`/`it` blocks, no `vi.useFakeTimers` in Phase 0-1, injectable time in Phase 2+).
- **Layer:** all unit + integration tests, no E2E (no Gateway or adapter to test against).
- **TimerManager injection:** `TimerManager` accepts `{ setTimeout, clearTimeout }` override. Tests use a controllable virtual clock to advance time by precise ms amounts.
- **Test data:** no seed data needed — each test creates its own sessions with a short `idleTimeoutMs` (100ms) and `suspendedTtlMs` (200ms) to keep tests fast.

## 6. Rollout Notes

- No feature flags needed. Session Manager has no consumer yet.
- `@platform/event-bus` is the only dependency — it must be built first when running the workspace.
- The `session.*` event namespace does not conflict with any existing namespace (`capability.*`, `event.*`, `browser.*` are all accounted for).
- Archive purge is best-effort (in-process `setTimeout`). If the process crashes, archived metadata persists until next module reload. This is acceptable for v1.
