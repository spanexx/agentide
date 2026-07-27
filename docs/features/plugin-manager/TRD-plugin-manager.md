# TRD: Plugin Manager

## Status

- Type: Technical requirements document
- Audience: Backend, QA
- Scope: In-process control-plane component that installs, updates, disables, enables, reloads, lists, and uninstalls plugins from a local Plugin Manifest, with persistent install state and Event Bus integration.
- PRD: [PRD-plugin-manager.md](./PRD-plugin-manager.md)
- EXPLAINED: skipped (operator-internal audience)
- Status: Approved 2026-07-27 — Phase 2 gate passed. Phase 1 PRD approved; ready for FLOW.

## 1. Current Baseline

### 1.1 Data model

The relevant existing types in the platform are:

- **Event Bus types** (`packages/event-bus/src/types.ts`): `PlatformEvent<TPayload>`, `EventHandler<TPayload>`, `HandlerFailedPayload`, `Subscription`, `EventBus` interface, `RESERVED_INTERNAL_PREFIX`
- **Capability Registry types** (`packages/capability-registry/src/types.ts`): `CapabilityType`, `CapabilityRecord`, `CapabilityCard`, `DescribeResult`, `UpdatedRecord`, `RegisterResult`, `CapabilityRegisteredPayload`, `CapabilityUpdatedPayload`, `CapabilityRemovedPayload`, `CapabilityRegistry`
- **Session Manager types** (`packages/session-manager/src/types.ts`): `SessionRecord`, `ResourceRecord`, `SessionManager`, `SessionManagerConfig`, `Clock`, plus its own event payload types and error classes (all under `session.*` namespace)

No plugin-related types exist anywhere. No Plugin Manifest shape is defined. No install record type is defined.

### 1.2 API surface

The current API surfaces are:

- `@platform/event-bus`: `EventBus.publish()`, `EventBus.subscribe()`
- `@platform/capability-registry`: `createCapabilityRegistry()`, `register()`, `list()`, `search()`, `describe()`
- `@platform/session-manager`: `createSessionManager()`, `create()`, `resume()`, `touch()`, `destroy()`, `getStatus()`, `attachResource()`, `detachResource()`, `listResources()`

No plugin lifecycle surface exists. No capability installation endpoint exists.

### 1.3 Frontend surface

None.

### 1.4 What is missing

- No type for a Plugin Manifest (the three top-level keys, the `id`, `version`, `capabilities`, `metadata`)
- No type for an Install Record (the durable state per installed plugin)
- No PluginType union (`'runtime' | 'service' | 'developer'`)
- No PluginManager interface
- No structured PluginError base class with `{ code, message, details }` shape
- No event payload types for `plugin.*` events
- No in-memory store for install records
- No manifest parser + validator (schema, capability name format, collision)
- No file-system persistence layer (atomic write, startup re-load)
- No install/update/reload/disable/enable/uninstall/list/get API surface
- No `plugin.*` event publishing
- No package `@platform/plugin-manager`

## 2. Target Architecture

### 2.1 Architecture overview

```
┌──────────────────────────────────────────────────┐
│              @platform/plugin-manager             │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  createPluginManager (factory function)      │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  InstallStore     │  │  ManifestParser  │ │  │
│  │  │  (in-memory +     │  │  (parse +        │ │  │
│  │  │   disk-persisted) │  │   validate)      │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  │                                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │  CapabilitySync   │  │  EventPublisher  │ │  │
│  │  │  (delegates to    │  │  (via EventBus)  │ │  │
│  │  │   registry)       │  │                  │ │  │
│  │  └──────────────────┘  └──────────────────┘ │  │
│  │                                              │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │  Public API (8 methods):             │   │  │
│  │  │    install, installFromRegistry,      │   │  │
│  │  │    update, reload, disable, enable,   │   │  │
│  │  │    uninstall, list, get               │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  deps: @platform/event-bus, @platform/capability- │
│        registry, yaml (npm, manifest parsing)     │
└──────────────────────────────────────────────────┘
         │                       │
         │ publishes             │ registers
         ▼                       ▼
┌────────────────────┐   ┌─────────────────────┐
│   @platform/event- │   │ @platform/capability│
│   bus              │   │ -registry           │
│                    │   │                     │
│ plugin.installed   │   │ (catalog of all     │
│ plugin.updated     │   │  registered         │
│ plugin.reloaded    │   │  capabilities)      │
│ plugin.uninstalled │   │                     │
│ plugin.enabled     │   │                     │
│ plugin.disabled    │   │                     │
│ plugin.cleanup     │   │                     │
└────────────────────┘   └─────────────────────┘
```

