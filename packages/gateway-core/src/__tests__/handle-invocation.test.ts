import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../index.js";
import { ERROR_CODES } from "../index.js";
import { issueToken } from "../auth.js";
import type {
  AuditRecord,
  CanonicalInvocation,
  Clock,
  FileSystem,
  TokenClaims,
} from "../index.js";
import type { BackendRuntime, BackendValue } from "@spanexx/backend-runtime";
import { createEventBus, type PlatformEvent } from "@spanexx/event-bus";
import { createCapabilityRegistry, type CapabilityRecord } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";

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

// JWT secret for tests. Same secret across all invocations.
const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

function makeToken(
  clock: FakeClock,
  tenantId: string,
  callerId: string,
  scope: readonly string[],
): string {
  return issueToken(
    {
      sub: { tenantId, callerId },
      scope: [...scope],
      iat: clock.now(),
      exp: clock.now() + 3_600_000,
    },
    TEST_SECRET,
    clock,
  );
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
    // Mirrors real fs semantics per consumer: the AuditWriter appends rows
    // to audit.log; file stores (tenants.json, clients.json,
    // registration-codes.json) OVERWRITE. The old fake appended everything,
    // which silently corrupted clients.json (save #2 → invalid JSON →
    // store.load() returns [] → revocation lookups missed).
    if (path.endsWith("audit.log")) {
      this.files.set(path, (this.files.get(path) ?? "") + content);
    } else {
      this.files.set(path, content);
    }
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

async function setup(opts: {
  plugins?: CapabilityRecord[];
  seedTenants?: Array<{ id: string; name: string }>;
  backendRuntime?: BackendRuntime;
} = {}) {
  const fs = new InMemoryFs();
  // Pre-seed the gateway-secret file with our test secret so loadOrCreateSecret returns it deterministically.
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
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
    ...(opts.backendRuntime !== undefined ? { backendRuntime: opts.backendRuntime } : {}),
  });
  // Auto-seed the "default" tenant (used by most tests). Additional tenants via opts.seedTenants.
  await gateway.createTenant({ id: "default", name: "Default Test Tenant" });
  for (const t of opts.seedTenants ?? []) {
    if (t.id !== "default") await gateway.createTenant(t);
  }
  return { gateway, registry, sm, pm, bus, clock, fs };
}

