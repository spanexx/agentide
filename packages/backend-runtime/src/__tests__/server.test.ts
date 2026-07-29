/*
 * Code Map: Phase 2 server integration tests
 * - bad token: socket closed without accepted event
 * - valid token: accepted event with correct appId (from JWT sub.callerId)
 * - replace: second SDK with same appId closes first socket, emits closed/explicit
 * - peer drop: SDK-side close without server init -> closed reason 'dropped'
 * - stop(): all sockets closed, closed reason 'explicit' emitted per appId
 * - latencyMs: clock advance between connection open and sdk.auth = latency
 * - address(): returns bound address after start, null after stop
 * - buffered non-auth messages: ignored (sdk.auth must come first)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { createEventBus, type EventBus } from "@platform/event-bus";
import { createCapabilityRegistry, type CapabilityRegistry } from "@platform/capability-registry";
import { createBackendRuntime } from "../index.js";
import type { BackendRuntime, Clock } from "../types.js";
import { secretFrom, mintToken } from "./jwt-helper.js";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void { /* noop */ }
  advance(ms: number): void { this.nowValue += ms; }
}

interface ConnectionAcceptedPayload {
  appId: string;
  gatewayUrl: string;
  latencyMs: number;
}
interface ConnectionClosedPayload {
  appId: string;
  reason: "explicit" | "dropped";
}

function collectEvents(bus: EventBus): {
  accepted: ConnectionAcceptedPayload[];
  closed: ConnectionClosedPayload[];
} {
  const accepted: ConnectionAcceptedPayload[] = [];
  const closed: ConnectionClosedPayload[] = [];
  bus.subscribe("sdk.connection.*", (event) => {
    const payload = JSON.parse(JSON.stringify(event.payload));
    if (event.name === "sdk.connection.accepted") accepted.push(payload);
    if (event.name === "sdk.connection.closed") closed.push(payload);
  });
  return { accepted, closed };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!predicate()) throw new Error("waitFor timed out");
}

