/*
 * Code Map: tests for the 9 new platform-cap handlers (BI[6])
 * - plugin.*: 6 handlers wrapping Plugin Manager methods
 * - system.*: 3 kernel-direct read handlers
 */

import { describe, it, expect } from "vitest";
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager } from "@platform/session-manager";
import { createPluginManager } from "@platform/plugin-manager";
import { createGateway } from "../factory.js";
import { issueToken } from "../auth.js";
import type { Clock, FileSystem } from "../types.js";

const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  // @ts-expect-error - Node's setTimeout returns Timeout; Clock interface declares number
  setTimeout: (cb: () => void, ms: number) => number = (cb, ms) => setTimeout(cb, ms);
  clearTimeout: (h: number) => void = (h) => clearTimeout(h);
}

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    this.files.set(path, content);
    void mode;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

async function setup() {
  const eventBus = createEventBus();
  const registry = createCapabilityRegistry(eventBus);
  const sessionManager = createSessionManager(eventBus);
  const fs = new InMemoryFs();
  // Pre-seed the gateway-secret so the factory loads the same TEST_SECRET.
  fs.files.set("/tmp/secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const pluginManager = await createPluginManager(eventBus, registry, {
    fs,
    installRecordPath: "/tmp/plugins.json",
    clock,
  });
  const gateway = await createGateway(eventBus, registry, sessionManager, pluginManager, {
    fs,
    auditLogPath: "/tmp/audit.log",
    tenantsPath: "/tmp/tenants.json",
    secretPath: "/tmp/secret",
    rateLimit: { capacity: 1000, tokensPerSecond: 1000 },
    clock,
  });
  // Auto-seed the "default" tenant (matches the makeToken's tenantId).
  await gateway.createTenant({ id: "default", name: "Default Test Tenant" });
  return { gateway, clock, sessionManager, fs };
}

function makeToken(clock: FakeClock, scope: readonly string[]): string {
  return issueToken(
    {
      sub: { tenantId: "default", callerId: "test" },
      scope: [...scope],
      iat: clock.now(),
      exp: clock.now() + 3_600_000,
    },
    TEST_SECRET,
    clock,
  );
}

describe("plugin.* handlers", () => {
  it("plugin.list returns the current pluginManager list", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.read"] },
      capability: { name: "plugin.list" },
      input: {},
    });
    expect("output" in result).toBe(true);
    if ("output" in result) {
      expect(Array.isArray(result.output)).toBe(true);
    }
  });

  it("plugin.install rejects missing source", async () => {
    const { gateway, clock, sessionManager } = await setup();
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.install" },
      input: {},
      sessionId: session.id,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("GATEWAY_INVALID_REQUEST");
    }
  });

  it("plugin.install happy path: end-to-end returns InstallRecord (AC-3)", async () => {
    const { gateway, clock, sessionManager, fs } = await setup();
    // Pre-seed a valid manifest in the in-memory fs.
    fs.files.set("/tmp/valid-plugin.yaml",
      "runtime:\n  id: browser\nversion: \"1.0\"\ncapabilities:\n  - browser.navigate\n");
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.install" },
      input: { source: "/tmp/valid-plugin.yaml" },
      sessionId: session.id,
    });
    expect("output" in result).toBe(true);
    if ("output" in result) {
      const record = result.output as { id: string; version: string; type: string; enabled: boolean; source: string };
      expect(record.id).toBe("browser");
      expect(record.version).toBe("1.0");
      expect(record.type).toBe("runtime");
      expect(record.enabled).toBe(true);
      expect(record.source).toBe("/tmp/valid-plugin.yaml");
    }
  });

  it("plugin.uninstall rejects missing id", async () => {
    const { gateway, clock, sessionManager } = await setup();
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.uninstall" },
      input: {},
      sessionId: session.id,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("GATEWAY_INVALID_REQUEST");
    }
  });

  it("plugin.enable rejects missing id", async () => {
    const { gateway, clock, sessionManager } = await setup();
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.enable" },
      input: {},
      sessionId: session.id,
    });
    expect("error" in result).toBe(true);
  });

  it("plugin.disable rejects missing id", async () => {
    const { gateway, clock, sessionManager } = await setup();
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.disable" },
      input: {},
      sessionId: session.id,
    });
    expect("error" in result).toBe(true);
  });

  it("plugin.reload rejects missing id", async () => {
    const { gateway, clock, sessionManager } = await setup();
    const session = sessionManager.create({ ownerId: "test", adapterType: "mcp" });
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.plugin.write"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.plugin.write"] },
      capability: { name: "plugin.reload" },
      input: {},
      sessionId: session.id,
    });
    expect("error" in result).toBe(true);
  });

  it("plugin.list without platform.plugin.read scope → INSUFFICIENT_SCOPE", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.session.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.session.read"] },
      capability: { name: "plugin.list" },
      input: {},
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("GATEWAY_INSUFFICIENT_SCOPE");
    }
  });

  it("platform.*.read wildcard covers plugin.list", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.*.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.*.read"] },
      capability: { name: "plugin.list" },
      input: {},
    });
    expect("output" in result).toBe(true);
  });
});

