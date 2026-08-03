import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";
import { createEventBus, type EventBus } from "@platform/event-bus";
import {
  issueToken,
  type CanonicalInvocation,
  type CanonicalResponse,
  type Clock,
  type Gateway,
  type YamlValue,
} from "@platform/gateway-core";
import { createWebSocketAdapter, type WebSocketAdapter } from "../index.js";

const SECRET = new TextEncoder().encode("server-test-secret");
type Frame = { readonly [key: string]: YamlValue };

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(callback: () => void, delayMs: number): number { return setTimeout(callback, delayMs) as unknown as number; }
  clearTimeout(handle: number): void { clearTimeout(handle); }
}

function gateway(handler?: (request: CanonicalInvocation) => Promise<CanonicalResponse>): Gateway {
  return {
    listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
    handleInvocation: handler ?? (async () => ({ output: { status: "ok" } })),
  } as unknown as Gateway;
}

function token(clock: TestClock, options: { origin?: string; scope?: readonly string[] } = {}): string {
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope: options.scope ?? ["platform.*.read"],
    ...(options.origin === undefined ? {} : { expectedOrigins: [options.origin] }),
    iat: clock.now(),
    exp: clock.now() + 60_000,
  }, SECRET, clock);
}

async function startAdapter(
  bus: EventBus,
  gatewayValue: Gateway = gateway(),
  overrides: Partial<Parameters<typeof createWebSocketAdapter>[2]> = {},
): Promise<WebSocketAdapter> {
  const adapter = createWebSocketAdapter(gatewayValue, bus, {
    tokenSecret: SECRET,
    port: 0,
    clock: new TestClock(),
    ...overrides,
  });
  await adapter.start();
  return adapter;
}

async function openSocket(adapter: WebSocketAdapter, origin?: string): Promise<WebSocket> {
  const address = adapter.address();
  if (!address) throw new Error("adapter has no address");
  const options = origin === undefined ? undefined : { headers: { origin } };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, options);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

function nextMessage(socket: WebSocket, timeoutMs = 1000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Frame);
    });
  });
}

function nextMessages(socket: WebSocket, count: number, timeoutMs = 1000): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("message timeout"));
    }, timeoutMs);
    const onMessage = (raw: RawData): void => {
      frames.push(JSON.parse(raw.toString()) as Frame);
      if (frames.length !== count) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(frames);
    };
    socket.on("message", onMessage);
  });
}

function nextClose(socket: WebSocket): Promise<number> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
  return new Promise((resolve) => socket.once("close", (code) => resolve(code)));
}

async function authenticate(socket: WebSocket, clock: TestClock, origin?: string, scope?: readonly string[]): Promise<Frame> {
  socket.send(JSON.stringify({ type: "auth", token: token(clock, { origin, scope }) }));
  return nextMessage(socket);
}

