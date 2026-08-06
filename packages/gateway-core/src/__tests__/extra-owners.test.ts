import { describe, expect, it } from "vitest";
import { createGateway } from "../index.js";
import { issueToken } from "../auth.js";
import type { Clock, FileSystem } from "../index.js";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry, type CapabilityRecord } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";

// P1 of the dashboard-core IMPL: the generic extraOwners seam (D2 lock —
// "kernel stays dashboard-agnostic"). A composition root (the agentide
// factory) can register extra owner handlers + their capability records
// and extend the session-less set without touching the kernel.

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}

const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

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
    if (path.endsWith("audit.log")) {
      this.files.set(path, (this.files.get(path) ?? "") + content);
    } else {
      this.files.set(path, content);
    }
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

function makeToken(clock: FakeClock, tenantId: string, callerId: string, scope: readonly string[]): string {
  return issueToken(
    { sub: { tenantId, callerId }, scope: [...scope], iat: clock.now(), exp: clock.now() + 3_600_000 },
    TEST_SECRET,
    clock,
  );
}

async function setup() {
  const fs = new InMemoryFs();
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  const pm = await createPluginManager(bus, registry, { fs, clock, installRecordPath: "/data/installed-plugins.json" });
  return { fs, clock, bus, registry, sm, pm };
}

describe("Gateway extraOwners seam (P1 dashboard-core)", () => {
  it("registers extra owner caps + handlers and lets them resolve session-less", async () => {
    const { clock, sm, pm, registry, bus, fs } = await setup();
    const cap: CapabilityRecord = {
      name: "dashboard.view.sessions",
      version: "1.0.0",
      type: "platform",
      description: "List sessions (dashboard view)",
      permissions: ["platform.dashboard.read"],
      owner: "dashboard",
      tier: "read",
    };
    const gateway = await createGateway(bus, registry, sm, pm, {
      fs,
      clock,
      auditLogPath: "/data/audit.log",
      tenantsPath: "/data/tenants.json",
      secretPath: "/data/gateway-secret",
      extraSessionLessCapabilities: ["dashboard.view.sessions"],
      extraOwners: () => [{
        owner: "dashboard",
        capabilities: [cap],
        handlers: {
          "dashboard.view.sessions": async () => ({ sessions: [{ id: "s1", status: "active" }] }),
        },
      }],
    });
    await gateway.createTenant({ id: "default", name: "Default Test Tenant" });

    // Session-less: no sessionId on the invocation.
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.dashboard.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.dashboard.read"] },
      capability: { name: "dashboard.view.sessions" },
      input: {},
    });
    expect(res).toEqual({ output: { sessions: [{ id: "s1", status: "active" }] } });
  });

  it("keeps the session requirement for extra caps NOT in the session-less set", async () => {
    const { clock, sm, pm, registry, bus, fs } = await setup();
    const gateway = await createGateway(bus, registry, sm, pm, {
      fs,
      clock,
      auditLogPath: "/data/audit.log",
      tenantsPath: "/data/tenants.json",
      secretPath: "/data/gateway-secret",
      extraOwners: () => [{
        owner: "dashboard",
        capabilities: [{
          name: "dashboard.view.writes",
          version: "1.0.0",
          type: "platform",
          description: "writey",
          permissions: ["platform.dashboard.write"],
          owner: "dashboard",
          tier: "write",
        }],
        handlers: { "dashboard.view.writes": async () => ({ ok: true }) },
      }],
    });
    await gateway.createTenant({ id: "default", name: "Default Test Tenant" });

    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.dashboard.write"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.dashboard.write"] },
      capability: { name: "dashboard.view.writes" },
      input: {},
      // No sessionId AND the cap is not session-less → denied.
    });
    expect(res).toHaveProperty("error");
  });
});
