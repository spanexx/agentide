/*
 * Code Map: plugin-manager factory
 * - createPluginManager: composes the lifecycle context (store + events + clock + fs + yaml + handler-registry) and wires lifecycle methods
 *
 * CID Index:
 * CID:index-001 -> createPluginManager
 *
 * Quick lookup: rg -n "CID:index-" packages/plugin-manager/src/index.ts
 */

import type { CapabilityRegistry } from "@spanexx/capability-registry";
import type { EventBus } from "@spanexx/event-bus";
import { ERROR_CODES, PluginManagerError } from "./errors.js";
import { EventPublisher } from "./events.js";
import { nodeFileSystem } from "./fs.js";
import { HandlerRegistry, get as getHandler, type PluginHandler } from "./handler-loader.js";
import {
  disable,
  enable,
  install,
  performStartupReinstall,
  reload,
  uninstall,
  update,
} from "./lifecycle.js";
import type { PluginManagerContext } from "./lifecycle-helpers.js";
import { parseManifest } from "./manifest.js";
import { InstallStore } from "./store.js";
import type {
  Clock,
  FileSystem,
  InstallRecord,
  PluginManager,
  PluginManagerConfig,
  PluginManifest,
  YamlParser,
  YamlValue,
} from "./types.js";
import { nodeYamlParser } from "./yaml.js";

const DEFAULT_INSTALL_RECORD_PATH = "./data/installed-plugins.json";

