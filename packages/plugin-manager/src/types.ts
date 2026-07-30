/*
 * Code Map: plugin-manager public contracts
 * - PluginType: discriminator union (runtime / service / developer)
 * - PluginManifest: parsed YAML shape; one of three top-level type keys
 * - InstallRecord: durable state per installed plugin (persisted to disk)
 * - PluginError / PluginManagerError: structured error shape + class
 * - PluginManagerConfig / Clock / FileSystem / YamlParser: factory config + injectable seams
 * - Event payloads: seven plugin.* event contracts (one per event)
 * - PluginManager: public lifecycle API (9 methods)
 *
 * CID Index:
 * CID:types-001 -> PluginType
 * CID:types-002 -> PluginManifest
 * CID:types-003 -> InstallRecord
 * CID:types-004 -> PluginError
 * CID:types-005 -> PluginManagerConfig
 * CID:types-006 -> Clock
 * CID:types-007 -> FileSystem
 * CID:types-008 -> YamlParser
 * CID:types-009 -> PluginInstalledPayload
 * CID:types-010 -> PluginUpdatedPayload
 * CID:types-011 -> PluginReloadedPayload
 * CID:types-012 -> PluginUninstalledPayload
 * CID:types-013 -> PluginEnabledPayload
 * CID:types-014 -> PluginDisabledPayload
 * CID:types-015 -> PluginCleanupPayload
 * CID:types-016 -> PluginManager
 *
 * Quick lookup: rg -n "CID:types-" packages/plugin-manager/src/types.ts
 */

import type { EventBus } from "@platform/event-bus";
import type { CapabilityTier } from "@platform/capability-registry";

// CID:types-001 - PluginType
// Purpose: discriminator union — the top-level key in a manifest names the type
export type PluginType = "runtime" | "service" | "developer";

/**
 * One entry in a plugin manifest's `capabilities` list.
 * Either a plain string ("browser.navigate") or an object with explicit tier
 * ("browser.screenshot" has no convention, so author declares tier: read).
 */
export type ManifestCapability = string | { readonly name: string; readonly tier: CapabilityTier };

// CID:types-002 - PluginManifest
// Purpose: parsed YAML shape — exactly one of the three type keys per valid manifest
// Used by: parseManifest + validateManifest; InstallRecord.type derives from manifestType()
//
// BI[8a] gateway-plugin-dispatch: `runtime.entry` is the path to a Node ESM module
// loaded via dynamic import at install time. The module's default export is
// `{ [capabilityName]: async (input, ctx) => result }`. Optional — plugins without
// `entry` install cleanly but throw HANDLER_NOT_FOUND on invocation.
export interface PluginManifest {
  readonly runtime?: { readonly id: string; readonly entry?: string };
  readonly service?: { readonly id: string };
  readonly developer?: { readonly id: string };
  readonly version: string;
  readonly capabilities?: readonly ManifestCapability[];
  readonly metadata?: Readonly<Record<string, string>>;
}

// CID:types-003 - InstallRecord
// Purpose: durable state per installed plugin — persisted to ./data/installed-plugins.json
// Used by: InstallStore; returned from install/update/reload/disable/enable/get/list
export interface InstallRecord {
  readonly id: string;
  readonly type: PluginType;
  readonly version: string;
  readonly source: string;
  readonly installedAt: number;
  readonly enabled: boolean;
  readonly lastError?: PluginError & { readonly at: number };
}

// CID:types-004 - PluginError
// Purpose: structured error shape returned by every Plugin Manager operation
// Used by: PluginManagerError class; InstallRecord.lastError; callers match on .code
export interface PluginError {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, YamlValue>>;
}

// CID:types-005 - PluginManagerConfig
// Purpose: optional factory configuration — overrides defaults for path, timeout, clock, fs, yaml
export interface PluginManagerConfig {
  readonly installRecordPath?: string;
  readonly cleanupTimeoutMs?: number;
  readonly clock?: Clock;
  readonly fs?: FileSystem;
  readonly yaml?: YamlParser;
}

// CID:types-006 - Clock
// Purpose: minimal timer abstraction — injectable seam so tests can advance time deterministically
// Used by: InstallStore timestamps; uninstall cleanup-confirmation timeout (Phase 6)
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

// CID:types-007 - FileSystem
// Purpose: filesystem seam — production uses Node fs.promises; tests use in-memory Map
// writeFile is documented as atomic (write-temp-then-rename inside the implementation)
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// CID:types-008 - YamlParser
// Purpose: YAML parser seam — production wraps the `yaml` npm package; tests use a fake
export interface YamlParser {
  parse(source: string): YamlValue;
}

