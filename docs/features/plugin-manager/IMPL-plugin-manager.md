# Implementation Plan: Plugin Manager

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: In-process control-plane component that installs, updates, disables, enables, reloads, lists, and uninstalls plugins from a local Plugin Manifest, with persistent install state and Event Bus integration.
- PRD: [PRD-plugin-manager.md](./PRD-plugin-manager.md)
- TRD: [TRD-plugin-manager.md](./TRD-plugin-manager.md)
- FLOW: [FLOW-plugin-manager.md](./FLOW-plugin-manager.md)

## 1. Planning Principles

1. **Manifest parser first, store second, lifecycle third.** The parser + validator are pure functions (input: YAML string, output: validated `PluginManifest`). They can be developed and tested in isolation. The store depends on `FileSystem` injection. The lifecycle methods (install, update, etc.) depend on both. This ordering keeps each phase testable without the whole stack.
2. **Lifecycle methods are thin compositions.** `install`, `update`, `reload` share most of their mechanics (parse, validate, persist, register, fire event). Build a shared `installFromManifest(source, parsedManifest)` internal helper and have the public methods differ only in their pre-conditions and event names.
3. **Capability registration is delegated, not duplicated.** The Plugin Manager calls `capabilityRegistry.register("plugin:<id>", { owner, capabilities })` and lets the registry do its diffing. No separate capability catalog in the Plugin Manager. Collision detection at install time uses `capabilityRegistry.describe(name)` to check ownership.
4. **Atomic writes via write-temp-then-rename.** Every persistence operation writes to a `.tmp` file in the same directory as the target, then renames over the target. This guarantees partial writes cannot corrupt the install-record file. The Node `fs.promises.rename` call is atomic on POSIX filesystems when source and destination are on the same filesystem.
5. **`yaml` is the only new external dep.** Confirmed via opensrc (`yaml@2.6.0`, `src/public-api.ts` for the parse signature, `src/errors.ts` for `YAMLParseError.linePos`). Pass `prettyErrors: false` to get the raw error with linePos, then format the line+column ourselves in the `PLUGIN_MANIFEST_INVALID` message.

## 2. Current Baseline

- Event bus is shipped and operational: `EventBus.publish()`, `EventBus.subscribe()`, `Subscription.unsubscribe()`, prefix wildcards, shallow freeze, `event.*` reserved namespace.
- Capability registry is shipped and operational: `createCapabilityRegistry()`, `register()`, `list()`, `search()`, `describe()`. The `register()` method diffs against the owner's existing manifest and returns `{ added, updated, removed }`.
- Session manager is shipped and operational (sibling — not a dep, but a precedent for the package structure and Code Map comment conventions).
- No plugin types, store, manifest parser, or install records exist anywhere in the codebase.
- No package `@platform/plugin-manager` exists.

Regression check for every phase: `cd agentide && npm run test -- --run && npm run typecheck && npm run lint` for all packages (event-bus, capability-registry, session-manager, plugin-manager).

## 3. Phase Plan

---

### Phase 0: Package scaffold + types

**Goal**: Create the package, define all types, wire workspace dependencies. No runtime behavior yet.

**Why this phase first**: Every subsequent phase depends on these types being importable from `@platform/plugin-manager`.

#### Tasks

