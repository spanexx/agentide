# PRD-TRD: gateway-plugin-dispatch

**Slug:** gateway-plugin-dispatch
**Status:** Approved
**Date:** 2026-07-30

## Why This Exists

`gateway-core/src/dispatch.ts` routes every capability invocation by `owner`. When the owner prefix is `plugin:<id>` (a runtime plugin), the kernel currently throws `GATEWAY_MANAGER_UNAVAILABLE { retryable: true }`. Two consequences:

1. **Browser Runtime, Git Runtime, Docker Runtime, and the other Tier 4 runtimes cannot be invoked end-to-end** even though they install cleanly, register their capabilities in the registry, and emit lifecycle events. The kernel advertises them as invocable, then refuses them at call time.
2. **The control plane (gateway-core) and the runtime-hosting layer (plugin-manager) are independently complete but uncoordinated.** Each has a clean `install → list → describe` story; the gap is the *invoke* leg.

Without this pack, the platform can describe every runtime plugin's capabilities but cannot execute any of them. The user pays the cost in error logs and developer confusion.

This pack closes that gap: when `dispatch.ts` sees `owner.startsWith("plugin:")`, it looks up the runtime plugin's handler map and invokes it. The handler runs in-process (same Node process as the gateway) because that is the smallest viable build per the locked GRILL. A future pack may move handlers into a child process or a remote runtime; that decision is replaced behind a `PluginLoader` interface so swapping is a configuration change, not a rewrite.

## Behavioral Spec

### Scenario 1: Plugin installs with handler

**Given** a manifest `plugin.yaml` declaring `runtime: { id: browser, entry: ./browser-handlers.mjs }` and a sibling `browser-handlers.mjs` that exports `{ "browser.navigate": async (input, ctx) => ({ navigated: true, url: input.url }) }`
**When** the operator runs `plugin.install ./plugin.yaml`
**Then** `gateway.handleInvocation({ owner: "plugin:browser", capability: { name: "browser.navigate" } })` returns `{ navigated: true, url: "..." }`. No errors. The handler runs in the gateway process; the user sees the result in the invocation response.

### Scenario 2: Plugin without `entry` field

**Given** a manifest declaring `runtime: { id: legacy }` (no `entry`)
**When** the operator tries to invoke any of the plugin's capabilities via the gateway
**Then** `gateway.handleInvocation(...)` throws `GATEWAY_HANDLER_NOT_FOUND { pluginId: "legacy" }`. The install itself succeeded; only the invoke fails. The plugin shows in `plugin.list` with its declared capabilities, but those capabilities have no handler. The error message tells the operator why.

### Scenario 3: Disabled plugin

**Given** an installed runtime plugin with a loaded handler
**When** the operator runs `plugin.disable <id>` and then invokes one of its capabilities
**Then** `gateway.handleInvocation(...)` throws `GATEWAY_PLUGIN_DISABLED { pluginId, reason: "plugin disabled" }` (kernel pre-check fires before PM dispatch; PM-side fallback is `GATEWAY_HANDLER_NOT_FOUND` if pre-check is removed). Re-enabling the plugin (`plugin.enable <id>`) flips the flag back and the next invocation succeeds without re-importing the entry module.

### Scenario 4: Capability not in the handler map

**Given** a plugin with handler map `{ "browser.navigate": fn }` only
**When** the operator invokes `browser.click` (declared in the manifest but no handler function provided)
**Then** `gateway.handleInvocation(...)` throws `GATEWAY_HANDLER_NOT_FOUND { pluginId, capabilityName: "browser.click" }`. The error mentions both the plugin and the specific capability.

### Scenario 5: Handler throws

**Given** a plugin with a handler that throws on bad input
**When** the operator calls the capability with input that triggers the throw
**Then** `gateway.handleInvocation(...)` throws `GATEWAY_HANDLER_ERROR { pluginId, capabilityName, originalError }` (per approved Option B; mapped from PM's `PLUGIN_HANDLER_ERROR`). The audit log records `plugin.handler.error` with the same payload. The original handler error message is preserved in the structured error details (not the public message) — operators with audit access can read it; end users see only the structured public message.

### Scenario 6: Entry module fails to load

**Given** a manifest declaring `entry: ./nonexistent.mjs` (the file does not exist)
**When** the operator runs `plugin.install`
**Then** the install returns the install record (the metadata is valid), the runtime plugin is registered, and `plugin.handler.loaded` fires with `ok: false` carrying the import error. Invocation of any of its capabilities throws `GATEWAY_HANDLER_NOT_FOUND`. After the operator fixes the file and runs `plugin.reload`, the handler is re-imported successfully.

### Scenario 7: Plugin uninstall removes handlers

**Given** an installed runtime plugin with a loaded handler
**When** the operator runs `plugin.uninstall <id>`
**Then** the plugin's record is removed, its capabilities are unregistered, and the handler map entry is freed. A subsequent `gateway.handleInvocation(...)` for one of those capabilities returns either `GATEWAY_CAPABILITY_NOT_FOUND` (registry lookup fires first in `handleInvocation`'s resolution sequence) or `GATEWAY_HANDLER_NOT_FOUND` (handler map lookup first), depending on which path fires first. Both signal "this cap is not callable".

