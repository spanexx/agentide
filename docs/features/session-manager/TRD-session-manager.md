# TRD: Session Manager

## Status

- Type: Technical requirements document
- Audience: Platform engineering, QA
- Scope: In-process session lifecycle manager that creates, tracks, suspends, resumes, and destroys execution contexts, with per-session resource tracking and Event Bus integration.
- PRD: [PRD-session-manager.md](./PRD-session-manager.md)
- EXPLAINED: [EXPLAINED-session-manager.txt](./EXPLAINED-session-manager.txt)

## 1. Current Baseline

### 1.1 Data model

No session management types exist today. The only data models in the platform are:

- **Event Bus types** (`packages/event-bus/src/types.ts`): `PlatformEvent<TPayload>`, `EventHandler<TPayload>`, `HandlerFailedPayload`, `Subscription`, `EventBus` interface, `RESERVED_INTERNAL_PREFIX`
- **Capability Registry types** (`packages/capability-registry/src/types.ts`): `CapabilityRecord`, `CapabilityCard`, `DescribeResult`, `UpdatedRecord`, `RegisterResult`

No session-related types exist anywhere.

### 1.2 API surface

The only API surfaces are:

- `@platform/event-bus`: `EventBus.publish()`, `EventBus.subscribe()`
- `@platform/capability-registry`: `createCapabilityRegistry()`, `register()`, `list()`, `search()`, `describe()`

No session creation, suspension, resumption, or destruction surface exists.

### 1.3 Frontend surface

None.

### 1.4 What is missing

- No type for a session record (id, status, ownerId, timestamps, resources)
- No type for a resource record attached to a session
- No in-memory store for session records
- No state machine logic (Active / Suspended / Archived transitions with timeout policy)
- No idle timer or suspended TTL mechanism
- No `create()`, `resume()`, `destroy()`, `suspend()` API surface
- No `attachResource()` / `detachResource()` resource tracking
- No `session.*` event publishing (created, suspended, resumed, destroyed, cleanup_resources)
- No package `@platform/session-manager`

## 2. Target Architecture

### 2.1 Architecture overview

```
┌──────────────────────────────────────────────────┐
│              @platform/session-manager            │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  createSessionManager (factory function)     │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  SessionStore     │  │  TimerManager    │ │  │
│  │  │  (Map<SessionId,  │  │  (idle timeout + │ │  │
│  │  │    SessionRecord> │  │   suspended TTL) │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  ResourceTracker  │  │  EventPublisher  │ │  │
│  │  │  (Map<SessionId,  │  │  (via EventBus)  │ │  │
│  │  │   Resource[]>)    │  │                  │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  │                                              │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │  Public API:                         │   │  │
│  │  │    create(), resume(), destroy(),    │   │  │
│  │  │    getStatus(), attachResource(),    │   │  │
│  │  │    detachResource(), listResources() │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  deps: @platform/event-bus (publish session.*)     │
└──────────────────────────────────────────────────┘
         │
         │ publishes
         ▼
┌────────────────────┐
│   @platform/event- │
│   bus              │
│                    │
│ session.created    │
│ session.suspended  │
│ session.resumed    │
│ session.destroyed  │
│ session.cleanup_   │
│   resources        │
└────────────────────┘
```

The Session Manager is a factory function `createSessionManager(eventBus, config?)` that returns a public API object. Internally it composes a store, a timer manager, a resource tracker, and an event publisher. The timer manager runs in-process timeouts (no external scheduler in v1).

### 2.2 New or changed data models

#### SessionRecord (core type)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | UUID v4, generated on create |
| `status` | `'active' \| 'suspended' \| 'archived'` | Yes | Current lifecycle state |
| `ownerId` | `string` | Yes | Who requested the session (application ID or user ID) |
| `adapterType` | `string` | Yes | Originating adapter (`'mcp'`, `'cli'`, `'rest'`, `'ws'`) |
| `createdAt` | `number` | Yes | Unix ms timestamp of creation |
| `lastActivityAt` | `number` | Yes | Unix ms timestamp of last capability call |
| `idleTimeoutMs` | `number` | Yes | Idle timeout in ms (default 300000 = 5 min) |
| `suspendedTtlMs` | `number` | Yes | Suspended TTL in ms (default 1800000 = 30 min) |
| `destroyedAt` | `number \| null` | No | Unix ms timestamp of destroy, null if not destroyed |
| `metadata` | `Record<string, string>` | No | Extensible key-value store for deployment model, tenant info, etc. |