const systemClock: Clock = {
  now: () => Date.now(),
  // @ts-expect-error - Node's setTimeout returns Timeout; Clock interface declares number
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

// CID:index-001 - createPluginManager
// Purpose: factory — composes the lifecycle context and wires 8 lifecycle methods (installFromRegistry is a stub); performs startup re-install from persisted records
// Uses: EventBus, CapabilityRegistry, InstallStore, EventPublisher, lifecycle helpers, HandlerRegistry (BI[8a)
// Used by: every consumer of the plugin lifecycle API; sole entry point
export async function createPluginManager(
  eventBus: EventBus,
  capabilityRegistry: CapabilityRegistry,
  config: PluginManagerConfig = {},
): Promise<PluginManager> {
  const fs: FileSystem = config.fs ?? nodeFileSystem;
  const yaml: YamlParser = config.yaml ?? nodeYamlParser;
  const clock: Clock = config.clock ?? systemClock;
  const installRecordPath = config.installRecordPath ?? DEFAULT_INSTALL_RECORD_PATH;
  const cleanupTimeoutMs = config.cleanupTimeoutMs ?? 5000;
  const store = new InstallStore(installRecordPath, fs);
  const events = new EventPublisher(eventBus);
  const handlerRegistry = new HandlerRegistry();

  // Track source paths per plugin so the handler loader can resolve
  // `runtime.entry` relative to the manifest location. The store
  // already persists `source`; this Map is in-memory only.
  const sourceById = new Map<string, string>();
  // Cache the last-parsed manifest so handler loading doesn't have to
  // re-read+re-parse the source on every install/reload.
  const manifestById = new Map<string, PluginManifest>();

  const ctx: PluginManagerContext = {
    store,
    events,
    eventBus,
    capabilityRegistry,
    fs,
    yaml,
    clock,
    cleanupTimeoutMs,
  };

  // Local helper — read+parse a manifest, throws on shape mismatch.
  async function readManifest(source: string): Promise<PluginManifest> {
    const content = await fs.readFile(source);
    return parseManifest(content, yaml);
  }

  // Local helper — load handlers for a plugin IF the manifest has an entry.
  // Failure is non-fatal at install time (operator can `plugin.reload` to
  // fix). On a permanent failure the install record gets a `lastError`
  // via the lifecycle's standard path; we add a separate handler-load
  // error so the audit shows both the install outcome and the load outcome.
  async function tryLoadHandlers(id: string, manifest: PluginManifest, source: string): Promise<void> {
    if (!manifest.runtime?.entry) return;
    try {
      const loader = await import("./handler-loader.js");
      await loader.loadHandlers(handlerRegistry, id, manifest, source);
    } catch (err) {
      // Coerce to Error — `import()` rejections are always Error subclasses,
      // but the catch type is the broader `unknown`. Wrap defensively.
      const e = err instanceof Error ? err : new Error(String(err));
      events.handlerLoadFailed(store.get(id), e);
    }
  }

  await performStartupReinstall(ctx);
  // After startup reinstall, load handlers for every plugin that has an entry.
  // We re-read each manifest from its source (cheap with in-memory fs)
  // and populate the loader. Re-install already registered capabilities
  // in the Capability Registry; we just need to wire the handlers.
  for (const record of store.list()) {
    sourceById.set(record.id, record.source);
    try {
      const manifest = await readManifest(record.source);
      manifestById.set(record.id, manifest);
      await tryLoadHandlers(record.id, manifest, record.source);
    } catch {
      // Install record already has a lastError from performStartupReinstall;
      // nothing more to record here. Skip handler loading for this plugin.
    }
  }

  return {
    install: async (source: string): Promise<InstallRecord> => {
      const record = await install(ctx, source);
      sourceById.set(record.id, source);
      try {
        const manifest = await readManifest(source);
        manifestById.set(record.id, manifest);
        await tryLoadHandlers(record.id, manifest, source);
      } catch (err) {
        // If the post-install hook fails (e.g. install record's lastError
        // was set, or handler load failed), re-throw so the caller sees it.
        // Install-time errors should be loud; success is silent.
        throw err;
      }
      return record;
    },
    installFromRegistry: async (id: string): Promise<InstallRecord> => {
      void id; // parameter kept for API contract; unused until marketplace pack ships
      throw new PluginManagerError(
        ERROR_CODES.MARKETPLACE_UNAVAILABLE,
        "public Plugin Marketplace is not available yet",
        {
          hint: "the marketplace pack has not shipped yet. use plugin.install --source <path> for local installs.",
        },
      );
    },
    update: (id: string, source: string) => update(ctx, id, source),
    reload: async (id: string): Promise<InstallRecord> => {
      const record = await reload(ctx, id);
      const source = sourceById.get(id) ?? record.source;
      sourceById.set(id, source);
      try {
        const manifest = await readManifest(source);
        manifestById.set(id, manifest);
        await tryLoadHandlers(id, manifest, source);
      } catch {
        // If re-read fails, keep the prior cached manifest if any.
      }
      return record;
    },
    disable: async (id: string) => {
      const r = disable(ctx, id);
      // Mark handlers disabled but keep them in memory so re-enable is fast.
      const loader = await import("./handler-loader.js");
      loader.setDisabled(handlerRegistry, id, true);
      return r;
    },
    enable: async (id: string) => {
      const r = enable(ctx, id);
      const loader = await import("./handler-loader.js");
      loader.setDisabled(handlerRegistry, id, false);
      return r;
    },
    uninstall: (id: string) => {
      const r = uninstall(ctx, id);
      void import("./handler-loader.js").then((m) =>
        m.dropHandlers(handlerRegistry, id),
      );
      sourceById.delete(id);
      manifestById.delete(id);
      return r;
    },
    handleInvocation: async (
      name: string,
      input: YamlValue,
      sessionId: string | undefined,
    ): Promise<YamlValue> => {
      // The capability's owner is `plugin:<id>`. Look up the capability
      // in the registry to find the owning plugin. (Multiple plugins
      // can't share a cap name — collision check at install time prevents it.)
      const desc = capabilityRegistry.describe(name);
      if (desc.capability === null) {
        throw new PluginManagerError(
          ERROR_CODES.HANDLER_NOT_FOUND,
          `no capability "${name}" registered with any plugin`,
          { capabilityName: name },
        );
      }
      const owner = desc.capability.owner;
      if (!owner.startsWith("plugin:")) {
        throw new PluginManagerError(
          ERROR_CODES.HANDLER_NOT_FOUND,
          `capability "${name}" is owned by "${owner}", not a plugin`,
          { capabilityName: name, owner },
        );
      }
      const pluginId = owner.slice("plugin:".length);
      // get() throws with the right error code + details if anything is off
      // (no entry loaded, plugin disabled, or cap not in handler map).
      const handler: PluginHandler = getHandler(handlerRegistry, pluginId, name);
      try {
        const result = await handler(input, { pluginId, sessionId });
        return result;
      } catch (err) {
        // Handler threw — translate to HANDLER_ERROR. Don't leak the
        // handler's internal error.message verbatim (could expose plugin
        // internals). Audit + re-throw as structured error.
        const e = err instanceof Error ? err : new Error(String(err));
        events.handlerInvokeFailed(store.get(pluginId), name, e);
        // AUDIT F10 (browser-runtime, user-approved 2026-08-02): additive
        // envelope extension — when the handler throws an Error carrying a
        // structured code + retryable flag (e.g. browser-runtime's
        // BROWSER_* codes), preserve them in details so callers can match
        // on originalErrorCode and honor retryable. Backward compatible:
        // plain Errors get no new keys.
        const structured = err as { code?: string; retryable?: boolean };
        const details: Record<string, YamlValue> = {
          pluginId,
          capabilityName: name,
          originalError: e.message ?? null,
        };
        if (typeof structured.code === "string") {
          details.originalErrorCode = structured.code;
        }
        if (typeof structured.retryable === "boolean") {
          details.retryable = structured.retryable;
        }
        throw new PluginManagerError(
          ERROR_CODES.HANDLER_ERROR,
          `plugin "${pluginId}" handler for "${name}" threw: ${e.message ?? "unknown"}`,
          details,
        );
      }
    },
    list: () => store.list(),
    get: (id: string) => store.get(id),
  };
}

// Re-exports
export * from "./types.js";
export * from "./errors.js";
export * from "./manifest.js";
export * from "./store.js";
export * from "./events.js";
export * from "./fs.js";
export * from "./yaml.js";
export * from "./lifecycle.js";
export * from "./tier-convention.js";
export * from "./handler-loader.js";