describe("system.* handlers", () => {
  it("system.info returns {name, version} from AGENTIDE_VERSION env", async () => {
    process.env["AGENTIDE_VERSION"] = "1.2.3-test";
    try {
      const { gateway, clock } = await setup();
      const result = await gateway.handleInvocation({
        token: makeToken(clock, ["platform.system.read"]),
        caller: { tenantId: "default", callerId: "test", scope: ["platform.system.read"] },
        capability: { name: "system.info" },
        input: {},
      });
      expect("output" in result).toBe(true);
      if ("output" in result) {
        expect(result.output).toMatchObject({ name: "agentide", version: "1.2.3-test" });
      }
    } finally {
      delete process.env["AGENTIDE_VERSION"];
    }
  });

  it("system.version returns {version, buildHash: null}", async () => {
    process.env["AGENTIDE_VERSION"] = "2.0.0";
    try {
      const { gateway, clock } = await setup();
      const result = await gateway.handleInvocation({
        token: makeToken(clock, ["platform.system.read"]),
        caller: { tenantId: "default", callerId: "test", scope: ["platform.system.read"] },
        capability: { name: "system.version" },
        input: {},
      });
      expect("output" in result).toBe(true);
      if ("output" in result) {
        expect(result.output).toMatchObject({ version: "2.0.0", buildHash: null });
      }
    } finally {
      delete process.env["AGENTIDE_VERSION"];
    }
  });

  it("system.info defaults to version 0.0.0 when env unset", async () => {
    delete process.env["AGENTIDE_VERSION"];
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.system.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.system.read"] },
      capability: { name: "system.info" },
      input: {},
    });
    expect("output" in result).toBe(true);
    if ("output" in result) {
      expect(result.output).toMatchObject({ name: "agentide", version: "0.0.0" });
    }
  });

  it("system.health returns {status: 'ok'}", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.system.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.system.read"] },
      capability: { name: "system.health" },
      input: {},
    });
    expect("output" in result).toBe(true);
    if ("output" in result) {
      expect(result.output).toEqual({ status: "ok" });
    }
  });

  it("system.health without platform.system.read scope → INSUFFICIENT_SCOPE", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.session.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.session.read"] },
      capability: { name: "system.health" },
      input: {},
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("GATEWAY_INSUFFICIENT_SCOPE");
    }
  });

  it("platform.*.read wildcard covers system.*", async () => {
    const { gateway, clock } = await setup();
    const result = await gateway.handleInvocation({
      token: makeToken(clock, ["platform.*.read"]),
      caller: { tenantId: "default", callerId: "test", scope: ["platform.*.read"] },
      capability: { name: "system.health" },
      input: {},
    });
    expect("output" in result).toBe(true);
  });
});
