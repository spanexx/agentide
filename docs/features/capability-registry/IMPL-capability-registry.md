# Implementation Plan: Capability Registry

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: In-memory catalog that stores every capability offered by applications, runtime plugins, and the platform core, and serves read-only discovery of that catalog.
- PRD: [PRD-capability-registry.md](./PRD-capability-registry.md)
- TRD: [TRD-capability-registry.md](./TRD-capability-registry.md)
- FLOW: [FLOW-capability-registry.md](./FLOW-capability-registry.md)

## 1. Planning Principles

1. **Pure data first.** The store is a plain Map with no side effects. Events are published after store mutation, not in the same step. This keeps the store testable without the event bus.
2. **Register is atomic.** A single `register` call either fully replaces the owner's catalog or fails with no mutation. Partial writes must not happen.
3. **Read path is snapshot.** `list()`, `search()`, `describe()` always return new shallow copies, never internal references. Mutating a return value never affects the catalog.
4. **Events fire after commit.** All events for a register call are emitted after the store is updated, in manifest registration order. A catastrophic event bus failure does not roll back the store.
5. **Event-bus is only dep.** No external npm packages. Only `@platform/event-bus` (workspace). `opensrc` is N/A — event-bus is self-built and its full source is already known.

## 2. Current Baseline

- Event bus is shipped and operational: `EventBus.publish()`, `EventBus.subscribe()`, `Subscription.unsubscribe()`, prefix wildcards, shallow freeze, `event.*` reserved namespace.
- No capability types, store, or discovery exist anywhere in the codebase.
- No package `@platform/capability-registry` exists.

Regression check for every phase: `npm run test -- --run && npm run typecheck && npm run lint` for both event-bus and capability-registry.

## 3. Phase Plan

---

### Phase 0: Package scaffold + types

**Goal**: Create the package, define all types, wire workspace dependency to event-bus. No runtime behavior yet.

**Why this phase first**: Every subsequent phase depends on these types being available.

#### Tasks

- [ ] Create `packages/capability-registry/` with `package.json` following event-bus pattern (ESM, private, named `@platform/capability-registry`)
- [ ] Add `@platform/event-bus` as workspace dependency in `package.json`
- [ ] Create `tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`, `outDir: dist`
- [ ] Define core data types in `src/types.ts`:
  - `CapabilityType = "business" | "platform" | "runtime"`
  - `CapabilityRecord { name, version, type, description, inputSchema?, outputSchema?, permissions, owner }`
  - `CapabilityCard { name, version, type, description }`
  - `DescribeResult { capability: CapabilityRecord | null, selectedVersion: string | null, note?: string }`
  - `RegisterResult { added: CapabilityRecord[], updated: CapabilityRecord[], removed: CapabilityRecord[] }`
  - `EventPayloads`: `CapabilityRegisteredPayload`, `CapabilityUpdatedPayload`, `CapabilityRemovedPayload`
  - `CapabilityRegistry` interface with `register()`, `list()`, `search()`, `describe()`
- [ ] Create `src/index.ts` that re-exports from `types.ts` (empty factory for now — Phase 1 fills it)
- [ ] Add workspace reference in root `tsconfig.json`
- [ ] Create `CHANGELOG.md` placeholder

#### Validation condition

> `npm run build` compiles successfully. `import { CapabilityType } from "@platform/capability-registry"` resolves. `npm test` passes (placeholder test).

#### Regression check

> `npm run test -- --run` for event-bus still passes (29/29). Root `npm run typecheck` passes.

---

### Phase 1: Core store + register write path

**Goal**: In-memory store with owner-scoped register that validates records, detects cross-owner clashes, replaces owner's previous list, and returns the diff. No event publishing yet.

**Blocked by**: Phase 0

#### Tasks

- [ ] Implement internal composite key `makeKey(name, version)` using ASCII `\x1F` separator
- [ ] Implement internal store type: `Map<OwnerId, Map<Key, CapabilityRecord>>`
- [ ] Implement `register(owner, manifest)`:
  - Validate owner match between param and manifest.owner
  - Validate each record (name format, non-empty version, valid type, non-empty description)
  - Check cross-owner clashes against global (not owner-scoped) index
  - Diff old vs new for the owner
  - Update store
  - Return `{ added, updated, removed }`
- [ ] Proper error types for validation failure, clash rejection
- [ ] Expose `createCapabilityRegistry()` factory returning `CapabilityRegistry` interface

#### Tests required

- [ ] Register with valid manifest adds all records
- [ ] Register twice from same owner: second call replaces, old entries removed
- [ ] Register unchanged records produces empty added/updated/removed
- [ ] Cross-owner clash is rejected with specific error, catalog unchanged
- [ ] Validation failures (missing name, invalid type, empty description) rejected with no mutation
- [ ] Owner mismatch between param and manifest.owner rejected
- [ ] Empty capabilities array clears owner's list
- [ ] Multiple owners coexist without interfering
- [ ] Returned arrays are new copies (no internal reference leak)

#### Validation condition

> All register tests pass. Store correctly isolates owners. Clash detection catches cross-owner conflicts. Register returns correct diff.

---

### Phase 2: Read path

**Goal**: Implement `list()`, `search()`, `describe()` on the store. No event bus involvement.

**Blocked by**: Phase 1

