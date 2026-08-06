// Phase 2: WS client handshake timeout + WsDoorMismatchError (GRILL-cli-consumer-ux Q2)
// Behavior: when the WS upgrade succeeds but the server doesn't send auth.ok
//   within authTimeoutMs, client.open() rejects with WsDoorMismatchError.
//   The user-facing case: pointing the CLI at the SDK door (which silently
//   ignores `{type:"auth"}` frames) used to hang forever. Now it errors fast.
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus, type EventBus } from "@spanexx/event-bus";
import {
  issueToken,
  type CanonicalInvocation,
  type CanonicalResponse,
  type Clock,
  type Gateway,
} from "@spanexx/gateway-core";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { createWebSocketAdapter, type WebSocketAdapter } from "../index.js";
import { createWsClient, WsDoorMismatchError } from "../client.js";

const SECRET = new TextEncoder().encode("client-timeout-secret");
const adapters: WebSocketAdapter[] = [];
const inertServers: WebSocketServer[] = [];

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(callback: () => void, delayMs: number): number { return setTimeout(callback, delayMs) as unknown as number; }
  clearTimeout(handle: number): void { clearTimeout(handle); }
}

function token(clock: TestClock): string {
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope: ["platform.*.read"],
    iat: clock.now(),
    exp: clock.now() + 60_000,
  }, SECRET, clock);
}

function gateway(handler?: (request: CanonicalInvocation) => Promise<CanonicalResponse>): Gateway {
  return {
    listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
    handleInvocation: handler ?? (async () => ({ output: { status: "ok" } })),
  } as unknown as Gateway;
}

async function startAdapter(bus: EventBus): Promise<WebSocketAdapter> {
  const adapter = createWebSocketAdapter(gateway(), bus, {
    tokenSecret: SECRET,
    port: 0,
    clock: new TestClock(),
  });
  await adapter.start();
  adapters.push(adapter);
  return adapter;
}

function url(adapter: WebSocketAdapter): string {
  const address = adapter.address();
  if (!address) throw new Error("adapter has no address");
  return `ws://127.0.0.1:${address.port}/ws`;
}

// Inert server: completes the WS upgrade but never sends auth.ok.
// Mirrors the SDK door's behavior (silent-ignore on the consumer auth frame).
async function startInertServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  inertServers.push(wss);
  wss.on("connection", (ws: WsSocket) => {
    // Accept the connection. Read whatever the client sends (and discard it).
    ws.on("message", () => { /* silent — SDK door semantics */ });
    // No `auth.ok` ever sent.
  });
  const port = (wss.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    close: () => new Promise<void>((r) => wss.close(() => r())),
  };
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.stop()));
  for (const wss of inertServers.splice(0)) {
    await new Promise<void>((resolve) => {
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* already closed */ }
      }
      wss.close(() => resolve());
    });
  }
});

describe("WsClient authTimeout", () => {
  it("rejects with WsDoorMismatchError when auth.ok doesn't arrive", async () => {
    const inert = await startInertServer();
    const client = createWsClient({ url: inert.url, token: "tok", authTimeoutMs: 200 });
    await expect(client.open()).rejects.toBeInstanceOf(WsDoorMismatchError);
    await client.close();
  });

  it("WsDoorMismatchError carries code GATEWAY_DOOR_MISMATCH", async () => {
    const inert = await startInertServer();
    const client = createWsClient({ url: inert.url, token: "tok", authTimeoutMs: 100 });
    try {
      await client.open();
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(WsDoorMismatchError);
      expect((err as WsDoorMismatchError).code).toBe("GATEWAY_DOOR_MISMATCH");
    }
    await client.close();
  });

  it("accepts a happy-path response within the timeout", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({
      url: url(adapter),
      token: token(new TestClock()),
      authTimeoutMs: 1000,
    });
    await expect(client.open()).resolves.toBeUndefined();
    expect(client.state).toBe("open");
    await client.close();
  });
});