The Plugin Manager is a factory function `createPluginManager(eventBus, capabilityRegistry, config?)` that returns a public API object. Internally it composes an InstallStore (in-memory + disk-persisted), a ManifestParser (parse + validate), a CapabilitySync (delegates to CapabilityRegistry), and an EventPublisher. The factory performs startup re-install on construction (re-reads `./data/installed-plugins.json` and re-installs each plugin from its source).

### 2.2 New or changed data models

#### PluginType (discriminator)

```typescript
type PluginType = "runtime" | "service" | "developer";
```

The discriminator is implicit in which top-level key the manifest has (`runtime:`, `service:`, `developer:`).

#### PluginManifest (input shape, parsed from YAML)

```typescript
interface PluginManifest {
  // exactly one of these is present in a valid manifest
  readonly runtime?: { readonly id: string };
  readonly service?: { readonly id: string };
  readonly developer?: { readonly id: string };
  readonly version: string;
  readonly capabilities?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}
```

A manifest with zero of the three type keys is invalid (`PLUGIN_TYPE_MISSING`). A manifest with two or more of the three type keys is invalid (`PLUGIN_TYPE_AMBIGUOUS`).

#### InstallRecord (durable state per plugin)

```typescript
interface InstallRecord {
  readonly id: string;
  readonly type: PluginType;
  readonly version: string;
  readonly source: string;
  readonly installedAt: number;
  readonly enabled: boolean;
  readonly lastError?: PluginError;
}
```

`lastError` is optional and set when a startup re-install, update, or reload fails for this plugin. Cleared on a successful operation against this plugin.

#### PluginManagerConfig (factory config)

```typescript
interface PluginManagerConfig {
  readonly installRecordPath?: string;       // default: ./data/installed-plugins.json
  readonly cleanupTimeoutMs?: number;        // default: 5000
  readonly clock?: Clock;                    // default: system clock
  readonly fs?: FileSystem;                  // default: Node fs (readFile/writeFile/rename)
  readonly yaml?: YamlParser;                // default: `yaml` npm package
}

interface Clock {
  now(): number;
}

interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;     // atomic (write-temp-then-rename)
  exists(path: string): Promise<boolean>;
}

interface YamlParser {
  parse(source: string): unknown;
}
```

#### Event payloads (one per `plugin.*` event)

```typescript
interface PluginInstalledPayload {
  readonly id: string;
  readonly type: PluginType;
  readonly version: string;
  readonly source: string;
  readonly installedAt: number;
}

interface PluginUpdatedPayload {
  readonly id: string;
  readonly oldVersion: string;
  readonly newVersion: string;
  readonly source: string;
  readonly updatedAt: number;
}

interface PluginReloadedPayload {
  readonly id: string;
  readonly version: string;
  readonly reloadedAt: number;
}

interface PluginUninstalledPayload {
  readonly id: string;
  readonly uninstalledAt: number;
}

interface PluginEnabledPayload {
  readonly id: string;
  readonly enabledAt: number;
}

interface PluginDisabledPayload {
  readonly id: string;
  readonly disabledAt: number;
}

interface PluginCleanupPayload {
  readonly id: string;
}
```

All payloads are `Readonly<T>` objects passed to `EventBus.publish()` per the event bus contract. The Plugin Manager does not publish anything under the `event.*` reserved namespace.

#### PluginError (base error class)

```typescript
interface PluginError {
  readonly code: string;          // stable identifier, e.g. "PLUGIN_SOURCE_NOT_FOUND"
  readonly message: string;       // human-readable
  readonly details: Readonly<Record<string, unknown>>;  // structured data
}

class PluginManagerError extends Error implements PluginError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PluginManagerError";
  }
}
```