Status transitions:
- `active` -> `suspended`: idle timeout fires (TimerManager)
- `active` -> `archived`: explicit destroy via `destroy()`
- `suspended` -> `active`: `resume()` called by Gateway
- `suspended` -> `archived`: suspended TTL fires (TimerManager) or explicit destroy via `destroy()`
- `archived`: terminal state, no further transitions

#### ResourceRecord

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Resource-specific ID (e.g., tab ID, temp file path) |
| `type` | `string` | Yes | Resource type namespace (`'browser.tab'`, `'temp.file'`, `'container'`) |
| `runtimeId` | `string` | Yes | Identifier of the runtime that owns this resource |
| `attachedAt` | `number` | Yes | Unix ms timestamp of registration |

Resources are stored as a separate `Map<SessionId, ResourceRecord[]>` in the ResourceTracker. Not embedded in SessionRecord.

#### SessionManagerConfig

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `defaultIdleTimeoutMs` | `number` | No | 300000 | Global default idle timeout for new sessions |
| `defaultSuspendedTtlMs` | `number` | No | 1800000 | Global default suspended TTL for new sessions |
| `archiveTtlMs` | `number` | No | 604800000 (7 days) | How long archived records are kept before purge |
| `clock` | `Clock` | No | system clock | Optional `Clock` with `now`, `setTimeout`, `clearTimeout` for test-time virtual time |

#### Event payloads

All payloads are published as `object` shapes via `EventBus.publish()` per the event bus contract.

**SessionCreatedPayload:**
```typescript
interface SessionCreatedPayload {
  sessionId: string;
  ownerId: string;
  adapterType: string;
  createdAt: number;
}
```

**SessionSuspendedPayload:**
```typescript
interface SessionSuspendedPayload {
  sessionId: string;
  lastActivityAt: number;
  suspendedAt: number;
}
```

**SessionResumedPayload:**
```typescript
interface SessionResumedPayload {
  sessionId: string;
  resumedAt: number;
}
```

**SessionDestroyedPayload:**
```typescript
interface SessionDestroyedPayload {
  sessionId: string;
  reason: 'expired' | 'explicit';
  destroyedAt: number;
  duration: number; // ms between createdAt and destroyedAt
}
```

**CleanupResourcesPayload:**
```typescript
interface CleanupResourcesPayload {
  sessionId: string;
}
```

### 2.3 API contracts

All functions are synchronous in-process calls returning plain values. No async I/O (in-memory store, no network calls). The Event Bus publish is the only async operation.

#### `createSessionManager(eventBus: EventBus, config?: SessionManagerConfig): SessionManager`

Factory function. Returns a SessionManager instance.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `eventBus` | `EventBus` | Yes | Event Bus instance for publishing session.* events |
| `config` | `SessionManagerConfig` | No | Override default timeouts and TTLs |

#### `create(params: CreateSessionParams): SessionRecord`

