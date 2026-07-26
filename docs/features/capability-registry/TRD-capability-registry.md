# TRD: Capability Registry

## Status

- Type: Technical requirements document
- Audience: Platform engineering, QA
- Scope: In-memory catalog that stores every capability offered by applications, runtime plugins, and the platform core, and serves read-only discovery of that catalog.
- PRD: [PRD-capability-registry.md](./PRD-capability-registry.md)
- EXPLAINED: [EXPLAINED-capability-registry.txt](./EXPLAINED-capability-registry.txt)

## 1. Current Baseline

### 1.1 Data model

No capability registry exists today. The only data model in the platform is the event bus types (`PlatformEvent<TPayload>`, `EventHandler<TPayload>`, `HandlerFailedPayload`, `EventBus` interface) in `packages/event-bus/src/types.ts`. No capability-related types exist anywhere.

### 1.2 API surface

The only API surface is `EventBus.publish()` and `EventBus.subscribe()` in `@platform/event-bus`. No capability discovery surface exists.

### 1.3 Frontend surface

None.

### 1.4 What is missing

- No type for a capability record (name, version, type, description, input/output schemas, permissions, owner)
- No in-memory store for capability records
- No owner-scoped register / replace logic
- No `(name, version)` clash detection
- No `list()`, `search()`, `describe()` read surface
- No `capability.registered`, `capability.updated`, `capability.removed` event publishing
- No package `@platform/capability-registry`

## 2. Target Architecture

### 2.1 Architecture overview

```
┌──────────────────────────────────────────────────┐
│              @platform/capability-registry        │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  CapabilityRegistry (factory function)       │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  Internal Store   │  │  Event Publisher │ │  │
│  │  │  (Map<Owner,      │  │  (via EventBus)  │ │  │
│  │  │    Map<Key,       │  │                  │ │  │
│  │  │     Capability>>) │  │                  │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  Write Path       │  │  Read Path       │ │  │
│  │  │  .register()      │  │  .list()         │ │  │
│  │  │  (internal)       │  │  .search()       │ │  │
│  │  │                   │  │  .describe()     │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  deps: @platform/event-bus (publish capability.*)  │
└──────────────────────────────────────────────────┘
         │
         │ publishes
         ▼
┌────────────────────┐
│   @platform/event- │
│   bus              │
│                    │
│ capability.registered
│ capability.updated
│ capability.removed
└────────────────────┘
```

The registry is a factory function `createCapabilityRegistry(eventBus)` that returns a public interface with read methods. The write path (`register`) is a plain function on the returned object — not on the Event Bus — so only platform internals can call it.

### 2.2 New or changed data models

#### CapabilityRecord (core type)

| Field | Type | Required | Notes |
|---|---|---|---|
| name | `string` | yes | `<domain>.<action>`, validated as dot-delimited identifier |
| version | `string` | yes | non-empty, opaque string (semver-like but not enforced in v1) |
| type | `CapabilityType` | yes | `"business" \| "platform" \| "runtime"` |
| description | `string` | yes | free-text, must be non-empty |
| inputSchema | `object` | no | JSON Schema object, well-formed check only |
| outputSchema | `object` | no | JSON Schema object, well-formed check only |
| permissions | `string[]` | yes | array of scope strings, may be empty |
| owner | `string` | yes | owner ID passed at register time (not in manifest) |

#### CapabilityCard (list/search return)

| Field | Type | Notes |
|---|---|---|
| name | `string` | from CapabilityRecord |
| version | `string` | from CapabilityRecord |
| type | `CapabilityType` | from CapabilityRecord |
| description | `string` | from CapabilityRecord (first line / short form) |

#### Key type: `(name, version)` pair

The unique key for a capability is the tuple `{ name, version }`, stored as a single compound string `"<name>␟<version>"` (using ASCII unit separator `\x1F` to avoid collisions with valid name/version characters).

#### CapabilityRegisteredPayload (event payload)

| Field | Type | Notes |
|---|---|---|
| capability | `CapabilityRecord` | full record as registered |

#### CapabilityUpdatedPayload (event payload)

| Field | Type | Notes |
|---|---|---|
| previous | `CapabilityRecord` | record before update |
| current | `CapabilityRecord` | record after update |

#### CapabilityRemovedPayload (event payload)

| Field | Type | Notes |
|---|---|---|
| capability | `CapabilityRecord` | last known record before removal |

#### DescribeResult (describe return)

| Field | Type | Notes |
|---|---|---|
| capability | `CapabilityRecord \| null` | the matched record, or null if not found |
| selectedVersion | `string \| null` | which version was returned (null if not found) |
| note | `string \| undefined` | human-readable note when multiple versions existed and one was auto-selected |

