/*
 * Code Map: dispatch.test.ts — exercises translatePluginError
 * (BI[8a] Option B mapping) and the end-to-end dispatchCapability path
 * for plugin: owners.
 *
 * CID Index:
 * CID:dispatch-test-001 -> translatePluginError unit tests
 * CID:dispatch-test-002 -> dispatchCapability integration (plugin handler)
 *
 * Quick lookup: rg -n "CID:dispatch-test-" packages/gateway-core/src/__tests__/dispatch.test.ts
 */

import { describe, expect, it } from "vitest";
import { createEventBus, type EventBus } from "@platform/event-bus";
import { createCapabilityRegistry, type CapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager, type SessionManager } from "@platform/session-manager";
import {
  ERROR_CODES as PM_ERROR_CODES,
  PluginManagerError,
  type InstallRecord,
  type PluginManager,
  type YamlValue,
} from "@platform/plugin-manager";
import {
  ERROR_CODES,
  GatewayError,
  dispatchCapability,
  translatePluginError,
} from "../index.js";
import type { Clock } from "../types.js";

// Minimal PluginManager stub. Only the methods used by dispatchCapability
// (list + handleInvocation) need to do real work; the rest throw.
function makePluginManager(
  installed: readonly InstallRecord[],
  handleInvocation: (name: string) => Promise<YamlValue>,
): PluginManager {
  return {
    list: () => [...installed],
    get: (id: string) => installed.find((p) => p.id === id) ?? null,
    handleInvocation: handleInvocation as PluginManager["handleInvocation"],
    install: (async () => { throw new Error("not used"); }) as PluginManager["install"],
    installFromRegistry: (async () => { throw new Error("not used"); }) as PluginManager["installFromRegistry"],
    update: (async () => { throw new Error("not used"); }) as PluginManager["update"],
    reload: (async () => { throw new Error("not used"); }) as PluginManager["reload"],
    disable: (async () => { throw new Error("not used"); }) as PluginManager["disable"],
    enable: (async () => { throw new Error("not used"); }) as PluginManager["enable"],
    uninstall: (async () => { throw new Error("not used"); }) as PluginManager["uninstall"],
  };
}

class FixedClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, ms: number): number { return setTimeout(cb, ms) as unknown as number; }
  clearTimeout(h: number): void { clearTimeout(h); }
}

const installedBrowser: InstallRecord = {
  id: "browser",
  type: "runtime",
  version: "1.0.0",
  source: "/tmp/browser.yaml",
  installedAt: 1_700_000_000_000,
  enabled: true,
};