Creates a new session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ownerId` | `string` | Yes | Who requested the session |
| `adapterType` | `string` | Yes | Originating adapter |
| `metadata` | `Record<string, string>` | No | Extensible metadata, may include `idleTimeoutMs`, `suspendedTtlMs` overrides |

**Response:** `SessionRecord` with status `'active'`, generated UUID, timestamps set.

**Errors:**
- Missing or empty `ownerId`: throw `ValidationError`
- Unknown `adapterType`: throw `ValidationError`
- `metadata.idleTimeoutMs` < 1 (must be a positive finite number): throw `ValidationError`
- `metadata.suspendedTtlMs` < 1 (must be a positive finite number): throw `ValidationError`

**Side effects:** Publishes `session.created`. Starts idle timeout timer.

#### `resume(sessionId: string): SessionRecord`

Resumes a suspended session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session to resume |

**Response:** `SessionRecord` with status `'active'`, `lastActivityAt` updated.

**Errors:**
- Session not found: throw `SessionNotFoundError`
- Session status is `'archived'`: throw `SessionArchivedError`
- Session status is `'active'`: throw `SessionAlreadyActiveError`

**Side effects:** Publishes `session.resumed`. Starts idle timeout timer. Cancels suspended TTL timer.

#### `destroy(sessionId: string, reason?: 'expired' | 'explicit'): SessionRecord`

Destroys a session from Active or Suspended state.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session to destroy |
| `reason` | `'expired' \| 'explicit'` | No | Defaults to `'explicit'` |

**Response:** `SessionRecord` with status `'archived'`, `destroyedAt` set.

**Errors:**
- Session not found: throw `SessionNotFoundError`
- Session already archived: no-op, not an error (idempotent)

**Side effects in order:**
1. Cancel all timers for this session
2. Set status to `'archived'`, set `destroyedAt`
3. Publish `session.cleanup_resources`
4. Clear resource tracking list for this session
5. Publish `session.destroyed`
6. Schedule archive record cleanup (after `archiveTtlMs`)

#### `getStatus(sessionId: string): SessionStatus`

Returns the current status of a session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session |

**Response:** `'active' | 'suspended' | 'archived'`.

**Errors:**
- Session not found: throw `SessionNotFoundError`

#### `attachResource(sessionId: string, resource: ResourceRecord): void`

Registers a resource against a session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session |
| `resource` | `ResourceRecord` | Yes | Resource to register (id, type, runtimeId) |

**Errors:**
- Session not found or archived: throw `SessionNotActiveError`
- Resource ID already registered for this session: throw `DuplicateResourceError`

#### `detachResource(sessionId: string, resourceId: string): void`

Removes a resource registration from a session (called by a runtime when it cleans up a resource independently, before the session destroy flow).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session |
| `resourceId` | `string` | Yes | ID of the resource to detach |

**Errors:**
- Session not found: throw `SessionNotFoundError`
- Resource not found: no-op (idempotent)

#### `listResources(sessionId: string): ResourceRecord[]`

Returns all resources registered against a session. Returns empty array for archived sessions (resources already cleaned up).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | `string` | Yes | ID of the session |

**Errors:**
- Session not found: throw `SessionNotFoundError`

### 2.4 Frontend changes

None. The Dashboard will subscribe to `session.*` events but does not call Session Manager directly — that is a future frontend concern.

## 3. Dependency Analysis

### 3.1: `@platform/event-bus`

**Version**: resolved from workspace (already shipped, branch `main`).
**Purpose**: publish session lifecycle events (`session.*`) so runtimes, Dashboard, and Plugin Manager can react.

**opensrc inspection**: not required — `@platform/event-bus` is a first-party workspace package built in the same monorepo. Its source is at `packages/event-bus/src/`. All 29 tests pass, 17 acceptance criteria covered. The `publish()` and `subscribe()` contracts are confirmed by [TRD-event-bus.md](../event-bus/TRD-event-bus.md) and the existing test suite.

**Why not alternatives**:
- Direct publish via a third-party event emitter (e.g., Node `EventEmitter`): rejected because the Event Bus is the platform's canonical pub/sub layer. Using it directly ensures cross-component decoupling and consistency with every other pack.
- No event bus at all (callbacks/lifecycle hooks only): rejected because runtimes, Dashboard, and Plugin Manager need decoupled subscription to session lifecycle without direct imports from session-manager.

### Summary table

| Package | Version | Purpose | Source-confirmed behavior |
|---|---|---|---|
| `@platform/event-bus` | workspace | Publish session.* events | `publish()` is async, accepts `name + TPayload`, shallow-freezes payload. `event.*` reserved. |

## 4. Migration Strategy

### 4.1 Additive phase

Everything is additive. No existing package or component touches session management. The Session Manager can be shipped alongside all existing packages without changing anything.

### 4.2 Migration / transition phase

None. No existing code needs migration.

### 4.3 Compatibility rails

None needed. Session Manager is a new package with no consumers yet.

### 4.4 Rollback plan

Remove the `@platform/session-manager` package from the workspace. No other component depends on it.

## 5. Open Questions

- [ ] Should `create()` accept an explicit `sessionId` from the Gateway (allowing idempotent create), or always generate its own UUID? Current design: always generate. If Gateway needs idempotency, it stores the generated ID.
- [x] Should `timerResolutionMs` be configurable or fixed? Resolved: removed in favour of a `Clock` abstraction (`SessionManagerConfig.clock`) so tests can virtualise time without a polling loop.

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| Cross-process session coordination | v1 is in-process with Gateway. Multi-gateway sharing is a future deployment concern. | When the Gateway is deployed as a distributed service. |
| Resume token / auth on resume | Gateway is sole caller and already authenticates. Token adds complexity with no threat. | If resume() is ever exposed to external callers directly. |
| Persistent storage of session archive | v1 is in-memory. Persisting archived records across restarts requires a storage backend decision. | When Dashboard "recent sessions" across restarts is required. |
| Resource type schema validation | Session Manager tracks resources by opaque type string. Runtime-specific validation belongs in each runtime. | When a runtime needs to validate its own resource records at registration time. |
