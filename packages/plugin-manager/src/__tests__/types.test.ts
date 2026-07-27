import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  PluginManagerError,
  type InstallRecord,
  type PluginInstalledPayload,
  type PluginManifest,
  type PluginManager,
  type PluginManagerConfig,
  type PluginType,
} from "../index.js";

describe("plugin-manager types", () => {
  it("exports ERROR_CODES with all 16 stable strings", () => {
    expect(ERROR_CODES.SOURCE_NOT_FOUND).toBe("PLUGIN_SOURCE_NOT_FOUND");
    expect(ERROR_CODES.SOURCE_UNREADABLE).toBe("PLUGIN_SOURCE_UNREADABLE");
    expect(ERROR_CODES.MANIFEST_INVALID).toBe("PLUGIN_MANIFEST_INVALID");
    expect(ERROR_CODES.TYPE_MISSING).toBe("PLUGIN_TYPE_MISSING");
    expect(ERROR_CODES.TYPE_AMBIGUOUS).toBe("PLUGIN_TYPE_AMBIGUOUS");
    expect(ERROR_CODES.ID_MISSING).toBe("PLUGIN_ID_MISSING");
    expect(ERROR_CODES.VERSION_MISSING).toBe("PLUGIN_VERSION_MISSING");
    expect(ERROR_CODES.ID_ALREADY_INSTALLED).toBe("PLUGIN_ID_ALREADY_INSTALLED");
    expect(ERROR_CODES.CAPABILITY_NAME_INVALID).toBe("PLUGIN_CAPABILITY_NAME_INVALID");
    expect(ERROR_CODES.CAPABILITY_COLLISION).toBe("PLUGIN_CAPABILITY_COLLISION");
    expect(ERROR_CODES.NOT_INSTALLED).toBe("PLUGIN_NOT_INSTALLED");
    expect(ERROR_CODES.SOURCE_CHANGED).toBe("PLUGIN_SOURCE_CHANGED");
    expect(ERROR_CODES.ALREADY_DISABLED).toBe("PLUGIN_ALREADY_DISABLED");
    expect(ERROR_CODES.ALREADY_ENABLED).toBe("PLUGIN_ALREADY_ENABLED");
    expect(ERROR_CODES.CLEANUP_TIMEOUT).toBe("PLUGIN_CLEANUP_TIMEOUT");
    expect(ERROR_CODES.MARKETPLACE_UNAVAILABLE).toBe("PLUGIN_MARKETPLACE_UNAVAILABLE");
  });

  it("exposes PluginManagerError with code, message, details", () => {
    const err = new PluginManagerError("PLUGIN_NOT_INSTALLED", "missing", { id: "x" });
    expect(err.code).toBe("PLUGIN_NOT_INSTALLED");
    expect(err.message).toBe("missing");
    expect(err.details).toEqual({ id: "x" });
    expect(err.name).toBe("PluginManagerError");
    expect(err).toBeInstanceOf(Error);
  });

  it("types are assignable in their declared shapes", () => {
    const type: PluginType = "runtime";
    const manifest: PluginManifest = { runtime: { id: "browser" }, version: "1.0" };
    const record: InstallRecord = {
      id: "browser",
      type: "runtime",
      version: "1.0",
      source: "./browser.yaml",
      installedAt: 0,
      enabled: true,
    };
    const payload: PluginInstalledPayload = {
      id: "browser",
      type: "runtime",
      version: "1.0",
      source: "./browser.yaml",
      installedAt: 0,
    };
    const config: PluginManagerConfig = {};
    const api: PluginManager = {
      install: async () => record,
      installFromRegistry: async () => record,
      update: async () => record,
      reload: async () => record,
      disable: async () => record,
      enable: async () => record,
      uninstall: async () => undefined,
      list: () => [record],
      get: () => record,
    };
    expect(type).toBe("runtime");
    expect(manifest.runtime?.id).toBe("browser");
    expect(record.id).toBe("browser");
    expect(payload.source).toBe("./browser.yaml");
    expect(config).toEqual({});
    expect(typeof api.install).toBe("function");
  });
});