// =============================================================================
// CID:dispatch-test-001 - translatePluginError unit tests
// =============================================================================
describe("translatePluginError (BI[8a] Option B matrix)", () => {
  it("maps PLUGIN_HANDLER_NOT_FOUND to GATEWAY_HANDLER_NOT_FOUND", () => {
    const err = new PluginManagerError(
      PM_ERROR_CODES.HANDLER_NOT_FOUND,
      "no handler for browser.boom",
      { pluginId: "browser", capabilityName: "browser.boom" },
    );
    const translated = translatePluginError(err, "browser", "browser.boom");
    expect(translated).toBeInstanceOf(GatewayError);
    expect(translated.code).toBe(ERROR_CODES.HANDLER_NOT_FOUND);
    expect(translated.retryable).toBe(false);
    expect(translated.details).toMatchObject({
      pluginId: "browser",
      capability: "browser.boom",
      originalError: "no handler for browser.boom",
    });
  });

  it("maps PLUGIN_HANDLER_ERROR to GATEWAY_HANDLER_ERROR", () => {
    const err = new PluginManagerError(
      PM_ERROR_CODES.HANDLER_ERROR,
      "handler exploded",
      { pluginId: "browser", capabilityName: "browser.boom" },
    );
    const translated = translatePluginError(err, "browser", "browser.boom");
    expect(translated).toBeInstanceOf(GatewayError);
    expect(translated.code).toBe(ERROR_CODES.HANDLER_ERROR);
    expect(translated.retryable).toBe(false);
    expect(translated.details).toMatchObject({
      pluginId: "browser",
      capability: "browser.boom",
      originalError: "handler exploded",
    });
  });

  it("maps an unrelated PM code to GATEWAY_INTERNAL_ERROR and preserves pluginErrorCode", () => {
    const err = new PluginManagerError(
      PM_ERROR_CODES.MARKETPLACE_UNAVAILABLE,
      "marketplace timed out",
      { pluginId: "browser" },
    );
    const translated = translatePluginError(err, "browser", "browser.click");
    expect(translated.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(translated.retryable).toBe(false);
    expect(translated.details).toMatchObject({
      pluginId: "browser",
      capability: "browser.click",
      pluginErrorCode: PM_ERROR_CODES.MARKETPLACE_UNAVAILABLE,
    });
  });

  it("wraps a non-PluginManagerError as GATEWAY_INTERNAL_ERROR", () => {
    const translated = translatePluginError(
      new Error("kernel panic"),
      "browser",
      "browser.click",
    );
    expect(translated.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(translated.details).toMatchObject({
      pluginId: "browser",
      capability: "browser.click",
    });
  });
});

// =============================================================================
// CID:dispatch-test-002 - dispatchCapability integration (plugin handler)
// Exercises the full owner=plugin:* path end-to-end through dispatch.ts,
// asserting that the PM's PluginManagerError is translated to the right
// kernel code by the time it surfaces to the gateway caller.
// =============================================================================
describe("dispatchCapability for plugin:<id> owners", () => {
  function makeCtx(
    pm: PluginManager,
    registry: CapabilityRegistry,
  ): Parameters<typeof dispatchCapability>[3] {
    const bus: EventBus = createEventBus();
    // SessionManager is a stub; dispatch doesn't use it for plugin: owners.
    const _sm: SessionManager = createSessionManager(bus);
    void _sm;
    return {
      registry,
      sessionManager: {} as SessionManager,
      pluginManager: pm,
      handlers: { gatewayHandlers: {} },
      clock: new FixedClock(),
      handlerTimeoutMs: 5_000,
    };
  }

  it("returns the handler's output when PM resolves successfully", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("plugin:browser", {
      owner: "plugin:browser",
      capabilities: [{
        name: "browser.navigate",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "navigate the browser",
        permissions: ["browser.read"],
        owner: "plugin:browser",
      }],
    });
    const pm = makePluginManager([installedBrowser], async (name) => {
      expect(name).toBe("browser.navigate");
      return { navigated: true, url: "https://example.com" };
    });
    const cap = registry.describe("browser.navigate").capability;
    expect(cap).not.toBeNull();
    const ctx = makeCtx(pm, registry);
    const out = await dispatchCapability(cap!, { url: "https://example.com" }, undefined, ctx);
    expect(out).toEqual({ navigated: true, url: "https://example.com" });
  });

  it("throws GATEWAY_HANDLER_NOT_FOUND when PM throws PLUGIN_HANDLER_NOT_FOUND", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("plugin:browser", {
      owner: "plugin:browser",
      capabilities: [{
        name: "browser.boom",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "not in handler map",
        permissions: ["browser.read"],
        owner: "plugin:browser",
      }],
    });
    const pm = makePluginManager([installedBrowser], async (name) => {
      throw new PluginManagerError(PM_ERROR_CODES.HANDLER_NOT_FOUND, `no handler for ${name}`, { capabilityName: name });
    });
    const cap = registry.describe("browser.boom").capability;
    expect(cap).not.toBeNull();
    const ctx = makeCtx(pm, registry);
    await expect(
      dispatchCapability(cap!, {}, undefined, ctx),
    ).rejects.toMatchObject({
      code: ERROR_CODES.HANDLER_NOT_FOUND,
      details: { pluginId: "browser", capability: "browser.boom" },
    });
  });

  it("throws GATEWAY_HANDLER_ERROR when PM throws PLUGIN_HANDLER_ERROR", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("plugin:browser", {
      owner: "plugin:browser",
      capabilities: [{
        name: "browser.boom",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "throws",
        permissions: ["browser.read"],
        owner: "plugin:browser",
      }],
    });
    const pm = makePluginManager([installedBrowser], async () => {
      throw new PluginManagerError(PM_ERROR_CODES.HANDLER_ERROR, "handler exploded", {});
    });
    const cap = registry.describe("browser.boom").capability;
    expect(cap).not.toBeNull();
    const ctx = makeCtx(pm, registry);
    await expect(
      dispatchCapability(cap!, {}, undefined, ctx),
    ).rejects.toMatchObject({
      code: ERROR_CODES.HANDLER_ERROR,
      details: { pluginId: "browser", capability: "browser.boom", originalError: "handler exploded" },
    });
  });

  it("throws GATEWAY_PLUGIN_NOT_INSTALLED before calling PM when the plugin is missing", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("plugin:ghost", {
      owner: "plugin:ghost",
      capabilities: [{
        name: "ghost.act",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "no plugin",
        permissions: ["ghost.read"],
        owner: "plugin:ghost",
      }],
    });
    // PM exists but the plugin is not in the install list.
    let called = false;
    const pm = makePluginManager([installedBrowser], async () => { called = true; return {}; });
    const cap = registry.describe("ghost.act").capability;
    expect(cap).not.toBeNull();
    const ctx = makeCtx(pm, registry);
    await expect(
      dispatchCapability(cap!, {}, undefined, ctx),
    ).rejects.toMatchObject({ code: ERROR_CODES.PLUGIN_NOT_INSTALLED });
    expect(called).toBe(false);
  });
});
