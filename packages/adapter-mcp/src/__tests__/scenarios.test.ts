/*
 * Behavior spec for the MCP adapter factory + real-kernel integration
 * (createMcpAdapter in src/index.ts). Covers the 8 PRD-TRD scenarios plus
 * the timeout path. Each test brings up the real gateway, registers one
 * session, and drives the adapter over real HTTP at /mcp.
 *
 * Why not table-driven: the scenarios diverge on token scope, presence of
 * session, and response shape. Splitting them keeps the assertions readable
 * and surfaces which exact PRD scenario is failing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createMcpAdapter } from "../index.js";
import { createGateway, issueToken } from "@spanexx/gateway-core";
import { ERROR_CODES } from "@spanexx/errors";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry, type CapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager, type SessionManager } from "@spanexx/session-manager";
import { createPluginManager, type PluginManager } from "@spanexx/plugin-manager";
import { META, SystemClock, TEST_SECRET, customerReadCard, InMemoryFs, makeNeverSdk, makeToken, rpc, start, stopAllTracked, track } from "./harness.js";

afterEach(async () => {
  await stopAllTracked();
});

describe("createMcpAdapter — PRD scenarios", () => {
  it("Scenario 1: tools/list returns the capability catalog with tier annotations", async () => {
    const { adapter, stop } = await start();
    const token = makeToken(["*"]);
    const res = await rpc(adapter, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const tools = res.json.result?.tools ?? [];
    // Bootstrap scope sees both business caps (customer.read + customer.delete) and platform caps.
    const names = tools.map((t) => t.name);
    expect(names).toContain("customer.read");
    expect(names).toContain("customer.delete");
    const read = tools.find((t) => t.name === "customer.read");
    expect(read?.inputSchema).toEqual({ type: "object", properties: { id: { type: "string" } }, required: ["id"] });
    expect(read?.annotations.tier).toBeNull();
    await stop();
  });

  it("Scenario 2: tools/call business cap dispatches the session id end-to-end", async () => {
    const { adapter, fakeSdk, createSession, stop } = await start();
    const sessionId = await createSession();
    const token = makeToken(["customer.read"]);
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "customer.read", arguments: { id: "c-042" }, _meta: { ...META, "dev.agentide/sessionId": sessionId } },
    });
    const res = await rpc(adapter, body, `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const text = res.json.result?.content?.[0]?.text ?? "";
    expect(text).toContain("c-042");
    expect(res.json.result?.structuredContent).toEqual({ id: "c-042", name: "Ada Lovelace" });
    expect(fakeSdk.dispatched).toHaveLength(1);
    expect(fakeSdk.dispatched[0]?.owner).toBe("backend-sdk-customer-app");
    expect(fakeSdk.dispatched[0]?.sessionId).toBe(sessionId);
    await stop();
  });

  it("Scenario 3: tools/call platform cap (session.create) flows through kernel", async () => {
    const { adapter, stop } = await start();
    const token = makeToken(["*"]);
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "session.create", arguments: { ownerId: "agentide-tester", adapterType: "mcp" }, _meta: META },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const sc = res.json.result?.structuredContent as { id?: string } | undefined;
    expect(typeof sc?.id).toBe("string");
    await stop();
  });

  it("Scenario 4: tools/call on an unknown capability returns -32001 with not-found message", async () => {
    const { adapter, createSession, stop } = await start();
    // An active session is required for business capabilities (session check
    // precedes capability resolution in the kernel), so create one to reach
    // the CAPABILITY_NOT_FOUND path the PRD asserts.
    const sessionId = await createSession();
    const token = makeToken(["*"]);
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "customer.refund", arguments: {}, _meta: { ...META, "dev.agentide/sessionId": sessionId } },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error?.code).toBe(-32001);
    expect(res.json.error?.message).toBe("capability 'customer.refund' not found");
    await stop();
  });

  it("Scenario 5: tools/call with insufficient scope returns -32002", async () => {
    const { adapter, createSession, stop } = await start();
    const sessionId = await createSession();
    const token = makeToken(["customer.read"]); // not customer.delete
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "customer.delete", arguments: { id: "c-042" }, _meta: { ...META, "dev.agentide/sessionId": sessionId } },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error?.code).toBe(-32002);
    expect(res.json.error?.message).toBe("GATEWAY_INSUFFICIENT_SCOPE");
    await stop();
  });

  it("Scenario 6 (D-124): missing _meta is accepted — real MCP clients never send it on tools requests", async () => {
    const { adapter, stop } = await start();
    const token = makeToken(["*"]);
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 6, method: "tools/list", params: {},
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const tools = res.json.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    await stop();
  });

  it("Scenario 7: unsupported method (prompts/list) returns -32601 from the SDK default", async () => {
    const { adapter, stop } = await start();
    const token = makeToken(["*"]);
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 7, method: "prompts/list", params: { _meta: META },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error?.code).toBe(-32601);
    expect(res.json.error?.message).toMatch(/Method not found/);
    await stop();
  });

  it("Scenario 8: missing bearer token is rejected before any handler runs", async () => {
    const { adapter, stop } = await start();
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: META },
    }), null);
    expect(res.status).toBe(200);
    // Missing Authorization maps to -32001 GATEWAY_AUTH_FAILED per PRD.
    expect(res.json.error?.code).toBe(-32001);
    expect(res.json.error?.message).toBe("GATEWAY_AUTH_FAILED");
    await stop();
  });

  it("Scenario 8b: expired token returns -32001 (GATEWAY_AUTH_FAILED)", async () => {
    const { adapter, stop } = await start();
    // Sign with exp in the deep past so the kernel clock sees it as expired.
    const token = issueToken(
      { sub: { tenantId: "default", callerId: "agentide-tester" }, scope: ["*"], iat: 1, exp: 2 },
      TEST_SECRET,
      new (await import("./harness.js")).FakeClock(),
    );
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: META },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error?.code).toBe(-32001);
    expect(res.json.error?.message).toBe("GATEWAY_AUTH_FAILED");
    await stop();
  });

  it("Timeout path: handler exceeds handlerTimeoutMs -> isError:true result (not JSON-RPC error)", async () => {
    // handlerTimeoutMs=50 with a backendRuntime that never resolves. Use a real
    // system clock so setTimeout actually fires (the FakeClock is a no-op for
    // the kernel timeout race) and the token is not expired vs real time.
    const systemClock = new SystemClock();
    const fs = new InMemoryFs();
    fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
    const bus = createEventBus();
    const registry: CapabilityRegistry = createCapabilityRegistry(bus);
    const sm: SessionManager = createSessionManager(bus, { clock: systemClock });
    const pm: PluginManager = await createPluginManager(bus, registry, { fs, clock: systemClock, installRecordPath: "/data/installed-plugins.json" });
    registry.register("backend-sdk-customer-app", { owner: "backend-sdk-customer-app", capabilities: [customerReadCard()] });
    const neverSdk = makeNeverSdk();
    const gateway = await createGateway(bus, registry, sm, pm, {
      fs, clock: systemClock, auditLogPath: "/data/audit.log", tenantsPath: "/data/tenants.json", secretPath: "/data/gateway-secret", backendRuntime: neverSdk, handlerTimeoutMs: 50,
    });
    await gateway.createTenant({ id: "default", name: "Default Test Tenant" });
    const adapter = createMcpAdapter(gateway, { host: "127.0.0.1", port: 0 });
    await adapter.start();
    track(adapter);
    const sessionId = sm.create({ ownerId: "agentide-tester", adapterType: "mcp" }).id;
    const token = issueToken(
      { sub: { tenantId: "default", callerId: "agentide-tester" }, scope: ["customer.read"], iat: systemClock.now(), exp: systemClock.now() + 3_600_000 },
      TEST_SECRET,
      systemClock,
    );
    const res = await rpc(adapter, JSON.stringify({
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "customer.read", arguments: { id: "c-042" }, _meta: { ...META, "dev.agentide/sessionId": sessionId } },
    }), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    expect(res.json.result?.isError).toBe(true);
    expect(res.json.result?.content?.[0]?.text).toMatch(/exceeded/i);
  }, 15_000);

  it("lifecycle: stop is idempotent and releases the port", async () => {
    const { adapter, stop } = await start();
    await stop();
    await stop();
    await expect(fetch(`http://127.0.0.1:${adapter.port}/mcp`)).rejects.toThrow();
  });

  it("lifecycle: port is exposed on the handle and stays null before start()", async () => {
    // build without calling start; the factory should not have bound a port yet
    const fs = new InMemoryFs();
    fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
    const bus = createEventBus();
    const registry: CapabilityRegistry = createCapabilityRegistry(bus);
    const sm: SessionManager = createSessionManager(bus, { clock: new (await import("./harness.js")).FakeClock() });
    const pm: PluginManager = await createPluginManager(bus, registry, { fs, clock: new (await import("./harness.js")).FakeClock(), installRecordPath: "/data/installed-plugins.json" });
    const gw = await createGateway(bus, registry, sm, pm, { fs, clock: new (await import("./harness.js")).FakeClock(), auditLogPath: "/data/audit.log", tenantsPath: "/data/tenants.json", secretPath: "/data/gateway-secret" });
    const a = createMcpAdapter(gw, { host: "127.0.0.1", port: 0 });
    expect(a.port).toBeNull();
  });
});

describe("createMcpAdapter — error code constants sanity", () => {
  it("references the same HANDLER_TIMEOUT code the kernel emits", () => {
    // Guard against accidental rename: scenarios.test.ts reads this code path.
    expect(ERROR_CODES.HANDLER_TIMEOUT).toBe("GATEWAY_HANDLER_TIMEOUT");
  });
});