// CID:types-009 - PluginInstalledPayload
// Purpose: payload for plugin.installed event
export interface PluginInstalledPayload {
  readonly id: string;
  readonly type: PluginType;
  readonly version: string;
  readonly source: string;
  readonly installedAt: number;
}

// CID:types-010 - PluginUpdatedPayload
// Purpose: payload for plugin.updated event — carries old+new version
export interface PluginUpdatedPayload {
  readonly id: string;
  readonly oldVersion: string;
  readonly newVersion: string;
  readonly source: string;
  readonly updatedAt: number;
}

// CID:types-011 - PluginReloadedPayload
// Purpose: payload for plugin.reloaded event
export interface PluginReloadedPayload {
  readonly id: string;
  readonly version: string;
  readonly reloadedAt: number;
}

// CID:types-012 - PluginUninstalledPayload
// Purpose: payload for plugin.uninstalled event
export interface PluginUninstalledPayload {
  readonly id: string;
  readonly uninstalledAt: number;
}

// CID:types-013 - PluginEnabledPayload
// Purpose: payload for plugin.enabled event
export interface PluginEnabledPayload {
  readonly id: string;
  readonly enabledAt: number;
}

// CID:types-014 - PluginDisabledPayload
// Purpose: payload for plugin.disabled event
export interface PluginDisabledPayload {
  readonly id: string;
  readonly disabledAt: number;
}

// CID:types-015 - PluginCleanupPayload
// Purpose: payload for plugin.cleanup event — fires before plugin.uninstalled
export interface PluginCleanupPayload {
  readonly id: string;
}

// CID:types-017 - PluginHandlerLoadedPayload (BI[8a] gateway-plugin-dispatch)
// Purpose: payload for plugin.handler.loaded event. Emitted on install/reload
//   after the entry module is dynamic-imported. ok=true means the handler map
//   was successfully populated; ok=false means the import or shape check
//   failed and the install record's lastError field carries the error.
export interface PluginHandlerLoadedPayload {
  readonly id: string;
  readonly version: string;
  readonly loadedAt: number;
  readonly ok: boolean;
  readonly error?: string;
}

// CID:types-018 - PluginHandlerErrorPayload (BI[8a] gateway-plugin-dispatch)
// Purpose: payload for plugin.handler.error event. Emitted when a plugin's
//   handler throws during invocation. The caller already received a structured
//   PluginManagerError; this event is for ops tooling that tracks flaky handlers.
export interface PluginHandlerErrorPayload {
  readonly id: string;
  readonly capability: string;
  readonly at: number;
  readonly error: string;
}

// CID:types-016 - PluginManager
// Purpose: public lifecycle API — 9 methods (install, installFromRegistry, update, reload, disable, enable, uninstall, list, get)
// Used by: every consumer; sole entry point is createPluginManager
//
// BI[8a] gateway-plugin-dispatch: adds handleInvocation() so gateway-core can
// dispatch `owner.startsWith("plugin:")` invocations to the plugin's handler map.
// Throws HANDLER_NOT_FOUND if the plugin has no entry field, the entry failed to
// load, or the capability name isn't in the handler map. Throws PLUGIN_DISABLED
// if the plugin is currently disabled. Returns the handler's return value (any
// JSON-serializable shape).
export interface PluginManager {
  install(source: string): Promise<InstallRecord>;
  installFromRegistry(id: string): Promise<InstallRecord>;
  update(id: string, source: string): Promise<InstallRecord>;
  reload(id: string): Promise<InstallRecord>;
  disable(id: string): Promise<InstallRecord>;
  enable(id: string): Promise<InstallRecord>;
  uninstall(id: string): Promise<void>;
  /**
   * BI[8a] gateway-plugin-dispatch. Invoke a runtime plugin's handler by capability
   * name. The plugin must have a `runtime.entry` in its manifest; the entry is
   * loaded via dynamic import at install time. Throws HANDLER_NOT_FOUND or
   * PLUGIN_DISABLED on lookup failure; throws HANDLER_ERROR if the handler
   * itself throws.
   *
   * @param name Capability name (e.g. "browser.navigate"). Must match a key
   *   in the plugin's handler map.
   * @param input The CapabilityInvocation input. Passed through to the handler.
   * @param sessionId Optional session id from the caller's CanonicalInvocation.
   *   Forwarded to the handler's context argument.
   */
  handleInvocation(
    name: string,
    input: YamlValue,
    sessionId: string | undefined,
  ): Promise<YamlValue>;
  list(): readonly InstallRecord[];
  get(id: string): InstallRecord | null;
}

export type PluginEventBus = EventBus;

/**
 * Recursive YAML value type — narrows away from `any`/`unknown` so the package
 * passes the project's banned-types check. Covers every value the `yaml` package
 * can produce: scalars, sequences, and mappings.
 */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue };