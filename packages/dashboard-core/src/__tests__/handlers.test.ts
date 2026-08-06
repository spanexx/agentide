import { describe, expect, it } from "vitest";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";
import { createGateway, ERROR_CODES, issueToken } from "@spanexx/gateway-core";
import type { Clock, FileSystem } from "@spanexx/gateway-core";
import {
  DASHBOARD_BACKING,
  DASHBOARD_CAPS,
  DASHBOARD_CAPSESSION_LESS,
  createDashboardHandlers,
} from "../index.js";

// P2 of the dashboard-core IMPL: thin passthrough wrappers (D2 lock).
// Each handler re-invokes the backing read cap with an internal
// `dashboard-bot` token; GATEWAY_* errors pass through; double audit.

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
    const v = this.files.get(path);
    if (v === undefined) {
      const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    if (path.endsWith("audit.log")) this.files.set(path, (this.files.get(path) ?? "") + content);
    else this.files.set(path, content);
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

async function setupWithDashboard() {
  const fs = new InMemoryFs();
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  const pm = await createPluginManager(bus, registry, { fs, clock, installRecordPath: "/data/installed-plugins.json" });
  // Pre-mint the dashboard-bot token (in-process, no expectedOrigins) so the
  // sync extraOwners callback can return a populated handlers map. The
  // production composition root uses the same path; this matches the mint
  // shape used in the live agentide factory (callerId dashboard-bot, scope
  // platform.*.read).
  const { issueToken: issueTokenFn } = await import("@spanexx/gateway-core");
  const innerToken = issueTokenFn(
    {
      sub: { tenantId: "default", callerId: "dashboard-bot" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 3_600_000,
    },
    TEST_SECRET,
    clock,
  );
  const gateway = await createGateway(bus, registry, sm, pm, {
    fs, clock,
    auditLogPath: "/data/audit.log",
    tenantsPath: "/data/tenants.json",
    secretPath: "/data/gateway-secret",
    extraSessionLessCapabilities: DASHBOARD_CAPSESSION_LESS,
    extraOwners: (g) => [{
      owner: "dashboard",
      capabilities: DASHBOARD_CAPS,
      handlers: createDashboardHandlers(g, { innerToken, innerTenantId: "default" }),
    }],
  });
  await gateway.createTenant({ id: "default", name: "Default" });
  return { gateway, clock, fs };
}

describe("dashboard.view.* thin passthrough wrappers (P2)", () => {
  // AC-10.1: dashboard.view.<view> ≡ backing cap (snapshot, session-less).
  it("dashboard.view.sessions returns the same shape as session.list", async () => {
    const { gateway, clock } = await setupWithDashboard();
    const session = (await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.session.write", "platform.dashboard.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.write", "platform.dashboard.read"] },
      capability: { name: "session.create" },
      input: { ownerId: "alice", adapterType: "cli" },
    })) as { output?: { id: string }; error?: unknown };
    if (!session.output) throw new Error(`session.create returned: ${JSON.stringify(session)}`);
    const listRes = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.dashboard.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.dashboard.read"] },
      capability: { name: "dashboard.view.sessions" },
      input: {},
    });
    if (!("output" in listRes)) throw new Error(`dashboard.view.sessions returned: ${JSON.stringify(listRes)}`);
    const list = listRes.output as unknown as { id: string }[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((s) => s.id)).toContain(session.output.id);
  });

  // AC-10.2: insufficient scope → GATEWAY_INSUFFICIENT_SCOPE.
  it("denies a caller without platform.dashboard.read", async () => {
    const { gateway, clock } = await setupWithDashboard();
    const res = await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.session.read"]), // no platform.dashboard.read
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.session.read"] },
      capability: { name: "dashboard.view.sessions" },
      input: {},
    });
    expect(res).toHaveProperty("error");
    if ("error" in res) expect(res.error.code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
  });

  // AC-10.3: double audit — one row from the wrapper (caller alice), one from
  // the inner re-invocation (caller dashboard-bot, capability = session.list).
  it("produces a double audit row (outer caller + inner dashboard-bot)", async () => {
    const { gateway, clock, fs } = await setupWithDashboard();
    await gateway.handleInvocation({
      token: makeToken(clock, "default", "alice", ["platform.dashboard.read"]),
      caller: { tenantId: "default", callerId: "alice", scope: ["platform.dashboard.read"] },
      capability: { name: "dashboard.view.sessions" },
      input: {},
    });
    const written = fs.files.get("/data/audit.log") ?? "";
    const rows = written.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as { capability: { name: string }; caller: { id: string }; status: string });
    const outer = rows.find((r) => r.capability.name === "dashboard.view.sessions" && r.caller.id === "alice" && r.status === "ok");
    const inner = rows.find((r) => r.capability.name === "session.list" && r.caller.id === "dashboard-bot" && r.status === "ok");
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
  });

  it("exposes DASHBOARD_BACKING for all four views", () => {
    expect(Object.keys(DASHBOARD_BACKING)).toEqual([
      "dashboard.view.sessions",
      "dashboard.view.plugins",
      "dashboard.view.capabilities",
      "dashboard.view.health",
    ]);
  });
});