async function waitForSocketClose(ws: WebSocket, timeoutMs = 1000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket close timed out")), timeoutMs);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("Phase 2: server lifecycle", () => {
  let bus: EventBus;
  let clock: FakeClock;
  let secret: Uint8Array;
  let registry: CapabilityRegistry;
  let runtime: BackendRuntime;
  let port: number;

  beforeEach(async () => {
    bus = createEventBus();
    clock = new FakeClock();
    secret = secretFrom("test-1");
    registry = createCapabilityRegistry(bus);
    runtime = createBackendRuntime({
      port: 0,
      tokenSecret: secret,
      eventBus: bus,
      capabilityRegistry: registry,
      clock,
    });
    await runtime.start();
    const addr = runtime.address();
    if (!addr) throw new Error("runtime.address() returned null after start()");
    port = addr.port;
  });

  afterEach(async () => {
    await runtime.stop();
  });

  function wsUrl(): string { return `ws://127.0.0.1:${port}`; }

  it("address() returns the bound port after start, null after stop", async () => {
    expect(runtime.address()).not.toBeNull();
    await runtime.stop();
    expect(runtime.address()).toBeNull();
  });

  it("rejects a bad token: socket closes, no accepted event", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve, reject) => {
      sock.once("open", () => {
        sock.send(JSON.stringify({ type: "sdk.auth", token: "not-a-jwt" }));
        resolve();
      });
      sock.once("close", () => resolve());
      sock.once("error", () => resolve());
      setTimeout(() => reject(new Error("timeout")), 1000);
    });
    await waitFor(() => sock.readyState === WebSocket.CLOSED, 500);
    expect(events.accepted).toHaveLength(0);
    expect(runtime.connectionCount()).toBe(0);
  });

  it("accepts a valid token: emits accepted with correct appId from sub.callerId", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    const token = mintToken({ tenantId: "acme", callerId: "customer-app" }, secret, clock);
    sock.send(JSON.stringify({ type: "sdk.auth", token }));

    await waitFor(() => events.accepted.length === 1, 1000);
    expect(events.accepted[0]).toMatchObject({
      appId: "customer-app",
      gatewayUrl: wsUrl(),
    });
    expect(typeof events.accepted[0].latencyMs).toBe("number");
    expect(runtime.connectionCount()).toBe(1);

    sock.close();
  });

  it("replaces an existing connection when a second SDK connects with the same appId", async () => {
    const events = collectEvents(bus);
    // First SDK
    const sock1 = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock1.once("open", () => resolve()));
    sock1.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "customer-app" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 1, 1000);

    // Second SDK with same appId
    const sock2 = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock2.once("open", () => resolve()));
    sock2.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "customer-app" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 2, 1000);

    // First socket is closed by server; registry has only the new socket
    await waitFor(() => sock1.readyState === WebSocket.CLOSED, 1000);
    expect(runtime.connectionCount()).toBe(1);
    // The first socket is closed (server-initiated replacement), so no 'dropped' event is emitted for it
    expect(events.closed.filter((c) => c.reason === "dropped")).toHaveLength(0);

    sock2.close();
  });

  it("emits 'dropped' when an SDK closes its socket without server-initiated stop", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    sock.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "ephemeral-app" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 1, 1000);

    // SDK initiates close
    sock.close();
    await waitFor(() => events.closed.length === 1, 1000);
    expect(events.closed[0]).toEqual({ appId: "ephemeral-app", reason: "dropped" });
    expect(runtime.connectionCount()).toBe(0);
  });

  it("emits 'explicit' for every connection when stop() is called", async () => {
    const events = collectEvents(bus);
    const sock1 = new WebSocket(wsUrl());
    const sock2 = new WebSocket(wsUrl());
    await Promise.all([
      new Promise<void>((r) => sock1.once("open", () => r())),
      new Promise<void>((r) => sock2.once("open", () => r())),
    ]);
    sock1.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "app-1" }, secret, clock) }));
    sock2.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "app-2" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 2, 1000);

    await runtime.stop();
    await waitFor(() => events.closed.length === 2, 1000);
    expect(events.closed.sort((a, b) => a.appId.localeCompare(b.appId))).toEqual([
      { appId: "app-1", reason: "explicit" },
      { appId: "app-2", reason: "explicit" },
    ]);
  });

  it("computes latencyMs from clock.now() at auth-accept time", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    clock.advance(123);
    sock.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "timing-app" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 1, 1000);
    expect(events.accepted[0].latencyMs).toBe(123);

    sock.close();
  });

  it("ignores messages received before sdk.auth (does not crash, no accepted event)", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    // Send a bogus message first
    sock.send(JSON.stringify({ type: "sdk.invoke", callId: "x", name: "y", input: null }));
    // Wait a beat
    await new Promise((r) => setTimeout(r, 100));
    // Now send real auth
    sock.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: "patient-app" }, secret, clock) }));
    await waitFor(() => events.accepted.length === 1, 1000);
    expect(events.accepted[0].appId).toBe("patient-app");
    expect(runtime.connectionCount()).toBe(1);

    sock.close();
  });

  it("rejects an expired token without emitting accepted", async () => {
    const events = collectEvents(bus);
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    const expiredToken = mintToken({ tenantId: "acme", callerId: "stale", exp: clock.now() - 1 }, secret, clock);
    sock.send(JSON.stringify({ type: "sdk.auth", token: expiredToken }));
    await waitForSocketClose(sock);
    expect(events.accepted).toHaveLength(0);
    expect(runtime.connectionCount()).toBe(0);
  });
});

