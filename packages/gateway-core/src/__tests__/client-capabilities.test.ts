/*
 * Code Map: client.* capability registration tests (BI[29] Phase 3)
 * - capability.list with operator scope exposes client.create/list/revoke/rotate
 * - client.create + client.list round-trip via handleInvocation
 * - client.revoke flips the revoked flag
 * - client.rotate issues a new secret and keeps the old one in grace
 *
 * CID Index:
 * CID:cap-001 -> client.create visible in capability.list
 * CID:cap-002 -> client.create + client.list round-trip
 * CID:cap-003 -> client.revoke flips revoked
 * CID:cap-004 -> client.rotate issues new secret
 */
import { describe, expect, it } from "vitest";
import { createGateway } from "../index.js";
import { issueToken } from "../auth.js";
import type { Clock, FileSystem, TokenClaims } from "../index.js";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void { /* noop */ }
}

const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

function claimsFor(tenantId: string, callerId: string, scope: string[]): TokenClaims {
  return {
    sub: { tenantId, callerId },
    scope,
    iat: 1_700_000_000_000,
    exp: 1_700_000_003_600,
  };
}

async function setup() {
  const fs = new InMemoryFs();
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    installRecordPath: "/data/installed-plugins.json",
  });
  const gateway = await createGateway(bus, registry, sm, pm, {
    fs,
    clock,
    secretPath: "/data/gateway-secret",
    tenantsPath: "/data/tenants.json",
    auditLogPath: "/data/audit.log",
    clientDataDir: "/data",
    handlerTimeoutMs: 5_000,
  });
  await gateway.createTenant({ id: "default", name: "Default" });
  return { gateway, sm, clock };
}

async function invoke(
  gateway: Awaited<ReturnType<typeof setup>>["gateway"],
  clock: FakeClock,
  scope: string[],
  capability: string,
  input: unknown,
  sessionId?: string,
) {
  const token = await issueToken(claimsFor("default", "alice", scope), TEST_SECRET, clock);
  const result = await gateway.handleInvocation({
    token,
    caller: { tenantId: "default", callerId: "alice", scope },
    capability: { name: capability },
    input: input as never,
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
  if ("error" in result) throw new Error(`${capability} failed: ${result.error.code} — ${result.error.message}`);
  return result.output as unknown;
}

describe("client.* capabilities (BI[29] Phase 3)", () => {
  // CID:cap-001
  it("gateway exposes client.create, client.list, client.revoke, client.rotate", async () => {
    const { gateway, clock } = await setup();
    const cards = await invoke(gateway, clock, ["*"], "capability.list", { scope: ["*"] });
    const names = (cards as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["client.create", "client.list", "client.revoke", "client.rotate"]),
    );
  });

  // CID:cap-002
  it("client.create registers a client and client.list returns it", async () => {
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "cli" });
    const scope = ["platform.client.write", "platform.client.read"];
    const created = await invoke(gateway, clock, scope, "client.create", {
      tenantId: "acme",
      name: "nest-app",
      defaultScope: ["product.*"],
    }, session.id) as { record: { id: string; hashedSecret: string; tenantId: string } };
    expect(created.record.id).toMatch(/^cli_/);
    expect(created.record.hashedSecret).toMatch(/^sha256:/);
    expect(created.record.tenantId).toBe("acme");
    const listed = await invoke(gateway, clock, scope, "client.list", { tenantId: "acme" }, session.id) as Array<{ id: string }>;
    expect(listed.map((c) => c.id)).toContain(created.record.id);
  });

  // CID:cap-003
  it("client.revoke flips the revoked flag", async () => {
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "cli" });
    const scope = ["platform.client.write", "platform.client.read"];
    const created = await invoke(gateway, clock, scope, "client.create", {
      tenantId: "acme",
      name: "nest-app",
      defaultScope: ["product.*"],
    }, session.id) as { record: { id: string } };
    await invoke(gateway, clock, scope, "client.revoke", { clientId: created.record.id }, session.id);
    const listed = await invoke(gateway, clock, scope, "client.list", { tenantId: "acme" }, session.id) as Array<{ id: string; revoked: boolean }>;
    const rec = listed.find((c) => c.id === created.record.id);
    expect(rec?.revoked).toBe(true);
  });

  // CID:cap-004
  it("client.rotate issues a new secret", async () => {
    const { gateway, sm, clock } = await setup();
    const session = sm.create({ ownerId: "alice", adapterType: "cli" });
    const scope = ["platform.client.write", "platform.client.read"];
    const created = await invoke(gateway, clock, scope, "client.create", {
      tenantId: "acme",
      name: "nest-app",
      defaultScope: ["product.*"],
    }, session.id) as { plaintextSecret: string; record: { id: string } };
    const rotated = await invoke(gateway, clock, scope, "client.rotate", { clientId: created.record.id }, session.id) as { plaintextSecret: string };
    expect(rotated.plaintextSecret).not.toBe(created.plaintextSecret);
    expect(rotated.plaintextSecret.length).toBeGreaterThan(20);
  });
});