describe("Gateway.handleInvocation", () => {
  it("rejects GATEWAY_INVALID_REQUEST when capability.name is empty", async () => {
    const { gateway, bus, clock } = await setup();
    const captured: { name: string; payload: unknown }[] = [];
    bus.subscribe("gateway.invocation", (e) => {
      captured.push({ name: e.name, payload: e.payload });
    });
    const claims = claimsFor("default", "alice", ["*"]);
    void issueToken(claims, await loadSecret(), new FakeClock());
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", []),
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
    const { gateway, clock } = await setup();
    // Caller's token has empty scope. Authz should reject any required permission.
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", []),
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
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    // session.create requires ownerId + adapterType in input (matches the Session Manager's contract).
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.session.write"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.write"] },
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

  // D-45 closeout (2026-08-06): session.list returns the real snapshot —
  // records created via session.create (or the session manager) show up;
  // destroyed sessions stay visible as archived. The CLI `sessions` alias
  // and the dashboard Sessions view depend on this.
  it("session.list returns the real session snapshot (D-45)", async () => {
    const { gateway, clock } = await setup();
    const create = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["*"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "session.create" },
      input: { ownerId: "alice", adapterType: "cli" },
    });
    expect(create).toHaveProperty("output");
    const created = "output" in create ? (create.output as { id: string }) : { id: "" };
    expect(created.id).toBeTruthy();

    const list = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["*"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "session.list" },
      input: {},
    });
    expect(list).toHaveProperty("output");
    if ("output" in list) {
      const records = list.output as Array<{ id: string; status: string; ownerId: string }>;
      expect(records.map((r) => r.id)).toContain(created.id);
      expect(records.find((r) => r.id === created.id)).toMatchObject({ status: "active", ownerId: "alice" });
    }

    // Destroyed sessions remain visible as archived (operator can see history).
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["*"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "session.destroy" },
      input: { sessionId: created.id },
      sessionId: created.id,
    });
    const after = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["*"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "session.list" },
      input: {},
    });
    if ("output" in after) {
      const records = after.output as Array<{ id: string; status: string }>;
      expect(records.find((r) => r.id === created.id)).toMatchObject({ status: "archived" });
    }
  });

  // D-72 pin (2026-08-06): active revocation fires on the invocation path.
  // A token minted for a client_credentials identity (`cli_` callerId) is
  // re-checked against ClientRecord.revoked AFTER JWT verification — a
  // revoked client's token must be denied even before its expiry. The check
  // lives at handle-invocation.ts (4a); this test pins it end-to-end.
  it("denies invocation with a revoked client token (D-72)", async () => {
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "ops", adapterType: "cli" });
    const withSession = { sessionId: session.id };
    const created = await gateway.handleInvocation({
      token: makeToken(clock, "default", "ops", ["*"]),
      caller: { tenantId: "default", callerId: "ops", scope: ["*"] },
      capability: { name: "client.create" },
      input: { tenantId: "default", name: "bot", defaultScope: ["*"] },
      ...withSession,
    });
    expect(created).toHaveProperty("output");
    const clientId = "output" in created
      ? (created.output as { record?: { id?: string } }).record?.id ?? ""
      : "";
    expect(clientId).toMatch(/^cli_/);

    // Token minted for the client identity — still valid by signature/expiry.
    const clientToken = makeToken(clock, "default", clientId, ["*"]);
    const before = await gateway.handleInvocation({
      token: clientToken,
      caller: { tenantId: "default", callerId: clientId, scope: ["*"] },
      capability: { name: "session.list" },
      input: {},
    });
    expect(before).toHaveProperty("output");

    const revoked = await gateway.handleInvocation({
      token: makeToken(clock, "default", "ops", ["*"]),
      caller: { tenantId: "default", callerId: "ops", scope: ["*"] },
      capability: { name: "client.revoke" },
      input: { clientId },
      ...withSession,
    });
    expect(revoked).toHaveProperty("output");

    const after = await gateway.handleInvocation({
      token: clientToken,
      caller: { tenantId: "default", callerId: clientId, scope: ["*"] },
      capability: { name: "session.list" },
      input: {},
    });
    expect(after).toHaveProperty("error");
    if ("error" in after) {
      expect(after.error.code).toBe(ERROR_CODES.AUTH_FAILED);
      expect(after.error.details).toMatchObject({ error: "client_revoked" });
    }
  });

  it("returns GATEWAY_CAPABILITY_NOT_FOUND for unknown capability", async () => {
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.session.read"]),
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
    const { gateway, sm, clock } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        tier: "destructive",
        description: "needs destructive",
        permissions: ["runtime.demo.destructive"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.session.read"]),
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
    const { gateway, sm, clock } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "needs read",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.demo.act"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.act"] },
      capability: { name: "runtime.action" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      // Authz passed (act covers read); dispatch failed for some v1 limitation.
      // Either PLUGIN_NOT_INSTALLED (no install) or HANDLER_NOT_FOUND (installed but no handler).
      expect([ERROR_CODES.PLUGIN_NOT_INSTALLED, ERROR_CODES.HANDLER_NOT_FOUND]).toContain(result.error.code);
    }
  });

  it("returns GATEWAY_RATELIMIT_EXCEEDED after capacity tokens consumed", async () => {
    const { gateway, fs, clock } = await setup();
    // Use a session-less capability (gateway.status) so we don't need a session.
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
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
    const { gateway, clock } = await setup();
    // Use a capability that's NOT in SESSION_LESS_CAPABILITIES (runtime.action was registered in the plugins setup).
    // We register a fresh test capability to make the requirement explicit.
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.test.read"]),
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
    const { gateway, clock } = await setup();
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },  // session-less
      input: {},
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("output");
  });

  it("cross-tenant session rejection: tenant state check fires first", async () => {
    // Caller is in a tenant that doesn't exist. The kernel returns GATEWAY_TENANT_MISMATCH
    // before session lookup. (v1 also doesn't track session.tenantId → can't reject cross-tenant
    // session reuse, but tenant existence catches the broader "unknown tenant" case.)
    const { gateway , clock } = await setup();
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "ghost-tenant", "alice", ["platform.session.read"]),
      caller: { tenantId: "ghost-tenant", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "session.list" },
      input: {},
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.TENANT_MISMATCH);
      expect(result.error.details).toMatchObject({ tenantId: "ghost-tenant" });
    }
  });

  it("auto-resolves capability version when omitted (reaches dispatch)", async () => {
    // Version resolution happens at the capability layer, not at dispatch. The test verifies
    // that the version-resolved capability reaches dispatch (i.e., it's not rejected for
    // version-not-found). In v1, dispatch returns either PLUGIN_NOT_INSTALLED or
    // MANAGER_UNAVAILABLE for runtime plugins — both are valid post-version-resolve failures.
    const { gateway, sm, registry, clock } = await setup({
      plugins: [
        {
          name: "runtime.action",
          version: "1.0.0",
          type: "runtime",
          tier: "read",
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
        tier: "read",
        description: "v2",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.demo.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "runtime.action" },  // no version → latest (2.0.0)
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    // v1: not-found-via-version would be CAPABILITY_NOT_FOUND; auto-latest found v2.0.0 → dispatch.
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect([ERROR_CODES.PLUGIN_NOT_INSTALLED, ERROR_CODES.HANDLER_NOT_FOUND]).toContain(result.error.code);
    }
  });

  it("explicit version pin returns GATEWAY_CAPABILITY_NOT_FOUND for missing version", async () => {
    const { gateway, sm, clock } = await setup({
      plugins: [{
        name: "runtime.action",
        version: "1.0.0",
        type: "runtime",
        tier: "read",
        description: "v1 only",
        permissions: ["runtime.demo.read"],
        owner: "plugin:demo",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.session.read"]),
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
    const { gateway, sm, fs, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.session.read"]),
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
    const { gateway, fs, clock } = await setup();
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
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

  // D-46 closeout (2026-08-06): gateway.metrics must return REAL counters,
  // not placeholder zeros. Counters are incremented at the canonical exit
  // points (auditOk → ok, auditError → error, exitWithError → denied with
  // auth/rate-limit sub-buckets). Note: reading gateway.metrics itself is an
  // invocation and counts +1 ok.
  it("gateway.metrics counts successful invocations (D-46)", async () => {
    const { gateway, clock } = await setup();
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },
      input: {},
    });
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.metrics" },
      input: {},
    });
    expect(res).toHaveProperty("output");
    if ("output" in res) {
      const m = res.output as { invocations: { ok: number; denied: number; error: number } };
      // The snapshot is captured BEFORE the metrics read itself is audited,
      // so it shows exactly the one gateway.status call.
      expect(m.invocations.ok).toBe(1);
    }
  });

  it("gateway.metrics counts authz denials (D-46)", async () => {
    const { gateway, clock } = await setup();
    // No scope → INSUFFICIENT_SCOPE → denied.
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", []),
      caller: { tenantId: "default", callerId: "alice", scope: [] },
      capability: { name: "gateway.status" },
      input: {},
    });
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.metrics" },
      input: {},
    });
    if ("output" in res) {
      const m = res.output as { invocations: { ok: number; denied: number; error: number } };
      expect(m.invocations.denied).toBe(1);
      expect(m.invocations.ok).toBe(0); // snapshot excludes the metrics read itself
    }
  });

  it("gateway.metrics counts auth failures (D-46)", async () => {
    const { gateway, clock } = await setup();
    // Garbage token → TOKEN_INVALID → auth failure bucket.
    await gateway.handleInvocation({
      token: "not-a-real-jwt",
      caller: { tenantId: "default", callerId: "alice", scope: ["*"] },
      capability: { name: "gateway.status" },
      input: {},
    });
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.metrics" },
      input: {},
    });
    if ("output" in res) {
      const m = res.output as { authFailures: number };
      expect(m.authFailures).toBe(1);
    }
  });

  it("gateway.metrics counts rate-limit denials (D-46)", async () => {
    const { gateway, clock } = await setup();
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.status" },
      input: {},
    };
    // 100 pass, the 101st (same caller) is rate-limited → denied.
    for (let i = 0; i < 101; i++) await gateway.handleInvocation(invocation);
    // Read metrics as a DIFFERENT caller — the same caller is now limited.
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "ops", ["platform.gateway.read"]),
      caller: { tenantId: "default", callerId: "ops", scope: ["platform.gateway.read"] },
      capability: { name: "gateway.metrics" },
      input: {},
    });
    expect(res).toHaveProperty("output");
    if ("output" in res) {
      const m = res.output as { rateLimitDenials: number; invocations: { ok: number; denied: number } };
      expect(m.rateLimitDenials).toBe(1);
      expect(m.invocations.denied).toBe(1);
      expect(m.invocations.ok).toBe(100);
    }
  });

  it("Event Bus emits gateway.invocation event", async () => {
    const { gateway, bus, sm, clock } = await setup();
    const events: PlatformEvent<unknown>[] = [];
    bus.subscribe("gateway.invocation", (e) => {
      events.push(e);
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.session.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "session.list" },
      input: {},
      sessionId: session.id,
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("gateway.invocation");
  });

  it("regression: backend-sdk-* with no backendRuntime configured still returns GATEWAY_SDK_UNREACHABLE", async () => {
    const { gateway, registry, sm, clock } = await setup();
    // Register a backend-sdk-* capability so the request reaches dispatch (not CAPABILITY_NOT_FOUND).
    await registry.register("backend-sdk-acme", {
      owner: "backend-sdk-acme",
      capabilities: [{
        name: "business.foo",
        version: "1.0.0",
        type: "business",
        description: "test sdk cap",
        permissions: ["runtime.demo.read"],
        owner: "backend-sdk-acme",
      }],
    });
    // No backendRuntime passed → fallback stub still fires (preserves backward compat).
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.demo.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "business.foo" },
      input: {},
      sessionId: sm.create({ ownerId: "alice", adapterType: "mcp" }).id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.SDK_UNREACHABLE);
      expect(result.error.retryable).toBe(true);
    }
  });

  it("routes backend-sdk-* through backendRuntime.dispatchInvocation and returns the SDK's payload", async () => {
    const dispatchInvocation = vi.fn(
      async (
        _owner: string,
        _capability: CapabilityRecord,
        _input: BackendValue,
        _sessionId: string | undefined,
      ): Promise<BackendValue> => ({ greeting: "hello from the SDK" }),
    );
    const backendRuntime: BackendRuntime = {
      start: async () => {},
      stop: async () => {},
      dispatchInvocation,
      connectionCount: () => 1,
      address: () => null,
    };
    const { gateway, registry, sm, clock } = await setup({ backendRuntime });
    await registry.register("backend-sdk-acme", {
      owner: "backend-sdk-acme",
      capabilities: [{
        name: "business.greet",
        version: "1.0.0",
        type: "business",
        description: "greeting",
        permissions: ["runtime.demo.read"],
        owner: "backend-sdk-acme",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.demo.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "business.greet", version: "1.0.0" },
      input: { name: "world" },
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("output");
    if ("output" in result) {
      expect(result.output).toEqual({ greeting: "hello from the SDK" });
    }
    // The dispatcher received the full CapabilityRecord (resolved from the registry).
    expect(dispatchInvocation).toHaveBeenCalledTimes(1);
    const [ownerArg, capArg, inputArg, sessionArg] = dispatchInvocation.mock.calls[0] ?? [];
    expect(ownerArg).toMatch(/^backend-sdk-/);
    expect((capArg as CapabilityRecord).name).toBe("business.greet");
    expect(inputArg).toEqual({ name: "world" });
    expect(sessionArg).toBe(session.id);
  });

  it("surfaces GatewayError thrown from backendRuntime as a structured error response", async () => {
    const { GatewayError } = await import("../errors.js");
    const dispatchInvocation = vi.fn(async (): Promise<BackendValue> => {
      throw new GatewayError(
        ERROR_CODES.SDK_UNREACHABLE,
        "no SDK connected for app acme",
        { owner: "backend-sdk-acme" },
        true,
      );
    });
    const backendRuntime: BackendRuntime = {
      start: async () => {},
      stop: async () => {},
      dispatchInvocation,
      connectionCount: () => 0,
      address: () => null,
    };
    const { gateway, registry, sm, clock } = await setup({ backendRuntime });
    await registry.register("backend-sdk-acme", {
      owner: "backend-sdk-acme",
      capabilities: [{
        name: "business.greet",
        version: "1.0.0",
        type: "business",
        description: "greeting",
        permissions: ["runtime.demo.read"],
        owner: "backend-sdk-acme",
      }],
    });
    const session = sm.create({ ownerId: "alice", adapterType: "mcp" });
    const invocation: CanonicalInvocation = {
      token: makeToken(clock, "default", "alice", ["runtime.demo.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["runtime.demo.read"] },
      capability: { name: "business.greet" },
      input: {},
      sessionId: session.id,
    };
    const result = await gateway.handleInvocation(invocation);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error.code).toBe(ERROR_CODES.SDK_UNREACHABLE);
      expect(result.error.retryable).toBe(true);
      expect(result.error.details).toMatchObject({ owner: "backend-sdk-acme" });
    }
  });
});

async function loadSecret(): Promise<Uint8Array> {
  // Hardcoded test secret (32 bytes). Production generates a random one.
  return new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");
}
// Mark unused for the eslint plugin to silence the warning.
void loadSecret;

describe("Gateway tenant lifecycle", () => {
  it("createTenant + listTenants + deleteTenant round-trip", async () => {
    const { gateway } = await setup();
    // The factory auto-seeds the "default" tenant. The round-trip creates a second tenant, then deletes it; "default" remains.
    await gateway.createTenant({ id: "beta", name: "Beta Inc" });
    expect(gateway.listTenants().map((t) => t.id).sort()).toEqual(["beta", "default"].sort());
    await gateway.deleteTenant("beta");
    expect(gateway.listTenants().map((t) => t.id)).toEqual(["default"]);
  });

  it("createTenant rejects duplicate id", async () => {
    const { gateway } = await setup();
    await gateway.createTenant({ id: "acme", name: "Acme" });
    await expect(gateway.createTenant({ id: "acme", name: "Dup" })).rejects.toThrow(/already exists/);
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