### Scenario 8: Concurrent invocations

**Given** an installed runtime plugin with a handler that takes 50ms to complete
**When** the operator invokes the same capability twice in parallel
**Then** both invocations complete in ~50ms (not ~100ms). The handler map is per-plugin, and each invocation invokes the handler function reference independently. Concurrent invocations do not block each other.

## Simulation Contract

The post-impl simulation must demonstrate each of the 8 scenarios above by driving the real `@platform/plugin-manager`, `@platform/gateway-core`, and `@platform/agentide` packages end-to-end. Concrete requirements:

```bash
# Scenario 1
install ./fixtures/plugin-with-entry.yaml
invoke browser.navigate '{"url":"https://example.com"}'
# → returns {"navigated":true,"url":"https://example.com"}

# Scenario 2
install ./fixtures/plugin-no-entry.yaml
invoke browser.navigate '{}'
# → error: PLUGIN_HANDLER_NOT_FOUND

# Scenario 3
plugin.install ./fixtures/plugin-with-entry.yaml
plugin.disable browser
invoke browser.navigate '{}'
# → error: PLUGIN_HANDLER_NOT_FOUND (reason: plugin disabled)
plugin.enable browser
invoke browser.navigate '{}'
# → returns {"navigated":true,"url":"..."}

# Scenario 4
invoke browser.click '{}'
# → error: PLUGIN_HANDLER_NOT_FOUND (cap name not in handler map)

# Scenario 5
invoke browser.boom '{}'
# → error: PLUGIN_HANDLER_ERROR; audit log has plugin.handler.error entry

# Scenario 6
plugin.install ./fixtures/plugin-broken-entry.yaml
# → returns install record; fires plugin.handler.loaded {ok:false}
invoke browser.navigate '{}'
# → error: PLUGIN_HANDLER_NOT_FOUND
plugin.reload browser
# → fires plugin.handler.loaded {ok:true}; invocation now succeeds

# Scenario 7
plugin.uninstall browser
invoke browser.navigate '{}'
# → error: PLUGIN_CAPABILITY_NOT_FOUND (different from HANDLER_NOT_FOUND)

# Scenario 8
invoke browser.navigate '{}'  # both back-to-back
# → wall-clock time for both < 100ms when one handler takes 50ms
```

## Technical Design

### Data Models

```typescript
// Manifest (existing, extended by optional 'entry' field)
interface PluginManifest {
  readonly runtime?: {
    readonly id: string;
    readonly entry?: string;  // NEW: path to a Node ESM module
  };
  readonly service?: { readonly id: string };
  readonly developer?: { readonly id: string };
  readonly version: string;
  readonly capabilities?: readonly ManifestCapability[];
  readonly metadata?: Readonly<Record<string, string>>;
}

// PluginHandler signature (new — exported from plugin-manager)
type PluginHandler = (
  input: YamlValue,
  ctx: HandlerContext,
) => Promise<YamlValue>;

interface HandlerContext {
  readonly pluginId: string;
  readonly sessionId: string | undefined;
}

// HandlerRegistry — internal store, keyed by plugin id
interface StoredEntry {
  loaded: LoadedHandlers;
  disabled: boolean;
}

interface LoadedHandlers {
  readonly entry: string;                        // resolved path
  readonly handlers: Readonly<Record<string, PluginHandler>>;
}
```

### API Contracts

**New method on `PluginManager`:**

```typescript
handleInvocation(
  name: string,
  input: YamlValue,
  sessionId: string | undefined,
): Promise<YamlValue>;
```

Resolves `name` to a capability descriptor, determines the owning plugin from the descriptor's `owner` field (`plugin:<id>`), looks up the handler in the registry, invokes it with the supplied input and a `HandlerContext` containing `pluginId` + `sessionId`, and returns the handler's return value.

**Throws:**

- `HANDLER_NOT_FOUND` — plugin has no entry loaded, plugin is disabled, or capability name not in the handler map.
- `HANDLER_ERROR` — handler itself threw; the original error is wrapped, the public message is sanitized, audit event `plugin.handler.error` fires.

**Capability Registry change:** none. Capabilities are already registered with `owner: "plugin:<id>"` at install time. This pack only addresses the invoke leg.

**New Event Bus topics:**

- `plugin.handler.loaded { id, version, loadedAt, ok, error? }` — fires at install and reload time after the dynamic import attempt.
- `plugin.handler.error { id, capability, at, error }` — fires when a handler throws.