### 2.3 API contracts

#### `createCapabilityRegistry(eventBus)`

Factory function. Returns a `CapabilityRegistry` interface.

**Request**: `eventBus: EventBus`
**Response**: `CapabilityRegistry`

#### `register(owner, manifest)` — internal write path

**Request**:
```
owner: string
manifest: {
  owner: string
  capabilities: CapabilityRecord[]
}
```

**Response**: `Promise<RegisterResult>`
```
RegisterResult = {
  added: CapabilityRecord[]
  updated: CapabilityRecord[]
  removed: CapabilityRecord[]
}
```

**Error cases**:
- `owner` mismatch between function parameter and manifest.owner → reject
- Any capability record missing required field → reject, no mutation
- Any capability with unrecognized type → reject, no mutation
- Clash on `(name, version)` with record owned by different owner → reject with specific error naming the clash, no mutation
- Empty capabilities array → valid (clears owner's list)
- All validations pass → succeed, replace owner's list, emit events

**Events emitted** (in registration order, after catalog updated):
- `capability.registered` for each added record
- `capability.updated` for each changed record
- `capability.removed` for each removed record

#### `list()` — public read

**Request**: none
**Response**: `CapabilityCard[]`
**Error cases**: none (returns empty array if empty)

#### `search(query)` — public read

**Request**: `query: string`
**Response**: `CapabilityCard[]`
**Error cases**: empty query returns empty array (not error)
**Behavior**: case-insensitive substring match on `name` and `description` fields

#### `describe(name, version?)` — public read

**Request**:
```
name: string
version?: string
```

**Response**:
```
{
  capability: CapabilityRecord | null
  selectedVersion: string | null
  note?: string
}
```

**Behavior when version omitted**:
- If exactly one version exists → return that record
- If multiple versions exist → return latest (by string comparison of version), set `note` to `"auto-selected version <X> from <N> available"`
- If no record for name → return `{ capability: null, selectedVersion: null }`

### 2.4 Frontend changes

None. This is a backend-only package.

## 3. Dependency Analysis

### 3.1: `@platform/event-bus` (workspace dependency)

**Version**: workspace `*` (resolved to local monorepo package)
**Purpose**: publish `capability.*` lifecycle events (registered, updated, removed) after each successful register call.

The event-bus is a self-built workspace package. Its full source is at `packages/event-bus/src/`. Key contracts already verified in prior work:
- `EventBus.publish<TPayload>(name, payload)` — returns `Promise<void>`, shallow-freezes payload
- `RESERVED_INTERNAL_PREFIX = "event."` — registry publishes under `capability.*`, no conflict
- `PlatformEvent<TPayload>` — handlers receive `{ name, payload, id, publishedAt }`
- Events are fire-and-forget — registry publishes but does not await subscriber completion

**No external npm dependencies introduced.** The capability-registry is pure platform code: in-memory Map operations and event-bus publish calls only.

**Summary table**:

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| `@platform/event-bus` | workspace `*` | Publish `capability.*` events | Publish shallow-freezes payload, returns `Promise<void>`, `event.*` reserved for internal use | N/A — only viable event bus |

## 4. Migration Strategy

### 4.1 Additive phase

Everything is additive. No existing code is touched:
- New package `@platform/capability-registry` at `packages/capability-registry/`
- New types (CapabilityRecord, CapabilityCard, etc.)
- New factory function `createCapabilityRegistry`
- New tests

### 4.2 Migration / transition phase

None. No consumers exist yet.

### 4.3 Compatibility rails

None needed.

### 4.4 Rollback plan

Remove the package. No consumer depends on it yet.

## 5. Open Questions

- None at TRD level. The PRD resolved all product questions; the technical design is straightforward in-memory Map operations + event-bus publish.

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| Deep JSON-schema validation of input/output schemas | Well-formed metadata check only in v1 | When a schema-validating middleware or capability execution pack exists |
| Semver-aware default version selection | "Latest by string compare" is sufficient for v1 | When version strings are guaranteed semver and a use case demands proper ordering |
| Persistent storage | v1 is in-memory only, rebuilt on startup | When platform has a chosen storage backend and restart tolerance is measured |
| Tenant-isolated catalog views | Multi-tenant design is not settled in CONTEXT.md | When tenant isolation semantics are resolved |
| Atomic multi-owner register | v1 register is single-owner per call | When a startup orchestration pack (Gateway) needs to batch-register many owners atomically |