- [ ] Create `packages/plugin-manager/` with `package.json` following session-manager pattern (ESM, private, named `@platform/plugin-manager`)
- [ ] Add `@platform/event-bus` and `@platform/capability-registry` as workspace dependencies in `package.json`
- [ ] Add `yaml` (`^2.6.0`) as a runtime dependency in `package.json`
- [ ] Create `tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`, `outDir: dist`
- [ ] Add workspace reference in root `tsconfig.json` (`{ "path": "packages/plugin-manager" }`)
- [ ] Define core data types in `src/types.ts`:
  - `PluginType = 'runtime' | 'service' | 'developer'`
  - `PluginManifest { runtime?, service?, developer?, version, capabilities?, metadata? }` — exactly one of the three type keys per valid manifest
  - `InstallRecord { id, type, version, source, installedAt, enabled, lastError? }`
  - `PluginError { code, message, details }` (interface, not class — see Phase 1)
  - `PluginManagerConfig { installRecordPath?, cleanupTimeoutMs?, clock?, fs?, yaml? }`
  - `Clock { now(): number }` (minimal — only used for `installedAt`)
  - `FileSystem { readFile(path): Promise<string>, writeFile(path, content): Promise<void>, exists(path): Promise<boolean> }`
  - `YamlParser { parse(source: string): unknown }`
  - Event payloads: `PluginInstalledPayload`, `PluginUpdatedPayload`, `PluginReloadedPayload`, `PluginUninstalledPayload`, `PluginEnabledPayload`, `PluginDisabledPayload`, `PluginCleanupPayload`
  - `PluginManager` interface with 9 methods (`install`, `installFromRegistry`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get`)
- [ ] Define error code constants in `src/errors.ts`:
  - `ERROR_CODES` object with all 16 codes from the TRD (`SOURCE_NOT_FOUND`, `SOURCE_UNREADABLE`, `MANIFEST_INVALID`, `TYPE_MISSING`, `TYPE_AMBIGUOUS`, `ID_MISSING`, `VERSION_MISSING`, `ID_ALREADY_INSTALLED`, `CAPABILITY_NAME_INVALID`, `CAPABILITY_COLLISION`, `NOT_INSTALLED`, `SOURCE_CHANGED`, `ALREADY_DISABLED`, `ALREADY_ENABLED`, `CLEANUP_TIMEOUT`, `MARKETPLACE_UNAVAILABLE`)
  - `PluginManagerError` class extending `Error`, implements `PluginError`
- [ ] Create `src/index.ts` that re-exports from `types.ts` and `errors.ts` (factory placeholder)
- [ ] Create `src/__tests__/types.test.ts` with type-only smoke tests (the types are exported, the constants are correct strings)

#### Validation condition

> `npm run build` (or `tsc --build`) compiles successfully. `import { PluginType, ERROR_CODES } from "@platform/plugin-manager"` resolves. `npm test -- --run` passes for the placeholder test. Existing event-bus, capability-registry, and session-manager tests still pass.

#### Regression check

> `npm run test -- --run` for event-bus, capability-registry, session-manager still pass. Root `npm run typecheck` passes. Root `npm run lint` passes. `npm run precommit` clean.

---

### Phase 1: Manifest parser + validator

**Goal**: Pure functions that parse a YAML string into a `PluginManifest` and validate it. No I/O, no events, no persistence. Testable in isolation.

**Why this phase first**: Every lifecycle method (install, update, reload) needs to parse and validate a manifest. Building this as pure functions means the lifecycle methods can be thin compositions, and the validation logic gets dedicated test coverage.

#### Tasks

- [ ] Implement `parseManifest(yamlContent: string, yaml: YamlParser): PluginManifest` in `src/manifest.ts`:
  - Call `yaml.parse(content)` — wrap any `YAMLParseError` in `PluginManagerError("PLUGIN_MANIFEST_INVALID", ...)` with `details.source`, `details.line`, `details.column` extracted from `error.linePos[0]`
  - Coerce the parsed object to `PluginManifest` shape: assert `runtime?` / `service?` / `developer?` are objects with `id` strings; `version` is a string; `capabilities` is an array of strings; `metadata` is an object of string→string
  - Throw `PLUGIN_MANIFEST_INVALID` with `details.expected`, `details.got` for shape mismatches
- [ ] Implement `validateManifest(manifest: PluginManifest): void`:
  - Throw `PLUGIN_TYPE_MISSING` if zero of `runtime`/`service`/`developer` is present
  - Throw `PLUGIN_TYPE_AMBIGUOUS` if two or more are present (with `details.found: ["runtime", "service"]`)
  - Throw `PLUGIN_ID_MISSING` if the chosen type key has no `id` or empty `id`
  - Throw `PLUGIN_VERSION_MISSING` if `version` is missing or empty
  - Iterate `capabilities`. Throw `PLUGIN_CAPABILITY_NAME_INVALID` for the first one not matching `/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/`, with `details.capability` and `details.format`
- [ ] Implement `manifestType(manifest: PluginManifest): PluginType` helper:
  - Returns `'runtime'` if `manifest.runtime`, `'service'` if `manifest.service`, `'developer'` if `manifest.developer`
  - Throws if none — should never be reached after `validateManifest` but the type narrowing is needed elsewhere
- [ ] Implement `manifestId(manifest: PluginManifest, type: PluginType): string`:
  - Returns `manifest[type].id`
- [ ] Tests for parse + validate in `src/__tests__/manifest.test.ts`

#### Tests required

- [ ] `parseManifest` with a valid YAML returns a `PluginManifest`
- [ ] `parseManifest` with invalid YAML throws `PLUGIN_MANIFEST_INVALID` with `details.line` and `details.column`
- [ ] `parseManifest` with valid YAML but wrong shape (e.g. `runtime: []`) throws `PLUGIN_MANIFEST_INVALID` with `details.expected` and `details.got`
- [ ] `validateManifest` accepts manifests with exactly one of `runtime`/`service`/`developer`
- [ ] `validateManifest` rejects zero type keys with `PLUGIN_TYPE_MISSING`
- [ ] `validateManifest` rejects two type keys with `PLUGIN_TYPE_AMBIGUOUS`
- [ ] `validateManifest` rejects missing `id` with `PLUGIN_ID_MISSING`
- [ ] `validateManifest` rejects missing `version` with `PLUGIN_VERSION_MISSING`
- [ ] `validateManifest` rejects capability name `Browser Navigate` with `PLUGIN_CAPABILITY_NAME_INVALID`
- [ ] `validateManifest` rejects capability name `Browser.navigate` (uppercase first char) with `PLUGIN_CAPABILITY_NAME_INVALID`
- [ ] `validateManifest` accepts capability names matching `domain.action` (e.g. `browser.navigate`, `customer.read`, `git.push`)
- [ ] `validateManifest` accepts a manifest with no `capabilities` field (empty array is implicit)
- [ ] `manifestType` returns the right type for each manifest shape

#### Validation condition

> Manifest parsing + validation can be tested without any I/O or external state. All validation error codes are thrown correctly. Line/column from YAMLParseError are surfaced in `PLUGIN_MANIFEST_INVALID.details`.

---

### Phase 2: InstallStore — in-memory + disk persistence

**Goal**: An `InstallStore` class that holds install records in memory and persists them to `./data/installed-plugins.json` via atomic write.

**Why this phase first**: Every lifecycle method needs to read/write install records. Building the store with `FileSystem` injection means tests use an in-memory fake fs, and production uses Node's `fs.promises`.

#### Tasks

- [ ] Implement `InstallStore` class in `src/store.ts`:
  - Constructor accepts `installRecordPath: string`, `fs: FileSystem`
  - Internal state: `Map<PluginId, InstallRecord>` (insertion-ordered)
  - `load(): Promise<void>`:
    - If `fs.exists(installRecordPath)` is false, no-op (empty state)
    - Else `fs.readFile(installRecordPath)`, `JSON.parse`
    - If JSON is malformed, throw `PluginManagerError("PLUGIN_MANIFEST_INVALID", ..., { path })` (this is the install-record file, not a Plugin Manifest, but the same error code communicates "this file is broken")
    - Validate each parsed record has the `InstallRecord` shape (`id`, `type`, `version`, `source`, `installedAt`, `enabled`); skip malformed records with a log warning (don't crash the load)
  - `save(): Promise<void>`:
    - Serialize the in-memory records to JSON (array form)
    - Write to `installRecordPath + ".tmp"` first
    - Rename `.tmp` over the target (atomic)
    - The `FileSystem` interface exposes `writeFile(path, content)`; add a separate `rename(src, dest)` method to the interface, OR include rename in the writeFile semantics (write-temp-then-rename). Pick the latter to keep the interface minimal — `FileSystem.writeFile` IS atomic, the implementation handles the temp file internally
  - `get(id): InstallRecord | null`
  - `set(record: InstallRecord): InstallRecord` — inserts if new, replaces if exists; does NOT save to disk (caller decides when to save)
  - `delete(id): boolean` — removes if exists; returns whether anything was removed
  - `list(): readonly InstallRecord[]`
  - `has(id): boolean`
- [ ] Update `FileSystem` interface in `src/types.ts`:
  - `writeFile(path, content)` is documented as atomic (write-temp-then-rename). The default implementation uses `fs.promises.writeFile` to a sibling `.tmp` file then `fs.promises.rename`.
- [ ] Default `FileSystem` implementation in `src/fs.ts`:
  - `readFile(path): fs.promises.readFile(path, 'utf-8')`
  - `writeFile(path, content)`: write to `${path}.tmp`, then rename
  - `exists(path): fs.promises.access(path, fs.constants.F_OK)` (returns boolean)
- [ ] Tests for `InstallStore` in `src/__tests__/store.test.ts`

#### Tests required

- [ ] `InstallStore.load()` on a missing file produces an empty store
- [ ] `InstallStore.load()` on a malformed JSON file throws `PLUGIN_MANIFEST_INVALID`
- [ ] `InstallStore.load()` on a file with one malformed record skips it (logs warning) and loads the rest
- [ ] `InstallStore.save()` writes a JSON array of records
- [ ] `InstallStore.save()` is atomic (use a fake FileSystem that fails between write and rename; verify the original file is unchanged)
- [ ] `set()` adds a new record; `get()` returns it
- [ ] `set()` replaces an existing record (same id, different content)
- [ ] `delete()` removes a record; subsequent `get()` returns null
- [ ] `list()` returns records in insertion order
- [ ] `has()` returns true/false correctly

#### Validation condition

> The store round-trips records through an in-memory `FileSystem` fake. Persistence is atomic (verified by simulating a partial-write failure). The store survives a load cycle (save → load yields identical records).

---

### Phase 3: Public API — install, list, get, installFromRegistry

**Goal**: The first user-visible slice. Operators can install a plugin from a local manifest file, list installed plugins, look up one by id, and hit the marketplace stub.

**Why this phase first**: install is the primary happy path (Flow 1 in FLOW). list/get are simple reads. installFromRegistry is the stubbed branch. Building these first means we can demo "I can add a plugin to the platform" before tackling the more complex lifecycle (update, reload, uninstall).

**Blocked by**: Phase 0, Phase 1, Phase 2

#### Tasks

- [ ] Implement `createPluginManager(eventBus, capabilityRegistry, config?): PluginManager` factory in `src/index.ts`:
  - Build the `InstallStore`, `EventPublisher`, `ManifestParser` (just a wrapper around `parseManifest` + `validateManifest`)
  - Defer startup re-install to Phase 7
  - Default `Clock` (uses `Date.now()`), default `FileSystem` (Node `fs.promises`), default `YamlParser` (wraps `yaml.parse`)
- [ ] Implement `EventPublisher` class in `src/events.ts`:
  - Accepts `EventBus`
  - One method per event: `installed`, `updated`, `reloaded`, `uninstalled`, `enabled`, `disabled`, `cleanup`. Each method calls `eventBus.publish(name, payload)`. Fire-and-forget (no await).
- [ ] Implement `install(source: string): Promise<InstallRecord>`:
  - `fs.readFile(source)` — catch ENOENT/EACCES, throw `PLUGIN_SOURCE_NOT_FOUND` or `PLUGIN_SOURCE_UNREADABLE`
  - `yaml.parse(content)` — wrap in `parseManifest` for line/col
  - `validateManifest` — throws on shape errors
  - `store.has(manifestId)` — throw `PLUGIN_ID_ALREADY_INSTALLED` if true
  - For each capability: `capabilityRegistry.describe(name)` — if found and `existing.owner !== "plugin:" + id`, throw `PLUGIN_CAPABILITY_COLLISION`
  - Build the install record (`type: manifestType(manifest)`, `version: manifest.version`, `source`, `installedAt: clock.now()`, `enabled: true`)
  - `store.set(record)`
  - `store.save()` — atomic write. On failure, throw (no record on disk, no capabilities registered). The in-memory store still has the record; on next `save()` it would persist. For v1 we don't auto-clean the in-memory state — the caller sees the error and knows the install failed.
  - `capabilityRegistry.register("plugin:" + id, { owner: "plugin:" + id, capabilities: manifest.capabilities ?? [] })` — on failure, `store.delete(id)`, `store.save()`, throw
  - `events.installed(record)`
  - Return the record
- [ ] Implement `list()` and `get(id)`:
  - `list()` returns `store.list()`
  - `get(id)` returns `store.get(id)` or `null`
- [ ] Implement `installFromRegistry(id)`:
  - Always throws `PLUGIN_MARKETPLACE_UNAVAILABLE` with `details.hint`
- [ ] Tests for the public API in `src/__tests__/plugin-manager.test.ts`

#### Tests required

- [ ] `install(source)` with a valid runtime manifest returns the install record with the right fields
- [ ] `install(source)` registers the capabilities with the Capability Registry (verify via `capability.list()`)
- [ ] `install(source)` persists the record to the install-record file (verify by reading the file)
- [ ] `install(source)` publishes `plugin.installed` with the correct payload (verify via a captured subscription)
- [ ] `install(source)` with a non-existent source throws `PLUGIN_SOURCE_NOT_FOUND`
- [ ] `install(source)` with an unreadable source throws `PLUGIN_SOURCE_UNREADABLE`
- [ ] `install(source)` with malformed YAML throws `PLUGIN_MANIFEST_INVALID` with line/column
- [ ] `install(source)` with no type key throws `PLUGIN_TYPE_MISSING`
- [ ] `install(source)` with multiple type keys throws `PLUGIN_TYPE_AMBIGUOUS`
- [ ] `install(source)` with missing id throws `PLUGIN_ID_MISSING`
- [ ] `install(source)` with missing version throws `PLUGIN_VERSION_MISSING`
- [ ] `install(source)` with invalid capability name throws `PLUGIN_CAPABILITY_NAME_INVALID`
- [ ] `install(source)` with a capability already registered by another owner throws `PLUGIN_CAPABILITY_COLLISION`
- [ ] `install(source)` for an id that's already installed throws `PLUGIN_ID_ALREADY_INSTALLED`
- [ ] `install(source)` for a service manifest returns `type: "service"`
- [ ] `install(source)` for a developer manifest returns `type: "developer"`
- [ ] `list()` returns the install records
- [ ] `get(id)` returns the install record for an installed plugin
- [ ] `get(id)` returns null for a non-installed plugin
- [ ] `installFromRegistry(anything)` throws `PLUGIN_MARKETPLACE_UNAVAILABLE` and does not modify any state

#### Validation condition

> A test scenario can install a runtime plugin from a local manifest, see it in `plugin.list`, see its capabilities in `capability.list`, and observe the `plugin.installed` event. All error paths return the right error codes.

---

### Phase 4: Public API — update, reload

**Goal**: Operators can swap a plugin to a new version, or re-read the source after editing the manifest.

**Why this phase next**: Update and reload share most of their mechanics with `install`. After Phase 3 we have the parser, validator, store, and registry integration. Adding update + reload is mostly "run the install pipeline but against an existing record."

**Blocked by**: Phase 3

#### Tasks

- [ ] Refactor: extract an internal `applyManifest(id: string, source: string, opts: { expectedId?: string, allowVersionRefresh: boolean }): Promise<InstallRecord>` helper:
  - Reads source, parses, validates
  - If `opts.expectedId` is set, asserts `manifest.id === opts.expectedId` (used by update + reload to enforce the id doesn't change)
  - Pre-checks collisions excluding the plugin's own capabilities
  - Persists updated record
  - Registers capabilities with the registry (registry's diffing handles additions/updates/removals)
  - Clears `lastError` on success
  - Returns the updated record
- [ ] Implement `update(id, source)`:
  - `store.get(id)` — throw `PLUGIN_NOT_INSTALLED` if null
  - `applyManifest(id, source, { expectedId: id, allowVersionRefresh: false })`
  - `events.updated({ id, oldVersion: existing.version, newVersion: manifest.version, source, updatedAt })`
  - Return the record
- [ ] Implement `reload(id)`:
  - `store.get(id)` — throw `PLUGIN_NOT_INSTALLED` if null
  - `applyManifest(id, existing.source, { expectedId: id, allowVersionRefresh: true })` — pass the install record's source, not a new one
  - On validation failure inside `applyManifest`: set `record.lastError`, save, throw. The install record is preserved (operator can fix the source and re-run reload).
  - `events.reloaded({ id, version, reloadedAt })`
  - Return the record
- [ ] Tests for update + reload in `src/__tests__/update-reload.test.ts`

#### Tests required

- [ ] `update(id, newSource)` swaps the install record to the new version
- [ ] `update(id, newSource)` re-registers capabilities via the registry's diffing (added/updated/removed all work)
- [ ] `update(id, newSource)` publishes `plugin.updated` with `oldVersion` and `newVersion`
- [ ] `update(id, newSource)` for a non-existent id throws `PLUGIN_NOT_INSTALLED`
- [ ] `update(id, newSource)` with a manifest whose id differs throws `PLUGIN_MANIFEST_INVALID` with `details.expected` and `details.got`
- [ ] `update(id, newSource)` with a capability colliding with another plugin throws `PLUGIN_CAPABILITY_COLLISION`
- [ ] `update(id, newSource)` preserves the original `installedAt`
- [ ] `reload(id)` re-reads the install record's source
- [ ] `reload(id)` with a manifest whose version is unchanged leaves the install record's version field alone
- [ ] `reload(id)` with a manifest whose version differs updates the version field
- [ ] `reload(id)` preserves `installedAt`, `enabled`, and `source`
- [ ] `reload(id)` with a missing source file throws `PLUGIN_SOURCE_NOT_FOUND` and sets `record.lastError`
- [ ] `reload(id)` with a now-invalid manifest sets `record.lastError` and preserves the install record
- [ ] `reload(id)` with a collision sets `record.lastError` and preserves the install record
- [ ] `reload(id)` publishes `plugin.reloaded`
- [ ] `reload(id)` after a prior `lastError` clears the error on success
- [ ] `reload(id)` for a non-existent id throws `PLUGIN_NOT_INSTALLED`

#### Validation condition

> An operator can install a plugin, edit its source file (e.g. add a capability, fix a typo), call `plugin.reload` to re-register, and see the change reflected. An operator can also `plugin.update` to install a new version with old capabilities removed and new ones added, with the registry diffing correctly applied.

---

### Phase 5: Public API — disable, enable

**Goal**: Operators can pause a plugin (capabilities stay registered but marked disabled) and unpause it.

**Why this phase next**: Disable/enable are simple flag flips with no parsing, no validation, no registry interaction. Quick to build, useful for QA.

**Blocked by**: Phase 3 (needs the store and events)

#### Tasks

- [ ] Implement `disable(id)`:
  - `store.get(id)` — throw `PLUGIN_NOT_INSTALLED` if null
  - If `record.enabled === false`, return record (no-op)
  - Build new record `{ ...record, enabled: false }`
  - `store.set(newRecord)`, `store.save()`
  - `events.disabled({ id, disabledAt: clock.now() })`
  - Return the record
- [ ] Implement `enable(id)`:
  - `store.get(id)` — throw `PLUGIN_NOT_INSTALLED` if null
  - If `record.enabled === true`, return record (no-op)
  - Build new record `{ ...record, enabled: true }`
  - `store.set(newRecord)`, `store.save()`
  - `events.enabled({ id, enabledAt: clock.now() })`
  - Return the record
- [ ] Tests for disable/enable in `src/__tests__/disable-enable.test.ts`

#### Tests required

- [ ] `disable(id)` flips `enabled` to `false`
- [ ] `disable(id)` publishes `plugin.disabled`
- [ ] `disable(id)` persists the change to the install-record file
- [ ] `disable(id)` does NOT unregister the plugin's capabilities from the Capability Registry
- [ ] `disable(id)` on an already-disabled plugin is a no-op (no event, no save)
- [ ] `disable(id)` for a non-existent id throws `PLUGIN_NOT_INSTALLED`
- [ ] `enable(id)` flips `enabled` to `true`
- [ ] `enable(id)` publishes `plugin.enabled`
- [ ] `enable(id)` on an already-enabled plugin is a no-op
- [ ] `enable(id)` for a non-existent id throws `PLUGIN_NOT_INSTALLED`

#### Validation condition

> After `disable(id)`, `list()` shows `enabled: false` and `capability.list()` still includes the plugin's capabilities. After `enable(id)`, the state flips back. No-op calls are silent.

---

### Phase 6: Public API — uninstall with cleanup protocol

**Goal**: Operators can fully remove a plugin. The plugin gets a chance to clean up its own resources via the `plugin.cleanup` event and `plugin.cleanup.confirm` reply.

**Why this phase last (before startup)**: Uninstall is the most complex lifecycle method. It involves cleanup confirmation via the Event Bus, timeout handling, registry deregistration, and store removal. Building it last (after install/update/reload/disable/enable) means we have full coverage of the simpler paths before tackling the cleanup-protocol semantics.

**Blocked by**: Phase 3 (needs store, events, registry)

#### Tasks

- [ ] Implement an internal `awaitCleanupConfirm(id: string, timeoutMs: number, eventBus: EventBus): Promise<boolean>`:
  - Subscribe (transient) to `plugin.cleanup.confirm` with a handler that resolves on `{ id }` match
  - Set a timeout (use `clock.setTimeout` if available, otherwise `globalThis.setTimeout`); on timeout, resolve `false`
  - On confirm, clear the timeout and unsubscribe; resolve `true`
  - Returns true if confirmed, false if timed out
- [ ] Implement `uninstall(id)`:
  - `store.get(id)` — throw `PLUGIN_NOT_INSTALLED` if null
  - `events.cleanup({ id })`
  - `awaitCleanupConfirm(id, cleanupTimeoutMs, eventBus)` — wait
  - If timed out: log warning (resource leak is the plugin's problem). Do NOT abort the uninstall.
  - `capabilityRegistry.register("plugin:" + id, { owner, capabilities: [] })` — diffs and removes all of the plugin's capabilities
  - `store.delete(id)`, `store.save()`
  - `events.uninstalled({ id, uninstalledAt: clock.now() })`
- [ ] Add `Clock.setTimeout` and `Clock.clearTimeout` to the `Clock` interface in `src/types.ts` (extends the existing minimal interface). Update the system clock default.
- [ ] Tests for uninstall in `src/__tests__/uninstall.test.ts`

#### Tests required

- [ ] `uninstall(id)` fires `plugin.cleanup` before any other side effect
- [ ] `uninstall(id)` waits for `plugin.cleanup.confirm` before proceeding
- [ ] `uninstall(id)` after `plugin.cleanup.confirm` is received removes the install record
- [ ] `uninstall(id)` removes all of the plugin's capabilities from the registry
- [ ] `uninstall(id)` publishes `plugin.uninstalled`
- [ ] `uninstall(id)` after timeout completes the uninstall with a warning (log captured)
- [ ] `uninstall(id)` for a non-existent id throws `PLUGIN_NOT_INSTALLED`
- [ ] Cleanup timeout is configurable via `config.cleanupTimeoutMs`
- [ ] The transient subscription on `plugin.cleanup.confirm` is properly cleaned up after confirm OR timeout (no leaked subscriptions)
- [ ] A plugin that doesn't subscribe to `plugin.cleanup.confirm` is uninstalled correctly (the platform isn't blocked by missing confirmations)

#### Validation condition

> Uninstall completes the full cleanup sequence: `cleanup` event → wait for confirm OR timeout → registry deregistration → record removal → `uninstalled` event. The record is gone from the install-record file. The capabilities are gone from the Capability Registry.

---

### Phase 7: Startup re-install + integration tests + QA walkthrough

**Goal**: Factory performs startup re-install on construction. Full integration test suite. Manual QA checklist from the FLOW doc can be executed end-to-end.

**Why this phase last**: Startup re-install is the only Phase 0 task that was deferred (it depends on `install`-like mechanics, which depend on the parser + store + events). Doing it last lets us reuse the `applyManifest` helper from Phase 4 with minimal duplication.

**Blocked by**: All previous phases

#### Tasks

- [ ] Add startup re-install to `createPluginManager`:
  - `await store.load()` — throws on malformed file
  - For each record (in insertion order):
    - `applyManifest(record.id, record.source, { expectedId: record.id, allowVersionRefresh: true })`
    - On success: clear `lastError` if it was set; `store.save()` if anything changed
    - On failure (any error): `record.lastError = { code, message, details, at: clock.now() }`; `store.save()`; continue
  - **Do NOT fire `plugin.installed`** on startup — these are not new installs
- [ ] Integration tests in `src/__tests__/integration.test.ts`:
  - Full lifecycle: install → reload → disable → enable → update → uninstall (with cleanup confirm via test Event Bus)
  - Restart simulation: createPluginManager → install → createPluginManager (new instance, same data dir) → list returns the same record
  - Restart with missing source: install → move source file away → createPluginManager → list returns the record with `lastError`
  - Restart with corrupted install-record file: createPluginManager throws `PLUGIN_MANIFEST_INVALID`
  - All error flows from the FLOW QA checklist executed end-to-end
- [ ] Walk through the entire Manual QA Checklist from `FLOW-plugin-manager.md` and verify each item maps to a passing test
- [ ] Run `npm run precommit` and verify clean

#### Tests required

- [ ] Factory re-installs every record on construction
- [ ] Factory re-install sets `lastError` for records whose source is missing, continues for others
- [ ] Factory re-install sets `lastError` for records whose source is invalid, continues for others
- [ ] Factory re-install sets `lastError` for records whose source has a collision, continues for others
- [ ] Factory does NOT publish `plugin.installed` on startup re-install
- [ ] Factory throws `PLUGIN_MANIFEST_INVALID` when the install-record file is malformed
- [ ] Factory completes with no error when the install-record file is missing
- [ ] After a successful install + restart simulation, `list()` returns the same record
- [ ] After install + restart + missing source, the operator can `reload(id)` after fixing the source to clear `lastError`
- [ ] All edge cases from the FLOW QA checklist pass

#### Validation condition

> Full test suite passes. `npm run precommit` is clean (typecheck, lint, build, banned-type check, all tests). The Manual QA Checklist from `FLOW-plugin-manager.md` can be executed step by step with passing assertions.

---

## 4. Dependency Checklist

This checklist is a **hard gate**. No phase may begin code implementation until all packages used in that phase have `opensrc` complete.

### `@platform/event-bus`

- **Version**: workspace
- **Used in**: Phases 3, 4, 5, 6, 7 (all event publishing)
- **TRD section**: 3.1
- **opensrc command run**: N/A — first-party workspace package, source at `packages/event-bus/src/` already in the working tree
- **Source files read**:
  - `packages/event-bus/src/types.ts:75-78` — confirms `EventBus` interface has `publish(name, payload)` and `subscribe(pattern, handler)`
  - `packages/event-bus/src/index.ts` — confirms `publish` shallow-freezes the payload before dispatch
- **Call pattern confirmed from source**:
  ```ts
  import type { EventBus } from "@platform/event-bus";
  void eventBus.publish<PluginInstalledPayload>("plugin.installed", payload);
  ```
- **Error cases to handle** (found in source): `publish()` is async. Subscribe returns `Subscription` with `.unsubscribe()`. Transient subscriptions for cleanup confirmation must be unsubscribed (idempotent — calling `unsubscribe()` twice is a no-op per the TRD).
- **opensrc complete**: Yes (workspace package, source read directly)

### `@platform/capability-registry`

- **Version**: workspace
- **Used in**: Phases 3, 4, 6 (capability registration)
- **TRD section**: 3.2
- **opensrc command run**: N/A — first-party workspace package, source at `packages/capability-registry/src/` already in the working tree
- **Source files read**:
  - `packages/capability-registry/src/types.ts:97-106` — confirms `CapabilityRegistry.register(owner, manifest)` returns `Promise<RegisterResult>`
  - `packages/capability-registry/src/index.ts:32-90` — confirms `register` diffs against the owner's existing manifest; throws on cross-owner collision
- **Call pattern confirmed from source**:
  ```ts
  import type { CapabilityRegistry } from "@platform/capability-registry";
  await registry.register("plugin:" + id, {
    owner: "plugin:" + id,
    capabilities: manifest.capabilities ?? [],
  });
  ```
- **Error cases to handle** (found in source): `register` throws on collision with a different owner. The Plugin Manager pre-checks collisions via `describe()` to surface a structured `PLUGIN_CAPABILITY_COLLISION` error before calling `register()`. For uninstall, `register` with an empty capabilities array removes all of the owner's capabilities via diffing.
- **opensrc complete**: Yes (workspace package, source read directly)

### `yaml`

- **Version**: `^2.6.0`
- **Used in**: Phase 1 (manifest parsing)
- **TRD section**: 3.3
- **opensrc command run**:
  ```bash
  opensrc path yaml@2.6.0
  cat $(opensrc path yaml@2.6.0)/src/public-api.ts
  rg "prettifyError|YAMLParseError|linePos" $(opensrc path yaml@2.6.0)/src/errors.ts
  ```
- **Source files read**:
  - `~/.opensrc/repos/github.com/eemeli/yaml/2.6.0/src/public-api.ts` — confirms `parse(source: string, options?: ParseOptions): unknown` is the entry point
  - `~/.opensrc/repos/github.com/eemeli/yaml/2.6.0/src/errors.ts` — confirms `YAMLParseError.linePos: [{ line, col }]` carries the parse error location
- **Call pattern confirmed from source**:
  ```ts
  import { parse, YAMLParseError } from "yaml";
  try {
    const obj = parse(content, { prettyErrors: false });
    // coerce obj to PluginManifest
  } catch (err) {
    if (err instanceof YAMLParseError && err.linePos?.[0]) {
      const { line, col } = err.linePos[0];
      throw new PluginManagerError("PLUGIN_MANIFEST_INVALID", err.message, { line, col });
    }
    throw err;
  }
  ```
- **Error cases to handle** (found in source): `YAMLParseError` carries `linePos: [LinePos] | [LinePos, LinePos]`. We use `[0]` (the start position). If `prettyErrors: false` is passed, the error message is the raw message without the "at line N, column M" suffix — we add line/column ourselves to `details` so the operator sees both the formatted message and the structured location.
- **opensrc complete**: Yes

---

**Summary table**:

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| `@platform/event-bus` | workspace | 3, 4, 5, 6, 7 | Yes (workspace) | `publish()` is async, shallow-freezes payload. `subscribe` returns `Subscription` with idempotent `unsubscribe()`. |
| `@platform/capability-registry` | workspace | 3, 4, 6 | Yes (workspace) | `register(owner, manifest)` diffs against owner's existing manifest. Throws on cross-owner collision. Empty manifest removes all of the owner's capabilities. |
| `yaml` | `^2.6.0` | 1 | Yes (opensrc) | `parse(source, options?)` returns `unknown`. `YAMLParseError.linePos[0]` carries `{ line, col }`. Pass `prettyErrors: false` and format line/col ourselves. |

## 5. Test Requirements

- **External behavior only.** Tests verify state transitions, return values, published events, and error codes — never internal store structure or event-bus dispatch order beyond what the events enable.
- **Prior art:** follow the patterns in `packages/event-bus/src/__tests__/`, `packages/capability-registry/src/__tests__/`, and `packages/session-manager/src/__tests__/`. vitest, `describe`/`it` blocks, no `vi.useFakeTimers` (the Plugin Manager uses injected `Clock` for any timing concerns, though Phase 0-6 have minimal timing needs).
- **Layer:** all unit + integration tests, no E2E (no Gateway or adapter to test against).
- **Test doubles:**
  - `FileSystem` is injected — tests use an in-memory fake (a `Map<string, string>`)
  - `Clock` is injected — tests use a fake that returns a controllable timestamp
  - `EventBus` is the real `createEventBus()` — tests subscribe to verify events
  - `CapabilityRegistry` is the real `createCapabilityRegistry()` — tests use `list()` to verify capabilities
  - `YamlParser` is the real `yaml` package (it's a pure parser, easy to test directly)
- **Test data:** fixture YAML files in `packages/plugin-manager/src/__tests__/fixtures/`:
  - `browser.yaml` — runtime plugin with 3 capabilities
  - `browser-v2.yaml` — same plugin, new version, 1 removed + 2 added
  - `logging.yaml` — service plugin, 0 capabilities
  - `vscode-helper.yaml` — developer plugin, 0 capabilities
  - `collision.yaml` — runtime plugin claiming `customer.read`
  - `malformed.yaml` — invalid YAML (unclosed quote)
  - `no-type.yaml` — no top-level type key
  - `two-types.yaml` — both `runtime:` and `service:` (ambiguous)

## 6. Rollout Notes

- No feature flags. The Plugin Manager is a new package with no consumers yet.
- The `plugin.*` event namespace does not conflict with any existing namespace (`capability.*`, `event.*`, `session.*`, `browser.*` are all accounted for).
- The `./data/installed-plugins.json` path is configurable via `config.installRecordPath`. Production deployments may want `/var/lib/agentide/plugins.json` — that's a deployment concern, not a code change.
- The cleanup timeout (default 5000ms) is configurable via `config.cleanupTimeoutMs`. Operators who install plugins with many resources may want to raise this.
- The `yaml` package (^2.6.0) adds ~50KB to the bundle (per opensrc cache inspection of `dist/index.js`). This is negligible.
- The Plugin Manager depends on `@platform/capability-registry` which depends on `@platform/event-bus`. When running the workspace, event-bus must be built first.
- Atomic file writes are POSIX-only by default. On Windows, `fs.promises.rename` may fail if the target file is open. Document this as a known limitation; production deployments should run on Linux.
- The plugin manager publishes no `plugin.error` event on the Event Bus (per PRD non-goals). Errors are terminal-only. Operators relying on error visibility use `plugin.list` (which surfaces `lastError`) or watch their terminal/CLI output.