describe("Phase 3: capability registration bridge", () => {
  let bus: EventBus;
  let clock: FakeClock;
  let secret: Uint8Array;
  let registry: CapabilityRegistry;
  let runtime: BackendRuntime;
  let port: number;

  beforeEach(async () => {
    bus = createEventBus();
    clock = new FakeClock();
    secret = secretFrom("test-1");
    registry = createCapabilityRegistry(bus);
    runtime = createBackendRuntime({
      port: 0,
      tokenSecret: secret,
      eventBus: bus,
      capabilityRegistry: registry,
      clock,
    });
    await runtime.start();
    const addr = runtime.address();
    if (!addr) throw new Error("runtime.address() returned null after start()");
    port = addr.port;
  });

  afterEach(async () => {
    await runtime.stop();
  });

  function wsUrl(): string { return `ws://127.0.0.1:${port}`; }

  async function connectAndAuth(appId: string, events: ReturnType<typeof collectEvents>): Promise<WebSocket> {
    const sock = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    sock.send(JSON.stringify({ type: "sdk.auth", token: mintToken({ tenantId: "acme", callerId: appId }, secret, clock) }));
    await waitFor(() => events.accepted.length === 1, 1000);
    return sock;
  }

  function registerMessage(name: string, opts: { permissions?: string; tier?: string } = {}): string {
    return JSON.stringify({
      type: "sdk.capability.register",
      name,
      description: `${name} handler`,
      version: "1.0.0",
      permissions: opts.permissions ?? "customer.read",
      tier: opts.tier ?? "",
    });
  }

  it("registers 3 caps from the SDK and they appear in the registry under owner=backend-sdk-<appId>", async () => {
    const events = collectEvents(bus);
    const sock = await connectAndAuth("cap-app", events);
    for (const name of ["customer.read", "customer.delete", "customer.list"]) {
      sock.send(registerMessage(name));
      await waitFor(() => registry.describe(name).capability !== null, 1000);
    }
    const records = [
      registry.describe("customer.read").capability,
      registry.describe("customer.delete").capability,
      registry.describe("customer.list").capability,
    ];
    expect(records.map((r) => r?.owner)).toEqual([
      "backend-sdk-cap-app",
      "backend-sdk-cap-app",
      "backend-sdk-cap-app",
    ]);
    sock.close();
  });

  it("splits comma-joined permissions into an array on register", async () => {
    const events = collectEvents(bus);
    const sock = await connectAndAuth("split-app", events);
    sock.send(registerMessage("customer.combo", { permissions: "customer.read,customer.write,customer.delete" }));
    await waitFor(() => registry.describe("customer.combo").capability !== null, 1000);
    const record = registry.describe("customer.combo").capability;
    expect(record?.permissions).toEqual(["customer.read", "customer.write", "customer.delete"]);
    sock.close();
  });

  it("business caps always have tier=null in the registry regardless of what the SDK sends", async () => {
    const events = collectEvents(bus);
    const sock = await connectAndAuth("tier-app", events);
    sock.send(registerMessage("cap.empty", { tier: "" }));
    sock.send(registerMessage("cap.act", { tier: "act" }));
    sock.send(registerMessage("cap.destructive", { tier: "destructive" }));
    await waitFor(() =>
      registry.describe("cap.empty").capability !== null &&
      registry.describe("cap.act").capability !== null &&
      registry.describe("cap.destructive").capability !== null,
      1000,
    );
    // Business caps MUST have tier=null per BI[7]; the Backend Runtime ignores
    // whatever tier the SDK sent and forces null so the registry validates them.
    expect(registry.describe("cap.empty").capability?.tier).toBeNull();
    expect(registry.describe("cap.act").capability?.tier).toBeNull();
    expect(registry.describe("cap.destructive").capability?.tier).toBeNull();
    sock.close();
  });

  it("removes the appId's caps from the registry when the socket closes (peer drop)", async () => {
    const events = collectEvents(bus);
    const sock = await connectAndAuth("disco-app", events);
    sock.send(registerMessage("cap.a"));
    sock.send(registerMessage("cap.b"));
    await waitFor(() =>
      registry.describe("cap.a").capability !== null &&
      registry.describe("cap.b").capability !== null,
      1000,
    );

    sock.close();
    await waitFor(() => registry.describe("cap.a").capability === null, 1000);
    expect(registry.describe("cap.b").capability).toBeNull();
    expect(runtime.connectionCount()).toBe(0);
  });

  it("removes the appId's caps when stop() is called", async () => {
    const events = collectEvents(bus);
    const sock = await connectAndAuth("stop-app", events);
    sock.send(registerMessage("cap.a"));
    await waitFor(() => registry.describe("cap.a").capability !== null, 1000);

    await runtime.stop();
    expect(registry.describe("cap.a").capability).toBeNull();
  });

  it("reconnect with the same appId atomically replaces prior caps (no duplicates)", async () => {
    const events = collectEvents(bus);
    const sock1 = await connectAndAuth("reconn-app", events);
    sock1.send(registerMessage("v1.cap"));
    await waitFor(() => registry.describe("v1.cap").capability !== null, 1000);

    const sock2 = await connectAndAuth("reconn-app", events);
    sock2.send(registerMessage("v2.cap1"));
    sock2.send(registerMessage("v2.cap2"));
    await waitFor(() =>
      registry.describe("v2.cap1").capability !== null &&
      registry.describe("v2.cap2").capability !== null,
      1000,
    );

    expect(registry.describe("v1.cap").capability).toBeNull();
    expect(registry.describe("v2.cap1").capability?.owner).toBe("backend-sdk-reconn-app");
    expect(registry.describe("v2.cap2").capability?.owner).toBe("backend-sdk-reconn-app");
    sock1.close();
    sock2.close();
  });
});