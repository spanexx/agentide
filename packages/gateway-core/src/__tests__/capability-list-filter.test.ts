/*
 * Code Map: gateway capability.list tier-aware filter tests
 * - bootstrap scope ("*") returns all caps
 * - runtime.<x>.read scope filters to read-tier runtime caps
 * - platform.<x>.read filters to read-tier platform caps
 * - empty/malformed scope returns []
 * - union of multiple scopes
 *
 * CID Index:
 * CID:cap-list-001 -> bootstrap scope sees everything
 * CID:cap-list-002 -> narrow scope filters by tier
 * CID:cap-list-003 -> empty scope returns []
 * CID:cap-list-004 -> union of scopes
 */
import { describe, expect, it } from "vitest";
import { createGateway } from "../index.js";
import { issueToken } from "../auth.js";
import type { Clock, FileSystem, TokenClaims } from "../index.js";
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager } from "@platform/session-manager";
import { createPluginManager } from "@platform/plugin-manager";

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
    handlerTimeoutMs: 5_000,
  });
  await gateway.createTenant({ id: "default", name: "Default" });
  return { gateway, registry, clock };
}

async function listCaps(gateway: Awaited<ReturnType<typeof setup>>["gateway"], clock: FakeClock, scope: string[]) {
  // The capability.list handler requires platform.capability.read permission;
  // the caller's scope must include that, plus any test scope we want to filter by.
  const effectiveScope = scope.includes("platform.capability.read")
    ? scope
    : ["platform.capability.read", ...scope];
  const token = await issueToken(claimsFor("default", "alice", effectiveScope), TEST_SECRET, clock);
  const result = await gateway.handleInvocation({
    token,
    caller: { tenantId: "default", callerId: "alice", scope: effectiveScope },
    capability: { name: "capability.list" },
    input: { scope },
  });
  if ("error" in result) throw new Error(`capability.list failed: ${result.error.code}`);
  return result.output as Array<{ name: string; tier: string | null }>;
}

describe("Gateway capability.list — tier-aware filter (BI[7])", () => {
  // CID:cap-list-001
  it("bootstrap scope (*) returns all caps", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, ["*"]);
    expect(cards.length).toBeGreaterThan(20); // 25 platform caps + any registered runtime
    // No card has null tier except business caps; all our caps are platform/runtime so all have tier
    for (const card of cards) {
      expect(card.tier).not.toBeNull();
    }
  });

  // CID:cap-list-002
  it("scope platform.*.read returns only read-tier platform caps", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, ["platform.*.read"]);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.tier).toBe("read");
    }
    // Write-tier caps (session.create, tenant.create, etc.) must NOT appear
    expect(cards.map((c) => c.name)).not.toContain("session.create");
    expect(cards.map((c) => c.name)).not.toContain("plugin.install");
  });

  it("scope platform.*.write returns all caps (write covers read)", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, ["platform.*.write"]);
    expect(cards.length).toBeGreaterThan(0);
    // Write-tier caps present
    expect(cards.map((c) => c.name)).toContain("session.create");
    expect(cards.map((c) => c.name)).toContain("plugin.install");
    // Read-tier caps ALSO present (write covers read)
    expect(cards.map((c) => c.name)).toContain("session.list");
  });

  // CID:cap-list-003
  it("empty scope returns empty list (defensive)", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, []);
    expect(cards).toEqual([]);
  });

  it("malformed scope returns empty list", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, ["xyzzy"]);
    expect(cards).toEqual([]);
  });

  // CID:cap-list-004
  it("union of two scopes returns the union of covered caps", async () => {
    const { gateway, clock } = await setup();
    const onlyRead = await listCaps(gateway, clock, ["platform.*.read"]);
    const onlyWrite = await listCaps(gateway, clock, ["platform.*.write"]);
    const union = await listCaps(gateway, clock, ["platform.*.read", "platform.*.write"]);

    const readNames = new Set(onlyRead.map((c) => c.name));
    const writeNames = new Set(onlyWrite.map((c) => c.name));
    const unionNames = new Set(union.map((c) => c.name));

    // Every read-only and write-only cap is in the union
    for (const n of readNames) expect(unionNames.has(n)).toBe(true);
    for (const n of writeNames) expect(unionNames.has(n)).toBe(true);
    // Union is at least as large as either side
    expect(unionNames.size).toBeGreaterThanOrEqual(readNames.size);
    expect(unionNames.size).toBeGreaterThanOrEqual(writeNames.size);
  });

  it("scope runtime.X.does-not-exist returns empty list", async () => {
    const { gateway, clock } = await setup();
    const cards = await listCaps(gateway, clock, ["runtime.nonexistent.read"]);
    expect(cards).toEqual([]);
  });

  it("scope runtime.*.write returns nothing (write not a valid runtime tier)", async () => {
    const { gateway, clock } = await setup();
    // runtime.*.write is malformed — authz rejects unknown tier names
    const cards = await listCaps(gateway, clock, ["runtime.*.write"]);
    expect(cards).toEqual([]);
  });
});