describe("WebSocket adapter server", () => {
  let adapter: WebSocketAdapter | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    await adapter?.stop();
    adapter = undefined;
  });

  it("authenticates a browser connection and exposes its bound address", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter, "https://app.acme.com");
    sockets.push(socket);
    const frame = await authenticate(socket, new TestClock(), "https://app.acme.com");
    expect(frame.type).toBe("auth.ok");
    expect(adapter.connectionCount()).toBe(1);
  });

  it("drops non-auth frames before authentication", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    socket.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
    socket.send(JSON.stringify({ type: "auth", token: token(clock) }));
    expect((await nextMessage(socket)).type).toBe("auth.ok");
    await expect(nextMessage(socket, 80)).rejects.toThrow("message timeout");
  });

  it("denies a browser token without an origin claim", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter, "https://app.acme.com");
    sockets.push(socket);
    const clock = new TestClock();
    socket.send(JSON.stringify({ type: "auth", token: token(clock) }));
    expect(await nextMessage(socket)).toMatchObject({ type: "auth.error", code: "origin mismatch" });
    expect(await nextClose(socket)).toBe(1008);
  });

  it("allows a node token without an Origin header", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    expect((await authenticate(socket, new TestClock())).type).toBe("auth.ok");
  });

  it("refreshes claims in place and keeps subscriptions", async () => {
    const bus = createEventBus();
    const rotated: Frame[] = [];
    bus.subscribe("event.connection.rotated", (event) => { rotated.push(event.payload as Frame); });
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter, "https://app.acme.com");
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock, "https://app.acme.com")).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
    expect((await nextMessage(socket)).type).toBe("subscribe.ok");
    socket.send(JSON.stringify({ type: "auth", token: token(clock, { origin: "https://app.acme.com" }) }));
    expect((await nextMessage(socket)).type).toBe("auth.ok");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rotated).toHaveLength(1);
    await bus.publish("session.created", { id: "s1" });
    expect((await nextMessage(socket)).type).toBe("event");
  });

  it("closes the socket on a refresh failure (PRD Scenario 5 close path)", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock)).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "auth", token: "not-a-jwt" }));
    expect(await nextMessage(socket)).toMatchObject({ type: "auth.error", code: "token invalid" });
    expect(await nextClose(socket)).toBe(1008);
  });

  it("enforces subscription authorization and all-or-nothing batches", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock, undefined, ["platform.session.read"])).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "subscribe", topics: ["session.*", "plugin.*"] }));
    expect(await nextMessage(socket)).toMatchObject({ type: "subscribe.error", code: "WS_FORBIDDEN" });
    await bus.publish("session.created", { id: "s1" });
    await expect(nextMessage(socket, 80)).rejects.toThrow("message timeout");
  });

  it("fans out events and removes them after unsubscribe", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock)).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "subscribe", topics: ["session.*"] }));
    expect((await nextMessage(socket)).type).toBe("subscribe.ok");
    await bus.publish("session.created", { id: "s1" });
    expect((await nextMessage(socket)).type).toBe("event");
    socket.send(JSON.stringify({ type: "unsubscribe", topics: ["session.*", "never.*"] }));
    expect((await nextMessage(socket)).type).toBe("unsubscribe.ok");
    await bus.publish("session.resumed", { id: "s1" });
    await expect(nextMessage(socket, 80)).rejects.toThrow("message timeout");
  });

  it("translates call, stream, and gateway error invocations", async () => {
    const bus = createEventBus();
    const handler = async (request: CanonicalInvocation): Promise<CanonicalResponse> => {
      if (request.capability.name === "bad") return { error: { code: "SESSION_NOT_FOUND", message: "missing", details: {}, retryable: false } };
      return { output: { name: request.capability.name } };
    };
    adapter = await startAdapter(bus, gateway(handler));
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock)).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "invoke", correlationId: "c1", name: "system.health" }));
    expect(await nextMessage(socket)).toMatchObject({ type: "invoke.result", correlationId: "c1" });
    const streamFrames = nextMessages(socket, 2);
    socket.send(JSON.stringify({ type: "invoke", correlationId: "c2", name: "system.health", mode: "stream" }));
    const [partial, end] = await streamFrames;
    expect(partial).toMatchObject({ type: "invoke.partial", correlationId: "c2" });
    expect(end).toEqual({ type: "invoke.end", correlationId: "c2" });
    socket.send(JSON.stringify({ type: "invoke", correlationId: "c3", name: "bad" }));
    expect(await nextMessage(socket)).toMatchObject({ type: "invoke.error", correlationId: "c3", code: "SESSION_NOT_FOUND" });
  });

  it("closes unauthenticated connections after the pre-auth timeout", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus, gateway(), { preAuthTimeoutMs: 20 });
    const socket = await openSocket(adapter);
    sockets.push(socket);
    expect(await nextClose(socket)).toBe(1008);
  });

  it("enforces inbound and outbound frame caps with close code 1009", async () => {
    const bus = createEventBus();
    const largeGateway = gateway(async () => ({ output: { value: "x".repeat(2000) } }));
    adapter = await startAdapter(bus, largeGateway, { maxFrameBytes: 512 });
    const socket = await openSocket(adapter);
    sockets.push(socket);
    const clock = new TestClock();
    expect((await authenticate(socket, clock)).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "invoke", correlationId: "large", name: "large.output" }));
    expect(await nextMessage(socket)).toMatchObject({ type: "error", code: "WS_FRAME_TOO_LARGE" });
    expect(await nextClose(socket)).toBe(1009);

    await adapter.stop();
    adapter = await startAdapter(bus, gateway(), { maxFrameBytes: 512 });
    const inbound = await openSocket(adapter);
    sockets.push(inbound);
    expect((await authenticate(inbound, clock)).type).toBe("auth.ok");
    inbound.send(JSON.stringify({ type: "subscribe", topics: ["x".repeat(1000)] }));
    expect(await nextClose(inbound)).toBe(1009);
  });

  it("closes a client that does not answer protocol pings", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus, gateway(), {
      heartbeatIntervalMs: 20,
      heartbeatTimeoutMs: 20,
    });
    const address = adapter.address();
    if (!address) throw new Error("adapter has no address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { autoPong: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    expect((await authenticate(socket, new TestClock())).type).toBe("auth.ok");
    expect(await nextClose(socket)).toBe(1011);
  });

  it("stops cleanly and releases the bound address", async () => {
    const bus = createEventBus();
    adapter = await startAdapter(bus);
    const socket = await openSocket(adapter);
    sockets.push(socket);
    expect(adapter.address()).not.toBeNull();
    await adapter.stop();
    expect(adapter.address()).toBeNull();
    expect(adapter.connectionCount()).toBe(0);
  });
});
