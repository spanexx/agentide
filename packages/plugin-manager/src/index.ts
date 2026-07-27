/*
 * Code Map: plugin-manager factory
 * - createPluginManager: composes the lifecycle context (store + events + clock + fs + yaml) and wires lifecycle methods
 *
 * CID Index:
 * CID:index-001 -> createPluginManager
 *
 * Quick lookup: rg -n "CID:index-" packages/plugin-manager/src/index.ts
 */

import type { CapabilityRegistry } from "@platform/capability-registry";
import type { EventBus } from "@platform/event-bus";
import { ERROR_CODES, PluginManagerError } from "./errors.js";
import { EventPublisher } from "./events.js";
import { nodeFileSystem } from "./fs.js";
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
import { InstallStore } from "./store.js";
import type {
  Clock,
  FileSystem,
  InstallRecord,
  PluginManager,
  PluginManagerConfig,
  YamlParser,
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
// Uses: EventBus, CapabilityRegistry, InstallStore, EventPublisher, lifecycle helpers
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

  await performStartupReinstall(ctx);

  return {
    install: (source: string) => install(ctx, source),
    installFromRegistry: async (_id: string): Promise<InstallRecord> => {
      throw new PluginManagerError(
        ERROR_CODES.MARKETPLACE_UNAVAILABLE,
        "public Plugin Marketplace is not available yet",
        {
          hint: "the marketplace pack has not shipped yet. use plugin.install --source <path> for local installs.",
        },
      );
    },
    update: (id: string, source: string) => update(ctx, id, source),
    reload: (id: string) => reload(ctx, id),
    disable: (id: string) => disable(ctx, id),
    enable: (id: string) => enable(ctx, id),
    uninstall: (id: string) => uninstall(ctx, id),
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