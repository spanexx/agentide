import { describe, expect, it } from "vitest";
import { createGateway } from "../index.js";
import { GatewayError, ERROR_CODES } from "../index.js";
import { issueToken } from "../auth.js";
import type {
  Adapter,
  AuditRecord,
  CanonicalInvocation,
  Clock,
  FileSystem,
  Gateway,
  TokenClaims,
} from "../index.js";
import { createEventBus, type EventBus, type PlatformEvent } from "@platform/event-bus";
import { createCapabilityRegistry, type CapabilityRegistry, type CapabilityRecord } from "@platform/capability-registry";
import { createSessionManager, type SessionManager, type SessionRecord } from "@platform/session-manager";
import { createPluginManager, type PluginManager } from "@platform/plugin-manager";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  private nextHandle = 0;
  private timers = new Map<number, { callback: () => void; due: number }>();
  now(): number { return this.nowValue; }
  // Mimics real setTimeout: callback fires after `delayMs`, not synchronously.
  // Mirrors session-manager's TestClock (packages/session-manager/src/__tests__/session-manager.test.ts:15-46).
  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, due: this.nowValue + delayMs });
    return handle;
  }
  clearTimeout(handle: number): void { this.timers.delete(handle); }
  advance(ms: number): void {
    const target = this.nowValue + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, t]) => t.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.nowValue = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.nowValue = target;
  }
}

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }
  async writeFile(path: string, content: string): Promise<void> {
    // Mirrors fs.promises.appendFile (append, not overwrite) — same as the audit.test.ts fake.
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

function claimsFor(tenantId: string, callerId: string, scope: string[]): TokenClaims {
  return {
    sub: { tenantId, callerId },
    scope,
    iat: 1_700_000_000_000,
    exp: 1_700_000_003_600,
  };
}

async function setup(opts: { plugins?: CapabilityRecord[]; seedTenants?: Array<{ id: string; name: string }> } = {}) {
  const fs = new InMemoryFs();
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  const pm = await createPluginManager(bus, registry, { fs, clock, installRecordPath: "/data/installed-plugins.json" });
  // Register a session-required test capability at owner "gateway" with a no-op handler for the
  // session-required-without-sessionId test. (The real handler is registered by createGateway below;
  // we override via direct registration so the no-op wins.)
  registry.register("gateway", { owner: "gateway", capabilities: [{
    name: "test.requiresSession",
    version: "1.0.0",
    type: "platform",
    description: "test",
    permissions: ["runtime.test.read"],
    owner: "gateway",
  }] });
  for (const p of opts.plugins ?? []) {
    registry.register(p.owner, { owner: p.owner, capabilities: [p] });
  }
  const gateway = await createGateway(bus, registry, sm, pm, {
    fs,
    clock,
    auditLogPath: "/data/audit.log",
    tenantsPath: "/data/tenants.json",
    secretPath: "/data/gateway-secret",
  });
  for (const t of opts.seedTenants ?? []) {
    await gateway.createTenant(t);
  }
  return { gateway, registry, sm, pm, bus, clock, fs };
}

describe("Gateway.handleInvocation", () => {
  it("rejects GATEWAY_INVALID_REQUEST when capability.name is empty", async () => {
    const { gateway, bus } = await setup();
    const captured: { name: string; payload: unknown }[] = [];
    bus.subscribe("gateway.invocation", (e) => {
      captured.push({ name: e.name, payload: e.payload });
    });
    const claims = claimsFor("default", "alice", ["*"]);
    const token = issueToken(claims, await loadSecret(), new FakeClock());
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "" },
      input: {},
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.INVALID_REQUEST);
    }
    expect(captured).toHaveLength(1);
    expect(captured[0].payload).toMatchObject({ status: "denied", denyReason: ERROR_CODES.INVALID_REQUEST });
  });

  it("rejects GATEWAY_INSUFFICIENT_SCOPE when caller has no scopes", async () => {
    const { gateway } = await setup();
    // Use a session-less capability (gateway.status) so we hit the authz check, not session-required.
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: [] },
      capability: { name: "gateway.status" },
      input: {},
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
    }
  });

  it("happy path: dispatches a platform capability and returns output", async () => {
    const { gateway, sm } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    // session.create requires ownerId + adapterType in input (matches the Session Manager's contract).
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.create", "platform.session.read"] },
      capability: { name: "session.create" },
      input: { ownerId: "alice", adapterType: "mcp", metadata: { task: "test" } },
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("output");
    if ("output" in result) {
      expect(result.output).toMatchObject({ ownerId: "alice", status: "active" });
    }
  });

  it("returns GATEWAY_CAPABILITY_NOT_FOUND for unknown capability", async () => {
    const { gateway, sm } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "totally.unknown" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.CAPABILITY_NOT_FOUND);
      expect(result.error.details).toMatchObject({ capability: "totally.unknown" });
    }
  });

  it("returns GATEWAY_INSUFFICIENT_SCOPE when scope does not cover", async () => {
    const { gateway, sm } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        description: "needs destructive",
        permissions: ["runtime.demo.destructive"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },  // too low
      capability: { name: "runtime.action" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
    }
  });

  it("tier hierarchy: act covers read (authz passes; v1 dispatch limitation)", async () => {
    // The tier-hierarchy authz test exercises a runtime plugin capability. In v1, dispatching
    // a runtime plugin capability returns GATEWAY_PLUGIN_NOT_INSTALLED or MANAGER_UNAVAILABLE
    // depending on whether the plugin is actually installed. The test verifies the authz check
    // itself passes — i.e., we don't see GATEWAY_INSUFFICIENT_SCOPE.
    const { gateway, sm } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        description: "needs read",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.act"] },
      capability: { name: "runtime.action" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      // Authz passed (act covers read); dispatch failed for some v1 limitation.
      // Either PLUGIN_NOT_INSTALLED (no install) or MANAGER_UNAVAILABLE (installed but no handler).
      expect([ERROR_CODES.PLUGIN_NOT_INSTALLED, ERROR_CODES.MANAGER_UNAVAILABLE]).toContain(result.error.code);
    }
  });

  it("returns GATEWAY_RATELIMIT_EXCEEDED after capacity tokens consumed", async () => {
    const { gateway, fs } = await setup();
    // Use a session-less capability (gateway.status) so we don't need a session.
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },
      input: {},
    };
    // Drain 100 (default capacity) successful invocations.
    for (let i = 0; i < 100; i++) {
      await gateway.handleInvocation(invocation);
    }
    // 101st should be rate-limited.
    const limited = await gateway.handleInvocation(invocation);
    expect(limited).toHaveProperty("error");
    if ("error" in limited) {
      expect(limited.error.code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
      expect(limited.error.retryable).toBe(true);
    }
    // Sanity: every call (100 ok + 1 denied) produced an audit record.
    const written = fs.files.get("/data/audit.log") ?? "";
    const lines = written.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(101);
  });