**New error codes:**

- `PLUGIN_HANDLER_NOT_FOUND` — the plugin has no handler entry / is disabled / cap not in map. (Becomes `GATEWAY_HANDLER_NOT_FOUND` after kernel mapping.)
- `PLUGIN_HANDLER_LOAD_FAILED` — the entry module failed to dynamic-import.
- `PLUGIN_HANDLER_ERROR` — the handler itself threw.

### Dependencies

- **`node:fs/promises`** (Node stdlib) — for reading manifest source.
- **Node ESM `import()`** (Node 14+) — for loading plugin entry modules at install time. No third-party dependency.
- **Internal:** `@platform/capability-registry` (describe lookup), `@platform/event-bus` (publish), `@platform/gateway-core` (for the kernel wire in Phase 5 — this PRD documents the contract).

### Architecture Notes

The handler storage is in-memory only, owned by the Plugin Manager. No on-disk handler persistence — on every platform restart, runtime plugins re-install via the existing startup-reinstall pipeline, and each install re-imports the entry module.

**Entry-path resolution:** `runtime.entry` is resolved relative to the manifest's source path. A manifest at `/data/plugins/browser.yaml` with `entry: ./browser-handlers.mjs` loads `/data/plugins/browser-handlers.mjs`. Absolute paths are honored as-is.

**Lifecycle interactions:**

- `install()`: after the existing capability registration succeeds, attempt to load handlers. On failure, fire `plugin.handler.loaded { ok: false }` and proceed (install still returns the record; invocation will fail until reload).
- `reload()`: re-read the manifest, re-import the entry. Idempotent — replaces prior handlers in place.
- `disable()`: flip the `disabled` flag. Handlers remain in memory but `get()` refuses them.
- `enable()`: flip the flag back. No re-import needed.
- `uninstall()`: `dropHandlers` frees the map entry.

**Phase 5 wiring (this PRD's deliverable, but in `gateway-core`, not `plugin-manager`):** `dispatch.ts:90-103` swaps the `MANAGER_UNAVAILABLE` throw for a synchronous call to `pluginManager.handleInvocation(name, input, sessionId)`. The error codes that `handleInvocation` throws get mapped to `GATEWAY_*` codes by a small try/catch in dispatch (same mapping convention as the `backend-sdk-*` path). Phase 5 is the dispatch swap, not the plugin-manager change — plugin-manager's role stays the same.

## Non-Goals

- **Process isolation between plugin and gateway.** v1 plugins run in the same Node process. Sandbox / IPC is deferred to a future "Plugin Sandboxing" pack if/when needed. Architecture doc `Capability_System.md` documents this limit.
- **Hot-reload of a single handler function (not the whole plugin).** `reload()` reloads the entire entry module. If one handler crashes, the operator `reload`s the plugin; partial hot-reload of an entry module is out of scope.
- **Type checking of plugin entry modules at install time.** Plugins are `.mjs` files; their default export is validated to be an object, each value is checked to be a function, but their *signatures* are not parsed. Plugins are responsible for matching the `(YamlValue, HandlerContext) => Promise<YamlValue>` contract at runtime.
- **A registry of plugin marketplace entries.** Only locally-installed plugins are dispatched; the marketplace is a future pack.

## Out of Scope (Future)

- `browser-runtime` (Tier 4) — uses this dispatch path; can land when BI[8a] ships.
- A child-process loader for sandboxes — replaces the in-process `loadHandlers` impl with one that spawns the entry in a worker.
- A WebSocket loader for remote runtime hosts — analogous to BI[8b]'s `backend-runtime` but for plugins.

## References

- `docs/features/gateway-plugin-dispatch/GRILL-gateway-plugin-dispatch.txt` — locked decisions
- `docs/CONTEXT.md` — glossary (Runtime Plugin, Capability Manager, Plugin Manifest)
- `docs/architecture/Capability_System.md` — handler-by-type table (this pack closes the "runtime" row)
- `docs/architecture/Runtime_Capabilities.md` — Runtime Plugin lifecycle (Installed → Loaded → Initialized → Registers Capabilities → Running); this pack implements Loaded + Initialized
- `packages/plugin-manager/src/handler-loader.ts` — implementation of the loader (Phase 1 commit `162b4b2`)
- `packages/gateway-core/src/dispatch.ts:88-103` — the kernel wire (Phase 5; PRD documents the contract, not the swap)
- `docs/drift-issue-log.md` — D-29 (the original deferral that grilling replaced)

## Anti-Patterns Avoided

- No execution order in this doc. Phase order is in `IMPL-gateway-plugin-dispatch.md`.
- No restatement of CONTEXT.md definitions. Linked.
- No future enhancements as goals; they're listed in Out of Scope with explicit deferral reason.