The error class extends `Error` for stack-trace compatibility, but consumers should match on `.code` rather than `instanceof` or `.message` (the message is human-readable and may change).

#### Error code constants

```typescript
const ERROR_CODES = {
  SOURCE_NOT_FOUND: "PLUGIN_SOURCE_NOT_FOUND",
  SOURCE_UNREADABLE: "PLUGIN_SOURCE_UNREADABLE",
  MANIFEST_INVALID: "PLUGIN_MANIFEST_INVALID",
  TYPE_MISSING: "PLUGIN_TYPE_MISSING",
  TYPE_AMBIGUOUS: "PLUGIN_TYPE_AMBIGUOUS",
  ID_MISSING: "PLUGIN_ID_MISSING",
  VERSION_MISSING: "PLUGIN_VERSION_MISSING",
  ID_ALREADY_INSTALLED: "PLUGIN_ID_ALREADY_INSTALLED",
  CAPABILITY_NAME_INVALID: "PLUGIN_CAPABILITY_NAME_INVALID",
  CAPABILITY_COLLISION: "PLUGIN_CAPABILITY_COLLISION",
  NOT_INSTALLED: "PLUGIN_NOT_INSTALLED",
  SOURCE_CHANGED: "PLUGIN_SOURCE_CHANGED",
  ALREADY_DISABLED: "PLUGIN_ALREADY_DISABLED",
  ALREADY_ENABLED: "PLUGIN_ALREADY_ENABLED",
  CLEANUP_TIMEOUT: "PLUGIN_CLEANUP_TIMEOUT",
  MARKETPLACE_UNAVAILABLE: "PLUGIN_MARKETPLACE_UNAVAILABLE",
} as const;
```

All codes are stable strings. Consumers (dashboards, CI scripts, alerting) can grep/match on them. They are exported as a single object so all error code constants are co-located.

#### PluginManager (public API contract)

```typescript
interface PluginManager {
  // install
  install(source: string): Promise<InstallRecord>;
  installFromRegistry(id: string): Promise<InstallRecord>;   // STUB in v1
  // lifecycle
  update(id: string, source: string): Promise<InstallRecord>;
  reload(id: string): Promise<InstallRecord>;
  disable(id: string): Promise<InstallRecord>;
  enable(id: string): Promise<InstallRecord>;
  uninstall(id: string): Promise<void>;
  // query
  list(): readonly InstallRecord[];
  get(id: string): InstallRecord | null;
}
```

Eight lifecycle methods plus one stubbed method. All lifecycle methods that change state return the updated `InstallRecord` (or void for uninstall). All methods that read return synchronously; lifecycle methods are async because they publish events via the Event Bus.

### 2.3 API contracts

All lifecycle methods are async (they publish events via the Event Bus, which is async). All methods take and return plain values. The factory is **asynchronous** — startup re-install reads from disk (async I/O), so the factory returns `Promise<PluginManager>` and callers must `await` it. An earlier draft of this TRD specified a synchronous factory; that was revised during implementation because disk I/O cannot be synchronous in Node.

#### `createPluginManager(eventBus, capabilityRegistry, config?): Promise<PluginManager>`

Factory function. Returns a `Promise<PluginManager>`. Performs startup re-install on construction (re-reads `./data/installed-plugins.json` and re-installs each plugin from its source).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `eventBus` | `EventBus` | Yes | Event Bus instance for publishing `plugin.*` events |
| `capabilityRegistry` | `CapabilityRegistry` | Yes | Capability Registry instance for registering plugin capabilities |
| `config` | `PluginManagerConfig` | No | Override default paths, timeouts, clock, fs, YAML parser |

**Startup behaviour:**
- Reads `./data/installed-plugins.json` (or `config.installRecordPath`). If the file is missing, that's fine (no plugins ever installed).
- If the file is malformed (not valid JSON), throws `PluginManagerError("PLUGIN_MANIFEST_INVALID", ...)`. The operator must fix the file or delete it.
- For each install record:
  - Reads the source file from `record.source`.
  - If the source file is missing, sets `record.lastError = { code: "PLUGIN_SOURCE_NOT_FOUND", ... }` and skips. Other plugins still re-install.
  - Parses + validates the manifest. If invalid, sets `record.lastError` and skips.
  - Registers capabilities with the Capability Registry (the registry handles collision checks).
  - If registration succeeds, clears `record.lastError`.
  - **Does NOT fire `plugin.installed`** (the record was already on disk; this is not a new install).