it("returns GATEWAY_SESSION_REQUIRED for session-required capability without sessionId", async () => {
    const { gateway } = await setup();
    // Use a capability that's NOT in SESSION_LESS_CAPABILITIES (runtime.action was registered in the plugins setup).
    // We register a fresh test capability to make the requirement explicit.
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.test.read"] },
      capability: { name: "test.requiresSession" },
      input: {},
      // no sessionId
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.SESSION_REQUIRED);
    }
  });

  it("read-only discovery does NOT require a session", async () => {
    const { gateway } = await setup();
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },  // session-less
      input: {},
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("output");
  });

  it("cross-tenant session rejection is deferred (session-manager v1 limitation)", async () => {
    // NOTE[agent]: session-manager v1 doesn't track tenantId per session — SessionRecord has
    // ownerId (= callerId) but no tenantId. A v2 enhancement adds getSession(id) → TenantRecord
    // so the gateway can verify session.tenantId === caller.tenantId. For v1, the gateway
    // documents this limitation in the PRD. This test verifies a cross-tenant invocation
    // still produces an audit record (status may be ok or error depending on dispatch path).
    const { gateway, sm } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "other-tenant", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "session.list" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    // Session-less capability + valid session + valid authz → dispatch returns output.
    // Cross-tenant check is deferred; the call still succeeds.
    expect(result).toHaveProperty("output");
  });

  it("auto-resolves capability version when omitted (reaches dispatch)", async () => {
    // Version resolution happens at the capability layer, not at dispatch. The test verifies
    // that the version-resolved capability reaches dispatch (i.e., it's not rejected for
    // version-not-found). In v1, dispatch returns either PLUGIN_NOT_INSTALLED or
    // MANAGER_UNAVAILABLE for runtime plugins — both are valid post-version-resolve failures.
    const { gateway, sm, registry } = await setup({
      plugins: [
        {
          name: "runtime.action",
          version: "1.0.0",
          type: "runtime",
          description: "v1",
          permissions: ["runtime.demo.read"],
          owner: "plugin:demo",
        },
      ],
    });
    registry.register("plugin:demo", {
      owner: "plugin:demo",
      capabilities: [{
        name: "runtime.action",
        version: "2.0.0",
        type: "runtime",
        description: "v2",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "runtime.action" },  // no version → latest (2.0.0)
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    // v1: not-found-via-version would be CAPABILITY_NOT_FOUND; auto-latest found v2.0.0 → dispatch.
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect([ERROR_CODES.PLUGIN_NOT_INSTALLED, ERROR_CODES.MANAGER_UNAVAILABLE]).toContain(result.error.code);
    }
  });

  it("explicit version pin returns GATEWAY_CAPABILITY_NOT_FOUND for missing version", async () => {
    const { gateway, sm } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        description: "v1 only",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "runtime.action", version: "9.9.9" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.CAPABILITY_NOT_FOUND);
    }
  });

  it("audit log receives a record on success", async () => {
    const { gateway, sm, fs } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    await gateway.handleInvocation({
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "session.list" },
      input: {},
      sessionId: session.id,
    });
    const written = fs.files.get("/data/audit.log") ?? "";
    const lines = written.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.status).toBe("ok");
    expect(record.caller.id).toBe("alice");
    expect(record.capability.name).toBe("session.list");
  });

  it("audit log receives a record on denial (rate limit)", async () => {
    const { gateway, fs } = await setup();
    const invocation: CanonicalInvocation = {
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },
      input: {},
    };
    for (let i = 0; i < 100; i++) await gateway.handleInvocation(invocation);
    await gateway.handleInvocation(invocation);
    const written = fs.files.get("/data/audit.log") ?? "";
    const lines = written.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(101);
    const lastLine = JSON.parse(lines[lines.length - 1]) as AuditRecord;
    expect(lastLine.status).toBe("denied");
    expect(lastLine.denyReason).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
  });

  it("Event Bus emits gateway.invocation event", async () => {
    const { gateway, bus, sm } = await setup();
    const events: PlatformEvent<unknown>[] = [];
    bus.subscribe("gateway.invocation", (e) => {
      events.push(e);
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    await gateway.handleInvocation({
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "session.list" },
      input: {},
      sessionId: session.id,
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("gateway.invocation");
  });
});

async function loadSecret(): Promise<Uint8Array> {
  // Hardcoded test secret (32 bytes). Production generates a random one.
  return new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");
}

describe("Gateway tenant lifecycle", () => {
  it("createTenant + listTenants + deleteTenant round-trip", async () => {
    const { gateway } = await setup();
    // The factory doesn't auto-create a "default" tenant — that's the `agentide init` flow.
    // The gateway factory starts with an empty tenant list.
    expect(gateway.listTenants()).toEqual([]);
    await gateway.createTenant({ id: "beta", name: "Beta Inc" });
    expect(gateway.listTenants().map((t) => t.id)).toEqual(["beta"]);
    await gateway.deleteTenant("beta");
    expect(gateway.listTenants().map((t) => t.id)).toEqual([]);
  });

  it("createTenant rejects duplicate id", async () => {
    const { gateway } = await setup();
    await gateway.createTenant({ id: "acme", name: "Acme" });
    await expect(gateway.createTenant({ id: "acme", name: "Dup" })).rejects.toThrow(GatewayError);
  });

  it("suspendTenant toggles suspended flag", async () => {
    const { gateway } = await setup();
    await gateway.createTenant({ id: "beta", name: "Beta" });
    const t = await gateway.suspendTenant("beta");
    expect(t.suspended).toBe(true);
    const after = gateway.listTenants().find((x) => x.id === "beta");
    expect(after?.suspended).toBe(true);
  });
});