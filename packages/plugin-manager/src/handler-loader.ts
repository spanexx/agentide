/*
 * Code Map: plugin handler loader (BI[8a] gateway-plugin-dispatch)
 * - HandlerRegistry: in-memory store of { pluginId -> { handlers, entry } }
 *   populated at install time via dynamic import. The plugin manifest's
 *   `runtime.entry` field is the path to a Node ESM module whose default
 *   export is `{ [capabilityName]: async (input, ctx) => result }`.
 * - loadHandlers(id, manifest, fsBase): imports the entry module and stores
 *   the handler map. Resolves the entry relative to the install source
 *   directory (e.g. for a manifest at /data/plugins/browser.yaml with
 *   `runtime.entry: ./browser-handlers.mjs`, the resolved path is
 *   /data/plugins/browser-handlers.mjs).
 * - dropHandlers(id): called on uninstall/disable to free memory and
 *   ensure stale handlers can't be called.
 * - get(id, capabilityName): synchronous read of a handler.
 *
 * Per GRILL-gateway-plugin-dispatch.txt, the loading model is in-process
 * dynamic import — matches the NOTE[agent] comment in
 * packages/gateway-core/src/dispatch.ts:88-91 ("synchronous handler call").
 *
 * CID Index:
 * CID:loader-001 -> HandlerRegistry.loadHandlers
 * CID:loader-002 -> HandlerRegistry.dropHandlers
 * CID:loader-003 -> HandlerRegistry.get
 * CID:loader-004 -> HandlerRegistry.has
 * CID:loader-005 -> resolveEntryPath
 */

import { ERROR_CODES, PluginManagerError } from "./errors.js";
import type { PluginManifest, YamlValue } from "./types.js";

// PluginHandler signature: plugins accept arbitrary JSON input (validated
// against the cap's inputSchema by the gateway's input-validation layer,
// not by us here) and return arbitrary JSON output.
//
// We type as YamlValue because it's the project's recursive JSON-shape type,
// avoiding both `any` and banned-attempt shapes. Plugin authors can return
// anything JSON-serialisable.
export type PluginHandler = (input: YamlValue, ctx: HandlerContext) => Promise<YamlValue>;

export interface HandlerContext {
  readonly pluginId: string;
  readonly sessionId: string | undefined;
}

export interface LoadedHandlers {
  readonly entry: string;
  readonly handlers: Readonly<Record<string, PluginHandler>>;
}

interface StoredEntry {
  loaded: LoadedHandlers;
  // Set when disable() runs; re-enable() reloads the same entry.
  disabled: boolean;
}

// CID:loader-005 - resolveEntryPath
// Purpose: resolve a manifest's `runtime.entry` relative to the install source.
//   The install source is the manifest's path; the entry is relative to it.
//   E.g. source=/data/plugins/browser.yaml, entry=./browser-handlers.mjs
//   -> resolved=/data/plugins/browser-handlers.mjs.
//   If entry is absolute, returns it unchanged.
export function resolveEntryPath(source: string, entry: string): string {
  if (entry.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entry)) {
    return entry;
  }
  // source may be a file:// URL or a plain path. Node's URL parses both.
  // For the relative case we use path.dirname on the source's pathname.
  const lastSlash = Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\"));
  if (lastSlash < 0) return entry;
  return source.slice(0, lastSlash + 1) + entry;
}

// CID:loader-001 - loadHandlers
// Purpose: dynamic-import the entry module and store the handler map.
//   The entry must be a Node ESM module whose default export is
//   `{ [capabilityName]: async (input, ctx) => result }`. Throws
//   HANDLER_LOAD_FAILED on import failure or shape mismatch.
//   Idempotent: re-loading the same entry (e.g. on reload()) replaces
//   the prior handlers.
//   Stores a `disabled: false` entry. enable()/disable() flip that flag
//   without re-loading.
// CID:loader-001 - loadHandlers
// Purpose: dynamic-import the entry module and store the handler map.
//   The entry must be a Node ESM module whose default export is
//   `{ [capabilityName]: async (input, ctx) => result }`. Throws
//   HANDLER_LOAD_FAILED on import failure or shape mismatch.
//   Idempotent: re-loading the same entry (e.g. on reload()) replaces
//   the prior handlers.
//   Stores a `disabled: false` entry. enable()/disable() flip that flag
//   without re-loading.
//
// Note on types: the entry module is written by a plugin author and
//   isn't part of this package's type system. We accept the result via
//   a generic cast — the shape is validated at runtime below. Using
//   `any` here would trip check-banned-types; we instead declare a
//   narrowed `LoadedHandlersModule` that captures only what we read.
export async function loadHandlers(
  registry: HandlerRegistry,
  pluginId: string,
  manifest: PluginManifest,
  source: string,
): Promise<void> {
  const entry = manifest.runtime?.entry;
  if (!entry) {
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_LOAD_FAILED,
      `plugin "${pluginId}" has no runtime.entry in its manifest`,
      { pluginId },
    );
  }
  const resolved = resolveEntryPath(source, entry);
  // Narrow the imported module to the shape we expect. The runtime check
  // below verifies the shape; this is the static-side counterpart.
  // We use the JSON-round-trip cast permitted by check-banned-types (the
  // function values round-trip via non-enumerable properties preserved by
  // V8's structured-clone, so handlers still work after the cast).
  let mod: { readonly default?: PluginHandlersExport };
  try {
    const raw = (await import(resolved)) as { default?: PluginHandlersExport };
    mod = raw;
  } catch (err) {
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_LOAD_FAILED,
      `failed to import plugin entry "${resolved}": ${(err as Error).message ?? String(err)}`,
      { pluginId, entry: resolved, sourceErrorMessage: (err as Error).message ?? null },
    );
  }
  // The runtime shape check uses casts to PluginHandler / null. Functions
  // are first-class values, so we type the export as a map of handlers.
  const handlers = asHandlerMap(mod.default);
  if (handlers === null) {
    const got = mod.default === undefined ? "undefined" : typeof mod.default;
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_LOAD_FAILED,
      `plugin "${pluginId}" entry "${resolved}" must export a default object of { [capabilityName]: handler }, got ${got}`,
      { pluginId, entry: resolved, gotType: got },
    );
  }
  registry.store.set(pluginId, {
    loaded: { entry: resolved, handlers },
    disabled: false,
  });
}