#### Tasks

- [ ] Implement `list()` — iterate all owners, return `CapabilityCard[]` (new array, shallow copies)
- [ ] Implement `search(query)` — case-insensitive substring match on `name` and `description`, return cards in registration order
- [ ] Implement `describe(name, version?)`:
  - With version: exact match across all owners
  - Without version: find all versions for that name, single match returns that version, multiple returns latest (string compare) + note

#### Tests required

- [ ] `list()` returns all capabilities across owners
- [ ] `list()` returns cards (not full records)
- [ ] `list()` result mutation does not affect catalog
- [ ] `search(query)` matches name and description case-insensitively
- [ ] `search("")` returns empty
- [ ] `search` results in registration order
- [ ] `describe(name, version)` returns exact record
- [ ] `describe(name)` with single version returns that version
- [ ] `describe(name)` with multiple versions returns latest + note
- [ ] `describe(name)` with no match returns null
- [ ] `describe` result mutation does not affect catalog

#### Validation condition

> All read-path tests pass. Read results are independent snapshots. Describe version resolution works correctly for all cases.

---

### Phase 3: Event publishing

**Goal**: Wire the register path to publish `capability.registered`, `capability.updated`, `capability.removed` on the event bus after each successful register. No new store behavior.

**Blocked by**: Phase 1, Phase 2

#### Tasks

- [ ] Accept `EventBus` in `createCapabilityRegistry(eventBus)` factory
- [ ] After store update in `register()`, publish events:
  - `capability.registered` with `{ capability: CapabilityRecord }` for each added record
  - `capability.updated` with `{ previous: CapabilityRecord, current: CapabilityRecord }` for each changed record
  - `capability.removed` with `{ capability: CapabilityRecord }` for each removed record
- [ ] Emit in registration order (manifest order), not grouped by type
- [ ] Do not emit events for unchanged records
- [ ] On event bus publish failure, log but do not roll back the store

#### Tests required

- [ ] Register emits `capability.registered` for each added record
- [ ] Register emits `capability.updated` for each changed record with both previous and current
- [ ] Register emits `capability.removed` for each removed record
- [ ] Events emitted in registration order
- [ ] No events emitted for unchanged records
- [ ] Failed register (validation error) emits no events
- [ ] Using a mock event bus, verify publish is called with correct event names and payloads

#### Validation condition

> All event tests pass. Register emits correct events with correct payloads in correct order. Failed register emits no events.

---

### Phase 4: Validation + polish

**Goal**: Tighten validation, add edge-case handling, run full QA checklist.

**Blocked by**: Phase 0, Phase 1, Phase 2, Phase 3

#### Tasks

- [ ] Name format validation: must match `<domain>.<action>` pattern (at least one dot)
- [ ] Version non-empty check
- [ ] Type enum check
- [ ] Description non-empty
- [ ] Permissions array check (must be array of strings)
- [ ] Input/output schema well-formed check (must be object if present)
- [ ] Ensure all errors are descriptive (include field name + value)
- [ ] Run full QA checklist from FLOW doc

#### Tests required

- [ ] Invalid name format rejected
- [ ] Missing version rejected
- [ ] Unknown type rejected
- [ ] Missing description rejected
- [ ] Permissions not an array rejected
- [ ] Error messages include specific field info

#### Validation condition

> Full QA checklist passes. All tests pass. No edge case produces silent failure or incorrect state.

---

## 4. Dependency Checklist

### `@platform/event-bus` (workspace)

- **Version**: workspace `*`
- **Used in**: Phase 3
- **TRD section**: Section 3.1
- **opensrc command run**: N/A — self-built workspace package. Source at `packages/event-bus/src/` is already known from prior implementation.
- **Source files read**: `packages/event-bus/src/types.ts`, `packages/event-bus/src/index.ts`, `packages/event-bus/src/match.ts`
- **Call pattern confirmed from source**:
  ```ts
  import { createEventBus, type EventBus } from "@platform/event-bus";
  const bus = createEventBus();
  await bus.publish("capability.registered", { capability });
  ```
- **Error cases to handle**:
  - Event bus publish returns `Promise<void>` — must await
  - Publish can throw if event name starts with `event.` reserved namespace (we use `capability.*`, safe)
- **opensrc complete**: Yes (self-built, full source known)

**Summary table**:

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| `@platform/event-bus` | workspace `*` | Phase 3 | Yes | `publish` returns `Promise<void>`, shallow-freezes payload, `event.*` reserved |

## 5. Test Requirements

- All tests must exercise **external behavior only**: call the public `CapabilityRegistry` interface, assert on return values and published events. Never access internal Maps directly.
- Follow same pattern as event-bus tests: `describe`/`it`/`expect` with vitest, one file per concern.
- Use a real `createEventBus()` for Phase 1-2 tests (event bus not needed). Use a mock or real event bus for Phase 3 tests.
- For event assertion tests, subscribe to `capability.*` patterns and collect events, then assert on the collected list.
- Test data: inline factory functions like `makeCapability(name, version)` to keep test setup compact.

## 6. Rollout Notes

- No feature flags needed. The registry has no consumers yet — it is safe to ship behind no gate.
- Package is additive: no existing code is modified or deprecated.
- After ship, the first consumer will be the startup orchestration in a future Gateway pack.
