# PRD: Plugin Manager

## Status

- Type: Product requirements document
- Audience: Product, engineering, QA — operator-primary, developer + plugin-author secondary
- Scope: In-process control-plane component that installs, updates, disables, enables, reloads, lists, and uninstalls plugins from a local Plugin Manifest, with persistent install state and Event Bus integration.
- Status: Approved 2026-07-27 — Phase 1 gate passed. Phase 0 grilling complete (10 decisions locked in `CONTEXT.md` Decisions Log); ready for TRD.

## Summary

The Plugin Manager is the platform's plugin lifecycle owner. Every Runtime Plugin, Service Plugin, and Developer Plugin flows through it: install, list, update, disable, enable, reload, uninstall. Without it, the platform's plugin model is just documentation — no one can actually add a plugin to a running platform. With it, operators can extend the platform at runtime without forking, redeploying, or coordinating with the platform team's release schedule. The Plugin Manager is part of the Control Plane, sits next to the Capability Registry and Session Manager, and uses the Event Bus to publish lifecycle events the rest of the platform consumes.

## Problem

Operators have no way to add a new execution environment to a running platform. Today, every Runtime Plugin must be baked into the platform at build time. Want the Browser Runtime? Fork the platform, add the code, redeploy. Want the Git Runtime next month? Repeat. The cost:

- **Coupled releases.** Any platform update requires a coordinated plugin update. A patch in the Browser Runtime means a platform release.
- **Bug amplification.** A misbehaving plugin crashes the whole platform, because it runs in the same process with no isolation.
- **Operational rigidity.** Operators can't experiment with a new runtime without scheduling a redeploy. They can't roll back a plugin without rolling back the platform.
- **No install audit.** There's no record of which plugins are installed, where they came from, or when. Debugging "why is this happening?" requires reading the platform's build manifest.

The Plugin Manager fixes this. It reads a Plugin Manifest, validates it, registers the plugin's capabilities with the Capability Registry, persists the install record, and emits lifecycle events. The platform becomes a coordinator, not a compiler.

## Product Goals

1. Install a plugin from a local Plugin Manifest file (manifest path, `--source`), parse it, validate it, and register its capabilities with the Capability Registry. Emit `plugin.installed`.
2. List installed plugins with their id, type, version, source, install timestamp, and enabled/disabled state. Emit nothing (read-only).
3. Update an installed plugin to a new version from a new source. Swap the install record, re-register capabilities, emit `plugin.updated`. In-flight capability invocations complete against the old version; new invocations route to the new.
4. Reload an installed plugin from its current source (re-read the manifest file). Re-register capabilities, emit `plugin.reloaded`. Same mechanics as update, but no version-bump requirement.
5. Disable an installed plugin without removing it. Capabilities stay registered, but new invocations return "plugin disabled" error. In-flight invocations finish. Emit `plugin.disabled`.
6. Enable a disabled plugin. Flip the state, accept new invocations again. Emit `plugin.enabled`.
7. Uninstall an installed plugin. Fire `plugin.cleanup` first (the plugin gets a chance to clean up its own resources), wait for the plugin to confirm cleanup, then fire `plugin.uninstalled` and remove the install record. In-flight invocations finish; idle sessions lose access on next call.
8. Persist install records to a JSON file on disk (`./data/installed-plugins.json`). On startup, re-install each plugin from its source. If a source file is missing at startup, fail the re-install for that plugin with a clear error and preserve the install record (operator can fix the source and run `plugin.reload` to recover).
9. Validate every install/update/reload against: (a) manifest schema — exactly one of `runtime:`, `service:`, `developer:` at the top level, with `id` and `version` present; (b) capability name format `domain.action`; (c) no collision with already-registered capability names. Fail with a clear, structured error on any validation miss.
10. Publish the seven plugin lifecycle events on the Event Bus (`plugin.installed`, `plugin.updated`, `plugin.reloaded`, `plugin.uninstalled`, `plugin.enabled`, `plugin.disabled`, `plugin.cleanup`), each with a stable payload shape that other components can subscribe to without coupling to the Plugin Manager's internals.
11. Return every error in a structured `{ code, message, details }` shape so operators, dashboards, and automation can match on stable codes.

## Non-Goals

