# @platform/plugin-manager

Installs, updates, reloads, enables, disables, and uninstalls plugins from a Plugin Manifest — local YAML files declaring one plugin's identity, version, and the capabilities it registers.

Plugins extend the platform without forking it: Runtime Plugins (the Browser Runtime, etc.) execute agent-driven actions, Service Plugins observe platform health, Developer Plugins add tooling. The Plugin Manager owns the lifecycle and persistence of every plugin; capability registration with the Capability Registry happens through the Manager so operators can swap a plugin's version without redeploying the platform.

## Install

Workspace dependencies on `@platform/event-bus` and `@platform/capability-registry`. One external runtime dependency: `yaml` (^2.6.0) for manifest parsing.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createPluginManager } from "@platform/plugin-manager";

const bus = createEventBus();
const registry = createCapabilityRegistry(bus);
const pm = await createPluginManager(bus, registry, {
  installRecordPath: "/data/installed-plugins.json",
  cleanupTimeoutMs: 5000,
});

// Lifecycle
const record = await pm.install("./browser.yaml");
// record is an InstallRecord: {id, type, version, source, installedAt, enabled}.

const list = pm.list();                    // readonly InstallRecord[]
const one  = pm.get("browser");           // single record or null

await pm.update("browser", "./browser-2.yaml");  // swap install record + re-register caps
await pm.reload("browser");                       // re-read the existing source
await pm.disable("browser");                      // soft pause; capabilities stay registered
await pm.enable("browser");                       // flip back on
await pm.uninstall("browser");                    // fires plugin.cleanup, then removes
```

## Contract

- A Plugin Manifest is a YAML file with exactly one top-level key that names the plugin type and contains the plugin's `id`: `runtime:` (executes agent actions), `service:` (observe-only), `developer:` (tooling). The key-as-type approach is intentional — the type cannot lie.
- Install source in v1 is **local path or private URL only**. `install(registryId)` (the marketplace path) is a stub that throws `PLUGIN_MARKETPLACE_UNAVAILABLE` until the marketplace pack ships.
- Disable is a soft pause. Capabilities stay registered with the Capability Registry; new invocations return `plugin disabled`; in-flight invocations finish against the old version.
- Update swaps the install record + re-registers capabilities with the registry. New invocations route to the new version; in-flight invocations complete against the old.
- Uninstall fires `plugin.cleanup` first (the plugin's window to release its own resources), waits up to `cleanupTimeoutMs` for `plugin.cleanup.confirm` from the plugin (matching `{id}`), then deregisters capabilities and removes the install record. Timeout proceeds anyway with a warning.
- Install records persist to `${installRecordPath}` (default `./data/installed-plugins.json`). On startup the factory re-installs every persisted record (one bad plugin doesn't block the others — its record gets a `lastError` and the boot continues). Re-installs do **not** fire `plugin.installed`.
- Manifest collisions (same capability name already registered under a different owner) cause `applyManifest` to roll back the install atomically.
- Events: `plugin.installed`, `plugin.updated`, `plugin.reloaded`, `plugin.uninstalled`, `plugin.enabled`, `plugin.disabled`, `plugin.cleanup` — all separate, all under `plugin.*`. No `plugin.error` event in v1.
- Errors are terminal-only with structured `{code, message, details}` shape. Code is stable; callers match on `.code`, never on `.message`.

## Public surface

| Export | Kind |
|---|---|
| `createPluginManager` | factory (async) |
| `PluginManager` | interface (9 methods: `install`, `installFromRegistry`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get`) |
| `InstallRecord` | interface (`id`, `type`, `version`, `source`, `installedAt`, `enabled`, `lastError?`) |
| `PluginManagerConfig` | interface (installRecordPath, cleanupTimeoutMs, clock, fs, yaml) |
| `PluginManagerError` | typed error with `.code`, `.message`, `.details` |
| `ERROR_CODES` | constants (16 stable codes) |
| `parseManifest` / `validateManifest` | pure helpers (also exported for tooling) |
| `PluginType` | type (`"runtime" \| "service" \| "developer"`) |

## Design references

- PRD: [docs/features/plugin-manager/PRD-plugin-manager.md](../../docs/features/plugin-manager/PRD-plugin-manager.md)
- TRD: [docs/features/plugin-manager/TRD-plugin-manager.md](../../docs/features/plugin-manager/TRD-plugin-manager.md)
- FLOW: [docs/features/plugin-manager/FLOW-plugin-manager.md](../../docs/features/plugin-manager/FLOW-plugin-manager.md)
- IMPL: [docs/features/plugin-manager/IMPL-plugin-manager.md](../../docs/features/plugin-manager/IMPL-plugin-manager.md)
- GRILL: [docs/features/plugin-manager/GRILL-plugin-manager.txt](../../docs/features/plugin-manager/GRILL-plugin-manager.txt)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Plugin*, *Plugin Manager*, *Plugin Manifest*