- The factory returns after the re-install loop completes. Plugins that fail to re-install are reported via `plugin.list()` (the `lastError` field) — they don't block the factory.

**Throws:**
- `PluginManagerError("PLUGIN_MANIFEST_INVALID", ...)` if the install-record file exists but is not valid JSON.

#### `install(source: string): Promise<InstallRecord>`

Reads a local manifest file from `source`, validates it, registers capabilities, persists the install record, fires `plugin.installed`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | Path to the local Plugin Manifest file (YAML) |

**Response:** `InstallRecord` with `enabled: true`, generated from the parsed manifest.

**Order of operations (each step's failure throws and leaves the system in a known state):**
1. Read file from `source` (`fs.readFile`). Failure: `PLUGIN_SOURCE_NOT_FOUND` or `PLUGIN_SOURCE_UNREADABLE`.
2. Parse YAML (`yaml.parse`). Failure: `PLUGIN_MANIFEST_INVALID` with line/column in `details` from `YAMLParseError.linePos`.
3. Validate manifest shape (exactly one of `runtime:`/`service:`/`developer:` with `id` and `version` present). Failure: `PLUGIN_TYPE_MISSING`, `PLUGIN_TYPE_AMBIGUOUS`, `PLUGIN_ID_MISSING`, `PLUGIN_VERSION_MISSING`.
4. Validate capability name format (`/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/`). Failure: `PLUGIN_CAPABILITY_NAME_INVALID` for the first invalid name.
5. Check id not already installed. Failure: `PLUGIN_ID_ALREADY_INSTALLED` with `details.suggestedCommand: "plugin.update <id> --source <new-source>"`.
6. Check no collision with capabilities already registered (across all owners). Failure: `PLUGIN_CAPABILITY_COLLISION` with `details.conflictingCapability` and `details.existingOwner`.
7. Build the install record (in memory).
8. Persist the install-record file (atomic write). Failure: throws (no install record on disk, no capabilities registered).
9. Register capabilities with Capability Registry (`capabilityRegistry.register("plugin:<id>", { owner, capabilities })`). Failure: roll back step 8 (delete the install record from disk), throw (no install record, no capabilities).
10. Fire `plugin.installed` event. Failure: log; the install is valid, the event is fire-and-forget.

**Side effects:** Writes `./data/installed-plugins.json`. Publishes `plugin.installed`.

#### `installFromRegistry(id: string): Promise<InstallRecord>`

Stub in v1. Looks up `id` in the public Plugin Marketplace.

**Throws:**
- Always throws `PluginManagerError("PLUGIN_MARKETPLACE_UNAVAILABLE", ...)` with `details.hint: "the marketplace pack has not shipped yet. use plugin.install --source <path> for local installs."`.

The method exists so the public API shape is future-proof: when the marketplace pack ships, only this method's body changes.

#### `update(id: string, source: string): Promise<InstallRecord>`

Reads a new manifest from `source`, validates it, swaps the install record, re-registers capabilities, fires `plugin.updated`. In-flight capability invocations complete against the old handler; new invocations route to the new handler (handled by the Capability Registry's diffing, not by the Plugin Manager).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Plugin id to update |
| `source` | `string` | Yes | Path to the new local Plugin Manifest file |

**Order of operations:**
1. Read install record. Failure: `PLUGIN_NOT_INSTALLED`.
2. Read file from `source`. Failure: `PLUGIN_SOURCE_NOT_FOUND` or `PLUGIN_SOURCE_UNREADABLE`.
3. Parse YAML. Failure: `PLUGIN_MANIFEST_INVALID`.
4. Validate manifest shape. Failure: as in `install`.
5. Validate manifest id matches the install record's id (the id cannot change via update). Failure: `PLUGIN_MANIFEST_INVALID` with `details.expected` and `details.got`.
6. Validate capability name format. Failure: `PLUGIN_CAPABILITY_NAME_INVALID`.
7. Check no collision with capabilities already registered (excluding this plugin's own capabilities, which will be replaced). Failure: `PLUGIN_CAPABILITY_COLLISION`.
8. Persist updated install record (atomic write). Failure: throws (install record unchanged, capabilities unchanged).
9. Register new capabilities with Capability Registry (the registry diffs against the existing owner manifest and handles add/update/remove atomically). Failure: roll back step 8, throw.
10. Fire `plugin.updated` event with `oldVersion` and `newVersion`.

**Side effects:** Writes `./data/installed-plugins.json`. Publishes `plugin.updated`.

#### `reload(id: string): Promise<InstallRecord>`

Re-reads the install record's source, validates, re-registers capabilities, fires `plugin.reloaded`. Same mechanics as `update` but no version-bump requirement.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Plugin id to reload |

**Order of operations:**
1. Read install record. Failure: `PLUGIN_NOT_INSTALLED`.
2. Read file from `installRecord.source`. Failure: `PLUGIN_SOURCE_NOT_FOUND` (install record preserved, see step 9).
3. Parse YAML. Failure: `PLUGIN_MANIFEST_INVALID`.
4. Validate manifest shape. Failure: as in `install`. Install record preserved.
5. Validate manifest id matches the install record's id. Failure: `PLUGIN_MANIFEST_INVALID`.
6. Validate capability name format. Failure: `PLUGIN_CAPABILITY_NAME_INVALID`.
7. Check no collision with capabilities already registered (excluding this plugin's own). Failure: `PLUGIN_CAPABILITY_COLLISION`.
8. If the manifest version differs from the install record's version, update the install record's version field. Otherwise leave it.
9. On any validation failure in steps 2-7: set `record.lastError`, throw. The install record is preserved on disk (operator can fix the source and re-run reload).
10. Persist updated install record (atomic write). Failure: throws.
11. Register capabilities with Capability Registry. Failure: roll back step 10, throw.
12. Clear `record.lastError`. Fire `plugin.reloaded` event.

**Side effects:** Writes `./data/installed-plugins.json` (may or may not change — only writes if the version changed). Publishes `plugin.reloaded`.

**Preserved across reload:** `source`, `id`, `enabled`, `installedAt` (the original install timestamp). Only `version` and `lastError` may change.

#### `disable(id: string): Promise<InstallRecord>`

Flips the `enabled` flag to `false`. Does not unregister capabilities. New invocations return "plugin disabled". In-flight invocations finish.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Plugin id to disable |

**Order of operations:**
1. Read install record. Failure: `PLUGIN_NOT_INSTALLED`.
2. If already disabled, return the record unchanged (no-op, no event).
3. Persist updated install record (atomic write). Failure: throws.
4. Fire `plugin.disabled` event.

**Side effects:** Writes `./data/installed-plugins.json`. Publishes `plugin.disabled`.

#### `enable(id: string): Promise<InstallRecord>`

Flips the `enabled` flag to `true`. Does not re-register capabilities.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Plugin id to enable |

**Order of operations:**
1. Read install record. Failure: `PLUGIN_NOT_INSTALLED`.
2. If already enabled, return the record unchanged (no-op, no event).
3. Persist updated install record (atomic write). Failure: throws.
4. Fire `plugin.enabled` event.

**Side effects:** Writes `./data/installed-plugins.json`. Publishes `plugin.enabled`.

#### `uninstall(id: string): Promise<void>`

Fires `plugin.cleanup`, waits for plugin confirmation (or timeout), then fires `plugin.uninstalled`, removes the install record, unregisters capabilities. In-flight capability invocations complete against the old handler; idle sessions lose access on next call.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Plugin id to uninstall |

**Order of operations:**
1. Read install record. Failure: `PLUGIN_NOT_INSTALLED`.
2. Fire `plugin.cleanup` event with `{ id }`. The plugin (or a subscriber acting on the plugin's behalf) is expected to clean up its own resources.
3. Wait for `plugin.cleanup.confirm` event on the bus, filtered by `{ id }`. Timeout: `config.cleanupTimeoutMs` (default 5000ms).
4. If timeout: log warning via `console.warn`, proceed (resource leak is the plugin's problem, not the platform's). The install record is removed in the next step, so a `lastError` field would be unobservable — the warning is the only operator-visible signal. (An earlier draft of this TRD specified setting `record.lastError`; that was revised during implementation because the record is removed immediately after, making the field invisible via `plugin.list`.)
5. Unregister capabilities by calling `capabilityRegistry.register("plugin:<id>", { owner: "plugin:<id>", capabilities: [] })`. The registry diffs and removes all of the owner's capabilities.
6. Remove install record from `./data/installed-plugins.json` (atomic write of the reduced set).
7. Fire `plugin.uninstalled` event.

**Cleanup-confirmation protocol:**
The Plugin Manager publishes `plugin.cleanup` and then subscribes (transient subscription, auto-unsubscribed on confirm or timeout) to `plugin.cleanup.confirm` with a wildcard pattern that matches the same `id`. The plugin author emits `plugin.cleanup.confirm` from their plugin's cleanup handler.

**Side effects:** Writes `./data/installed-plugins.json` (removes the record). Publishes `plugin.cleanup` then `plugin.uninstalled`.

#### `list(): readonly InstallRecord[]`

Returns all install records. Read-only.

**Response:** Array of `InstallRecord` (in insertion order — first installed first).

#### `get(id: string): InstallRecord | null`

Returns the install record for `id`, or `null` if not installed.

### 2.4 Frontend changes

None. The Dashboard (a future Tier 5 pack) will subscribe to `plugin.*` events for live updates, and may call `plugin.list` via a future Gateway capability. Both are out of scope for this pack.

## 3. Dependency Analysis

### 3.1: `@platform/event-bus`

**Version**: workspace (`*`).
**Purpose**: publish `plugin.*` lifecycle events so other platform components (analytics, dashboard, audit, marketplace when it ships) can react.

**opensrc inspection**: not required — `@platform/event-bus` is a first-party workspace package built in the same monorepo. Its source is at `packages/event-bus/src/`. The `publish()` and `subscribe()` contracts are confirmed by `packages/event-bus/src/types.ts:75-78` and the existing test suite (29 tests passing).

**Why chosen over alternatives:**
- A third-party event emitter (Node `EventEmitter`): rejected because the Event Bus is the platform's canonical pub/sub layer. Using it ensures cross-component decoupling and consistency with every other pack.
- Direct function calls between components: rejected because the Plugin Manager's lifecycle events are meant to be observed by N consumers (analytics, dashboard, audit) without the Plugin Manager knowing about each one.

### 3.2: `@platform/capability-registry`

**Version**: workspace (`*`).
**Purpose**: register the plugin's capabilities (`browser.navigate`, etc.) at install/update/reload/uninstall time. The Plugin Manager delegates capability storage to the Registry — it doesn't maintain its own capability catalog.

**opensrc inspection**: not required — first-party workspace package. Source at `packages/capability-registry/src/`. The `register()` method accepts `{ owner, capabilities }` and diffs against the owner's existing manifest (additions, updates, removals). Confirmed by `packages/capability-registry/src/index.ts:32-90`.

**Why chosen over alternatives:**
- Plugin Manager maintaining its own capability catalog: rejected. The platform already has a capability catalog (the Registry). The Plugin Manager's job is lifecycle, not catalog. Adding a second catalog would split discoverability.
- Plugins calling the Registry directly: rejected. Plugins should not import the Registry. The Plugin Manager is the only component that registers a plugin's capabilities.

### 3.3: `yaml`

**Version**: `^2.6.0` (latest stable as of 2026-07-27).
**Purpose**: parse Plugin Manifest files. Manifests are YAML per the architecture docs (`docs/architecture/Terminology.md` example block, `docs/architecture/Plugin_Marketplace.md` registry example).

**opensrc inspection**:
```bash
opensrc path yaml@2.6.0
cat $(opensrc path yaml@2.6.0)/src/public-api.ts
rg "prettifyError|YAMLParseError|linePos" $(opensrc path yaml@2.6.0)/src/errors.ts
```

**Findings:**
- Source confirms: `parse(source: string, options?: ParseOptions): unknown` (`src/public-api.ts`). Accepts a string and returns the parsed value (object, array, primitive, etc.).
- Source confirms: `YAMLParseError` extends `YAMLError` and carries `linePos: [{ line, col }]` (`src/errors.ts`). When parse is called with `prettyErrors: true` (the default), the error message includes "at line N, column M" with the offending line excerpted.
- Limitations: by default, YAML 1.2 with the "core" schema. The `parse` function does not validate against a JSON schema — that's our job.
- Key file references: `src/public-api.ts` (parse signature), `src/errors.ts` (YAMLParseError + linePos), `src/parse/parser.ts` (the actual parser, not needed for our use).

**Why chosen over alternatives:**
- `js-yaml`: rejected. Older API, weaker error messages, less actively maintained. The `yaml` package's `linePos` and `prettifyError` give us exactly what we need for `PLUGIN_MANIFEST_INVALID` error messages with line/column.
- JSON manifests (`plugin.json`): rejected. The architecture docs use YAML (`docs/architecture/Terminology.md:417-425`), and YAML is more readable for operators hand-editing manifests. The 14 KB cost of `yaml` is negligible.
- Hand-rolled YAML parser: rejected. Don't write a YAML parser. The format has too many edge cases (anchors, multi-doc, block vs flow mapping) to get right.

**License**: ISC (permissive, compatible with the project's existing license posture).

### 3.4: `@types/node`

**Version**: workspace (already shipped).
**Purpose**: types for Node built-ins (`Buffer` is unused; `fs.promises` access via `fs: FileSystem` injection means we don't directly depend on Node types in the public surface, but `__tests__` will use them).
**No opensrc required** — TypeScript types only.

### Summary table

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| `@platform/event-bus` | workspace | Publish `plugin.*` events | `publish(name, payload)`, shallow-freezes payload | Node EventEmitter, direct calls |
| `@platform/capability-registry` | workspace | Register plugin capabilities | `register(owner, manifest)` diffs against owner's existing manifest | Plugin-owned catalog, plugins calling registry directly |
| `yaml` | `^2.6.0` | Parse Plugin Manifest files | `parse()` returns `unknown`, `YAMLParseError.linePos` for error messages | `js-yaml` (weaker errors), JSON (architecture uses YAML), hand-rolled (no) |
| `@types/node` | workspace | Node types for tests | n/a — types only | n/a |

No new external runtime dependencies beyond `yaml`. The Plugin Manager is a leaf in the dependency graph: it depends on `event-bus` and `capability-registry`, but neither depends on it.

## 4. Migration Strategy

### 4.1 Additive phase

Everything is additive. No existing package or component touches plugin management. The Plugin Manager can be shipped alongside all existing packages without changing anything.

### 4.2 Migration / transition phase

None. No existing code needs migration.

### 4.3 Compatibility rails

None needed. The Plugin Manager is a new package with no consumers yet.

### 4.4 Rollback plan

Remove the `@platform/plugin-manager` package from the workspace. Delete `./data/installed-plugins.json` if it exists. No other component depends on the Plugin Manager yet.

## 5. Open Questions

- [ ] **YAML strictness.** Default `parse(source)` uses YAML 1.2 with the "core" schema. Should we pass `strict: true` to reject duplicates, unknown keys, and surprise type coercion? My recommendation: yes, strict mode for plugin manifests. Surprises in YAML parsing are bad — an operator writes `version: 1.0` and the parser reads it as a string, but `version: yes` reads as boolean `true`. Strict mode makes this fail loudly. Resolve in IMPL phase.
- [ ] **`plugin.cleanup.confirm` event name and protocol.** TRD proposes a transient subscription on `plugin.cleanup.confirm` with a payload that includes the same `id`. Is this the right protocol? Alternatives: (a) the plugin returns a value from a callback registered at install time; (b) the plugin manager polls a per-plugin "cleanup status" endpoint. My recommendation: the `plugin.cleanup.confirm` event is the cleanest — it matches the existing event-bus pattern and doesn't require a registry of plugin cleanup callbacks. But this adds a new event (`plugin.cleanup.confirm`) to the surface — confirm with the user before IMPL.
- [ ] **What gets emitted on startup.** TRD proposes: no `plugin.*` events fire on startup re-install. Is this correct? Alternative: fire `plugin.reloaded` for each successfully re-installed plugin. My recommendation: no events on startup. Operators can compare `plugin.list` output before/after a restart if they need to verify. The event bus should reflect state changes, not platform lifecycle. Resolve in IMPL phase.
- [ ] **`lastError` field — explicit or implicit?** TRD proposes adding an optional `lastError?: PluginError` to `InstallRecord`. Is this the right shape? Alternative: keep `InstallRecord` minimal and add a separate `plugin.listFailed()` method. My recommendation: `lastError` on the record. Operators see the failure in the same call as the install state — one round-trip instead of two.
- [ ] **`installed-plugins.json` location.** Default `./data/installed-plugins.json` is convenient for dev. Should production deployments use `/var/lib/agentide/plugins.json` or similar? Configurable via `config.installRecordPath`, but the default is a TRD-level call. My recommendation: `./data/installed-plugins.json` as default, configurable via config. Self-hosted operators can set the path in their platform config.
- [ ] **Cleanup timeout default.** TRD proposes 5000ms. Is that right? Too short and plugins with many resources (e.g. a browser runtime with many tabs) get force-uninstalled before cleanup completes. Too long and an operator who really wants to remove a plugin is stuck waiting. My recommendation: 5000ms, configurable via `config.cleanupTimeoutMs`. 5 seconds is enough for "clean up a few browser tabs"; if a plugin needs more, it's a plugin bug, not a platform concern.

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| Public Plugin Marketplace / registry-id install | Separate pack with its own design (trust tiers, signing, review, publishing flow). `installFromRegistry()` is the API seam; body changes when marketplace ships. | When the marketplace pack starts. |
| Plugin signing / signature verification | Marketplace pack. v1 trusts the operator's source files. | Marketplace pack. |
| Plugin sandboxing / runtime isolation | A separate platform concern. v1 plugins run in-process with the platform. | When the platform team decides on a sandboxing approach. |
| Cross-plugin dependency resolution (`requires: [other-plugin]`) | Needs a dependency-graph design pass (install order, version constraints, failure recovery). | When a plugin needs to depend on another plugin. |
| Platform-version constraint enforcement (`requires: { platform: ">=1.0" }`) | Needs a platform versioning convention first. | When the platform team defines a versioning policy. |
| Tenant-isolated plugin views | Tenant design in `CONTEXT.md` is open. | When tenant semantics land. |
| Auto-updates / scheduled plugin upgrades | Operators trigger updates explicitly. | When operators ask for it. |
| Plugin discovery from a directory (`./plugins/*.yaml`) | Directory scanning is a follow-up. v1 takes one file at a time via `install(source)`. | When operators have many plugins to manage. |
| `plugin.error` event on the Event Bus | Terminal-only errors in v1. An event-bus error channel is a follow-up when a real consumer asks for it. | When an analytics/audit consumer wants error visibility. |
| Plugin capability versioning | A capability is registered with a single canonical name. Version-tagged capabilities are a follow-up. | When two versions of the same plugin need to coexist. |
| Plugin code execution model | The Plugin Manager doesn't define how a plugin's code is loaded and run — it manages the install record and capability registration. Each plugin type needs its own code-loading contract. | When the first Runtime Plugin is implemented (browser or backend). |
| Atomic install record writes for multiple concurrent operations | v1 is single-tenant in-process. Concurrent `install`/`update`/`uninstall` calls are possible but rare. The atomic-write pattern (write-temp-then-rename) handles them within a single process. Multi-process coordination is out of scope. | When the platform becomes multi-tenant or multi-process. |
| Hot reload of plugin code (e.g. plugin's runtime code without restarting the platform) | v1 re-reads the manifest and re-registers capabilities. Plugin code changes (the plugin's own executable) require a platform restart. | When a Runtime Plugin needs zero-downtime code updates. |