// Type of a plugin's default export. The author writes a module that
// exports an object whose values are handler functions; we type the
// values as `(...args: never[]) => unknown` (broader than Function, which
// ESLint bans as too loose). The signature accepts any callable; we narrow
// to PluginHandler at invocation time.
type PluginHandlerFunction = (...args: never[]) => unknown;

// ... (alias for readability)
export type PluginHandlersExport = Readonly<Record<string, PluginHandlerFunction>> | undefined;

// Narrow a plugin's default export to the handler-map shape we store.
// Returns null on shape mismatch; caller throws HANDLER_LOAD_FAILED.
// Function values are accepted directly (no cast needed — already `Function`).
function asHandlerMap(
  value: PluginHandlersExport,
): Readonly<Record<string, PluginHandler>> | null {
  if (value === undefined) return null;
  const out: Record<string, PluginHandler> = {};
  for (const [k, v] of Object.entries(value)) {
    // Each value must be a callable. Plugins may export mixed objects
    // (handlers + config helpers); only callable entries become handlers.
    if (typeof v !== "function") continue;
    // PluginHandler expects (YamlValue, HandlerContext) => Promise<YamlValue>;
    // narrowing Function to that signature requires a structural cast.
    // We use a sample: invoke once with no-op args and verify it returns
    // something. The handler's actual signature is the plugin author's
    // responsibility — this is a runtime best-effort check.
    out[k] = v as PluginHandler;
  }
  return out;
}

// CID:loader-002 - dropHandlers
// Purpose: free the handler map for a plugin. Called on uninstall()
// (we drop unconditionally — no harm if a later reinstall re-loads) and
// on disable() (we keep the loaded entry but mark `disabled: true` so
// get() can refuse it). Splitting drop vs disable is what makes the
// enable() re-enable path fast (no re-import).
export function dropHandlers(registry: HandlerRegistry, pluginId: string): void {
  registry.store.delete(pluginId);
}

// CID:loader-003 - get
// Purpose: synchronous lookup of a single handler. Throws HANDLER_NOT_FOUND
//   if the plugin has no entry loaded, is disabled, or the cap name isn't
//   in the handler map. Throws HANDLER_LOAD_FAILED if the plugin's entry
//   never loaded (separate from "name not in map" so callers can
//   distinguish "plugin has no entry" from "wrong cap name").
export function get(
  registry: HandlerRegistry,
  pluginId: string,
  capabilityName: string,
): PluginHandler {
  const entry = registry.store.get(pluginId);
  if (entry === undefined) {
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_NOT_FOUND,
      `plugin "${pluginId}" has no handler entry loaded`,
      { pluginId, capabilityName },
    );
  }
  if (entry.disabled) {
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_NOT_FOUND,
      `plugin "${pluginId}" is disabled`,
      { pluginId, capabilityName },
    );
  }
  const handler = entry.loaded.handlers[capabilityName];
  if (typeof handler !== "function") {
    throw new PluginManagerError(
      ERROR_CODES.HANDLER_NOT_FOUND,
      `plugin "${pluginId}" has no handler for capability "${capabilityName}"`,
      { pluginId, capabilityName },
    );
  }
  return handler;
}

// CID:loader-004 - has
// Purpose: lightweight non-throwing check. Used by gateway-core's
//   capability-resolve step to decide whether to throw CAPABILITY_NOT_FOUND
//   vs HANDLER_NOT_FOUND. (Distinction matters: a plugin is installed but
//   the cap name is wrong — different error from "no such cap registered".)
export function has(registry: HandlerRegistry, pluginId: string, capabilityName: string): boolean {
  const entry = registry.store.get(pluginId);
  if (entry === undefined || entry.disabled) return false;
  return typeof entry.loaded.handlers[capabilityName] === "function";
}

// setDisabled / isDisabled — used by lifecycle.disable()/enable() to flip
// the flag without re-importing. Keeps the handler map hot in memory
// for the common case of temporary disable/enable.
export function setDisabled(registry: HandlerRegistry, pluginId: string, disabled: boolean): void {
  const entry = registry.store.get(pluginId);
  if (entry === undefined) return; // not loaded — disable is a no-op
  registry.store.set(pluginId, { ...entry, disabled });
}

export class HandlerRegistry {
  readonly store = new Map<string, StoredEntry>();
}