- **Public Plugin Marketplace / registry lookups.** v1 implements the local-source path only. `plugin.install <registry-id>` (without `--source`) is part of the API shape but stubs out with `PLUGIN_MARKETPLACE_UNAVAILABLE` until the marketplace pack ships.
- **Plugin signing and signature verification.** Out of scope for v1. Deferred to the marketplace pack.
- **Plugin sandboxing / runtime isolation.** Out of scope. v1 plugins run in the same process as the Plugin Manager. Isolation is a separate platform concern.
- **Cross-plugin dependency resolution.** v1 does not honor a manifest's `requires: [other-plugin]` field. Plugins are independent. Cross-plugin deps are deferred until a real use case forces a design pass.
- **Platform-version constraint enforcement.** v1 does not honor a manifest's `requires: { platform: ">=1.0" }` field. Deferred.
- **Tenant-isolated plugin views.** Multi-tenancy for plugins is out of scope until the Tenant design in `CONTEXT.md` stabilizes.
- **Auto-updates / scheduled plugin upgrades.** Operators trigger updates explicitly via `plugin.update`. No background refresh, no auto-upgrade on new version detection.
- **Plugin discovery from a local plugin directory (e.g. "scan `./plugins/` for manifests").** Operators point at one file at a time via `--source`. Directory scanning is a follow-up.
- **`plugin.error` event on the Event Bus.** Errors are terminal-only in v1 (visible in operator's CLI). An event-bus error channel is a follow-up when a real consumer asks for it.
- **Plugin capability versioning.** A capability is registered with a single canonical name. If a plugin wants to expose `customer.v2.read`, that's a different capability name. No version-tagged capabilities in v1.

## Canonical Product Language

All terms defined in `docs/CONTEXT.md`. This PRD binds the following glossary entries to concrete behaviour:

- **Platform** — the whole system; the Plugin Manager is part of its Control Plane.
- **Control Plane** — Gateway, Session Manager, Capability Registry, Plugin Manager. Coordinates, doesn't execute.
- **Plugin** — extends the platform without touching core. Three types:
  - **Runtime Plugin** — Execution Plane (e.g. Browser, Git, Docker). Owns resources.
  - **Service Plugin** — supporting, no execution (e.g. logging, auth, metrics).
  - **Developer Plugin** — tooling (e.g. dashboard extensions, IDE helpers).
- **Plugin Manager** — installs/updates/disables/enables/reloads/uninstalls/lists plugins. Part of the Control Plane.
- **Plugin Manifest** — declarative plugin identity, version, and capabilities. Top-level key (`runtime:`, `service:`, or `developer:`) names the plugin type and contains the plugin's `id`. Exactly one of these keys per manifest.
- **Plugin lifecycle** — `Installed → Loaded → Initialized → Registers Capabilities → Running → Stopped → Unloaded`. v1 manages the install/load/init/register/running transitions. Stopped and Unloaded are emitted by the plugin itself in response to `plugin.cleanup` during uninstall.
- **Capability Registry** — where the Plugin Manager registers a plugin's capabilities at install/update/reload time. Discovered via the `plugin.list` / `plugin.describe` capabilities surfaced by the Plugin Manager.
- **Event Bus** — how the Plugin Manager publishes lifecycle events. Custom (not EventEmitter). All plugin events live under the `plugin.*` namespace. The Plugin Manager does not publish anything under `event.*` (reserved for bus-internal events).
- **Install record** — the durable state the Plugin Manager keeps about each installed plugin: `{ id, type, version, source, installedAt, enabled }`. Persisted to disk.
- **Operator** — the person who runs the platform. The Plugin Manager's primary user.
- **Plugin author** — the person who writes a Plugin Manifest. The Plugin Manager's secondary audience; their concern is the manifest format and event surface.

No new glossary terms are introduced by this PRD.

## Product Scope

### Install a plugin (first install)

Operator runs `plugin.install --source ./browser.yaml`. The Plugin Manager reads the file, parses the YAML, validates the manifest (schema, capability format, no collisions), creates an install record, persists it to `./data/installed-plugins.json`, registers the capabilities with the Capability Registry, transitions the plugin through `Loaded → Initialized → Registers Capabilities → Running`, and fires `plugin.installed` on the Event Bus. The operator gets a success response with the install record.

If the source file doesn't exist: `PLUGIN_SOURCE_NOT_FOUND` error. If the manifest is malformed: `PLUGIN_MANIFEST_INVALID`. If a capability collides: `PLUGIN_CAPABILITY_COLLISION`. In every failure case, the install record is **not** created, the capabilities are **not** registered, and no event fires.

### Install a plugin (already installed)

If the operator runs `plugin.install --source ./browser.yaml` for an id that's already installed, the call returns `PLUGIN_ID_ALREADY_INSTALLED` with details pointing the operator to `plugin.update` instead. No silent overwrite.

### Update a plugin

Operator runs `plugin.update browser --source ./browser-v2.yaml`. The Plugin Manager re-reads the file, validates the new manifest, swaps the install record (version bumps, source path updates), re-registers the capabilities (old removed, new added), and fires `plugin.updated`. In-flight capability invocations complete against the old handler; new invocations route to the new handler. If the new manifest has a collision, the update fails, the install record is unchanged, the old capabilities are still registered.

### Reload a plugin

Operator runs `plugin.reload browser`. The Plugin Manager re-reads `./browser.yaml` (the install record's source path), refreshes the version field if the manifest version differs, re-registers the capabilities, and fires `plugin.reloaded`. No version-bump requirement. If the source file is missing, the install record is preserved and the operator gets a clear error pointing them to fix the path or restore the file. No state changes except the version field and the capability registration.

### Disable a plugin

Operator runs `plugin.disable browser`. The Plugin Manager flips the enabled flag in the install record, but does not unregister the capabilities. New invocations of the plugin's capabilities return a "plugin disabled" error. In-flight invocations finish. The Capability Registry still shows the capabilities. Fires `plugin.disabled`. The plugin is paused, not removed.

### Enable a plugin

Operator runs `plugin.enable browser`. The Plugin Manager flips the enabled flag back, accepts new invocations again, and fires `plugin.enabled`. The plugin is unpaused, no other state changes.

### Uninstall a plugin

Operator runs `plugin.uninstall browser`. The Plugin Manager marks the install record as "uninstalling", fires `plugin.cleanup` on the Event Bus, and waits for the plugin to confirm cleanup (the plugin is expected to clean up its own resources — close browser tabs, cancel in-flight handlers, etc.). On confirmation, the Plugin Manager fires `plugin.uninstalled`, removes the install record from disk, and unregisters the capabilities from the Capability Registry. In-flight capability invocations complete against the old handler; idle sessions lose access on next call.

If the plugin never confirms cleanup within a timeout, the uninstall proceeds anyway (resource leak is the plugin's problem, not the platform's). The operator gets a warning but the uninstall completes.

### List installed plugins

Operator runs `plugin.list`. The Plugin Manager reads the install records and returns an array of `{ id, type, version, source, installedAt, enabled }`. Read-only — no state change, no event fired.

### Persist across restarts

When the platform starts, the Plugin Manager reads `./data/installed-plugins.json` and re-installs each plugin from its source. The lifecycle is the same as a fresh install (Loaded → Initialized → Registers Capabilities → Running). If a source file is missing at startup, the re-install fails for that plugin with a clear error, the install record is preserved (not deleted), and the operator can fix the source and run `plugin.reload` to recover. Other plugins in the same file still re-install successfully — one bad source doesn't block the others.

### Error surface

Every error from every plugin operation returns `{ code, message, details }`. Code is a stable string identifier (e.g. `PLUGIN_SOURCE_NOT_FOUND`). Message is human-readable for the operator's terminal. Details are structured data for tooling and logs. Errors are terminal-only in v1 — no `plugin.error` event on the Event Bus.

### Event surface

The Plugin Manager publishes seven events on the Event Bus, all under the `plugin.*` namespace:

| Event | When | Payload (initial) |
|---|---|---|
| `plugin.installed` | First install of a plugin id | `{ id, type, version, source, installedAt }` |
| `plugin.updated` | `plugin.update` swaps to a new version | `{ id, oldVersion, newVersion, source, updatedAt }` |
| `plugin.reloaded` | `plugin.reload` re-reads the source | `{ id, version, reloadedAt }` |
| `plugin.uninstalled` | Plugin removed | `{ id, uninstalledAt }` |
| `plugin.enabled` | `plugin.enable` flips state | `{ id, enabledAt }` |
| `plugin.disabled` | `plugin.disable` flips state | `{ id, disabledAt }` |
| `plugin.cleanup` | Fires before `plugin.uninstalled` | `{ id }` |

These events are published **after** the state transition is complete, so a listener that immediately reads the install record sees the new state. The sole exception is `plugin.cleanup`, which fires before the install record is removed — this guarantees the plugin receives the cleanup signal even if the uninstall fails midway.

## User Stories

1. As an **operator**, I want to install a plugin from a local manifest file, so that I can add a new Runtime Plugin to the platform without forking or redeploying.
2. As an **operator**, I want to see a list of installed plugins with their version, source, and state, so that I can audit what's running on the platform.
3. As an **operator**, I want to update a plugin to a new version, so that I can roll out bug fixes and new features without a platform redeploy.
4. As an **operator**, I want to reload a plugin from its current source after editing the manifest, so that I can fix typos and add capabilities without bumping the version.
5. As an **operator**, I want to disable a plugin temporarily without uninstalling it, so that I can pause a misbehaving plugin while I investigate, without losing the install record.
6. As an **operator**, I want to enable a disabled plugin, so that I can resume a paused plugin with a single command.
7. As an **operator**, I want to uninstall a plugin, so that I can permanently remove it from the platform when I'm done with it.
8. As an **operator**, I want plugin install state to survive a platform restart, so that I don't have to re-install every plugin after every deploy.
9. As an **operator**, I want clear, structured error messages when an install/update/reload fails, so that I can fix the problem without reading the source code.
10. As a **plugin author**, I want a stable Plugin Manifest format and a documented event surface, so that my plugin works with the platform and reacts to lifecycle events correctly.
11. As a **platform component** (e.g. an analytics plugin), I want to subscribe to `plugin.*` events, so that I can track installs, removals, and state changes without polling.
12. As a **plugin**, I want to receive a `plugin.cleanup` event before being uninstalled, so that I can close my own resources cleanly (browser tabs, file handles, network connections).

## Acceptance Criteria

### Install

- [ ] `plugin.install --source ./valid-manifest.yaml` creates an install record, registers capabilities, fires `plugin.installed`, returns the install record.
- [ ] The install record is persisted to `./data/installed-plugins.json` synchronously before the success response returns.
- [ ] A second `plugin.install` for the same id returns `PLUGIN_ID_ALREADY_INSTALLED` and does not modify the install record.
- [ ] A missing source file returns `PLUGIN_SOURCE_NOT_FOUND` with the source path in `details`.
- [ ] A manifest with no top-level `runtime:`/`service:`/`developer:` key returns `PLUGIN_TYPE_MISSING`.
- [ ] A manifest with a capability name not matching `domain.action` returns `PLUGIN_CAPABILITY_NAME_INVALID`.
- [ ] A manifest with a capability name already registered returns `PLUGIN_CAPABILITY_COLLISION` and does not register any of the new plugin's capabilities.
- [ ] `plugin.install browser` (no `--source`, registry id) returns `PLUGIN_MARKETPLACE_UNAVAILABLE` in v1.

### List

- [ ] `plugin.list` returns an array of install records, including id, type, version, source, installedAt, enabled.
- [ ] `plugin.list` is read-only — no event fired, no install record modified.

### Update

- [ ] `plugin.update browser --source ./new.yaml` re-validates, swaps the install record, re-registers capabilities, fires `plugin.updated` with `oldVersion` and `newVersion`.
- [ ] An in-flight capability invocation completes against the old handler when the update is in progress.
- [ ] A new capability invocation after the update completes routes to the new handler.
- [ ] An update that fails validation (collision, malformed manifest) does not modify the install record and does not unregister the old capabilities.

### Reload

- [ ] `plugin.reload browser` re-reads the install record's source, re-validates, re-registers capabilities, fires `plugin.reloaded`.
- [ ] If the manifest version differs from the install record's version, the install record's version is updated.
- [ ] If the manifest version is the same, only the capabilities are re-registered (no version change).
- [ ] A missing source file returns a clear error and preserves the install record.
- [ ] The `enabled` flag and `installedAt` timestamp are not changed by reload.

### Disable / Enable

- [ ] `plugin.disable browser` flips the install record's `enabled` to `false`, fires `plugin.disabled`, leaves the capabilities registered.
- [ ] A new capability invocation against a disabled plugin returns "plugin disabled" error.
- [ ] An in-flight capability invocation against a disabled plugin completes normally.
- [ ] `plugin.enable browser` flips the install record's `enabled` to `true`, fires `plugin.enabled`.
- [ ] `plugin.disable` on an already-disabled plugin is a no-op (no event fired, no error).
- [ ] `plugin.enable` on an already-enabled plugin is a no-op.

### Uninstall

- [ ] `plugin.uninstall browser` fires `plugin.cleanup`, waits for plugin confirmation (or timeout), then fires `plugin.uninstalled`, removes the install record, unregisters the capabilities.
- [ ] An in-flight capability invocation completes against the old handler during the uninstall.
- [ ] A new capability invocation after uninstall completes returns "capability not found" (not "plugin disabled").
- [ ] If the plugin never confirms cleanup within the timeout, the uninstall proceeds with a warning, the install record is removed.
- [ ] `plugin.uninstall` on a not-installed id returns `PLUGIN_NOT_INSTALLED`.

### Persistence

- [ ] On platform startup, every install record in `./data/installed-plugins.json` is re-installed from its source.
- [ ] If a source file is missing at startup, the re-install fails for that plugin only, with a clear error; other plugins still re-install.
- [ ] The install record is preserved on disk when a re-install fails (operator can fix the source and run `plugin.reload`).
- [ ] Every install, update, reload, enable, disable operation that changes the install record writes the new state to disk synchronously.

### Events

- [ ] `plugin.installed`, `plugin.updated`, `plugin.reloaded`, `plugin.uninstalled`, `plugin.enabled`, `plugin.disabled`, `plugin.cleanup` all fire on the Event Bus with the documented payloads.
- [ ] No event fires for a failed operation (collision, malformed manifest, etc.).
- [ ] `plugin.cleanup` fires before `plugin.uninstalled`.
- [ ] All other events fire after the state transition is complete.

### Errors

- [ ] Every error from every plugin operation returns `{ code, message, details }`.
- [ ] Code is a stable string identifier.
- [ ] Message is human-readable, no stack traces, no jargon.
- [ ] Details contain structured data useful for tooling (the source path, the conflicting capability, the expected vs got value, etc.).

## Rollout and Risk

- **Migration risk**: none at the install layer — no other component depends on the Plugin Manager yet. Tier 2 (Gateway, Platform Capabilities) is the first real consumer; both are unstarted.
- **Compatibility risk**: low. The Plugin Manager publishes events but no other component subscribes to them yet. Adding subscribers later is additive.
- **Rollout strategy**: ship as a single npm workspace package `@platform/plugin-manager` inside `agentide/packages/`, with `@platform/event-bus` and `@platform/capability-registry` as workspace dependencies. Land it behind no flag — it has no behaviour until an operator runs `plugin.install` or a startup happens with existing install records.
- **Drift watch**: if the public Plugin Marketplace design (in `architecture/Plugin_Marketplace.md`) ships before this pack, reconcile the registry-id path. If the Capability Registry's API changes (e.g. capability versioning), update the validation step here before locking the TRD.
- **Install record corruption**: the persisted file could become corrupted. v1 reads the file at startup; if a record is malformed, the operator gets a clear error and the rest of the file still loads. Atomic writes (write to a temp file, then rename) prevent partial writes from corrupting the file.
- **Source file tampering**: the Plugin Manager doesn't sign or verify source files. An operator with write access to `./data/installed-plugins.json` and the source files can replace a plugin. v1 trusts the operator; signing is a marketplace concern.

## Out of Scope

| Item | Reason deferred |
|---|---|
| Public Plugin Marketplace / registry lookups | A separate pack with its own design (trust tiers, signing, review, publishing flow). v1 stubs the registry-id path with a clear error. |
| Plugin signing / signature verification | Marketplace pack. v1 trusts the operator's source files. |
| Plugin sandboxing / runtime isolation | A separate platform concern. v1 plugins run in the same process. |
| Cross-plugin dependency resolution | Real but needs a dependency-graph design pass (e.g. install order, version constraints, failure recovery). Deferred until a use case forces it. |
| Platform-version constraint enforcement | Needs a platform versioning convention first. Deferred. |
| Tenant-isolated plugin views | Tenant design in `CONTEXT.md` is open. Deferred until tenant semantics land. |
| Auto-updates / scheduled plugin upgrades | Operators trigger updates explicitly. No background refresh. |
| Plugin discovery from a directory (`./plugins/*.yaml`) | Directory scanning is a follow-up. v1 takes one file at a time via `--source`. |
| `plugin.error` event on the Event Bus | Terminal-only errors in v1. An event-bus error channel is a follow-up when a real consumer asks for it. |
| Plugin capability versioning | A capability is registered with a single canonical name. Version-tagged capabilities are a follow-up. |
| Plugin code execution model | The Plugin Manager doesn't define how a plugin's code is loaded or run — it just manages the install record and capability registration. The Runtime Plugin's code-loading is a separate concern owned by each plugin. |

## Further Notes

### Resolved design decisions (from grilling)

The Phase 0 grilling produced 10 decisions, all captured in `docs/CONTEXT.md` Decisions Log (entry dated 2026-07-27). The full grill transcript is preserved in `GRILL-plugin-manager.txt` (to be created during this PRD's gate). Each decision maps to one or more sections of this PRD:

| Grilling decision | PRD section |
|---|---|
| Manifest shape (top-level key as type) | Canonical Product Language → Plugin Manifest; Product Scope → Install |
| Install source (local for v1, registry stub) | Non-Goals; Product Scope → Install |
| Disable = soft pause, in-flight finishes | Product Scope → Disable / Enable; Acceptance Criteria |
| Update = swap record, in-flight finishes | Product Scope → Update; Acceptance Criteria |
| Validation: schema + format + no collisions | Product Goals #9; Product Scope → Install; Acceptance Criteria |
| Storage: option B (persist to disk) | Product Goals #8; Product Scope → Persist across restarts; Acceptance Criteria |
| Reload = separate from update | Product Scope → Reload; Acceptance Criteria |
| Uninstall = cleanup event, then removed | Product Scope → Uninstall; Acceptance Criteria |
| Events: 7 separate, all `plugin.*` | Product Scope → Event surface; Acceptance Criteria |
| Errors: structured `{ code, message, details }` | Product Scope → Error surface; Acceptance Criteria |

### Open items carried forward

- **Plugin Manager ↔ Plugin code contract.** The PRD defines how the Plugin Manager manages install state and capability registration, but does not define how a plugin's code is actually loaded and run. Each plugin type will need its own code-loading contract (e.g. a Runtime Plugin probably loads from a path declared in the manifest; a Service Plugin might be a callback registered on install). This is a follow-up design pass; v1 is correct to defer it.
- **Cleanup timeout value.** The PRD says "if the plugin never confirms cleanup within a timeout, the uninstall proceeds with a warning." The actual timeout value (5s? 30s? configurable?) is a TRD-level decision. Default: 5 seconds, configurable per-plugin via manifest metadata.
- **`installed-plugins.json` location.** `./data/installed-plugins.json` is the default; should be configurable via Plugin Manager config in the TRD. Self-hosted operators may want `/var/lib/agentide/plugins.json` or similar.
- **Drift D-1 (session-manager)** remains open and unrelated. Surfaced in grilling but not material here.

### Related documents

- Grill notes: `GRILL-plugin-manager.txt` (Phase 0)
- Glossary: `docs/CONTEXT.md`
- Event Bus contract: `docs/features/event-bus/PRD-event-bus.md`
- Capability Registry: `docs/features/capability-registry/PRD-capability-registry.md`
- Plugin Manager in architecture: `docs/architecture/Agentide.md` (Section 5 → Plugin Manager)
- Terminology: `docs/architecture/Terminology.md` (Plugin, Plugin Manager, Plugin Manifest, Runtime Plugin, Service Plugin, Developer Plugin)
- Plugin Marketplace: `docs/architecture/Plugin_Marketplace.md` (registry-id path stub)
- Runtime Plugin lifecycle: `docs/architecture/Runtime_Capabilities.md` (Installed → Loaded → Initialized → Registers Capabilities → Running)
