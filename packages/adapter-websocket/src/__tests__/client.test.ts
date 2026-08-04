// Phase 6a — createWsClient integration tests against a real adapter.
// Reuses the server.test.ts harness pattern (port 0 + TestClock + issueToken).
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus, type EventBus } from "@spanexx/event-bus";
import {
  issueToken,
  type CanonicalInvocation,
  type CanonicalResponse,
  type Clock,
  type Gateway,
  type YamlValue,
} from "@spanexx/gateway-core";
import { createWebSocketAdapter, type WebSocketAdapter } from "../index.js";
import { createWsClient, WsInvokeError } from "../client.js";

const SECRET = new TextEncoder().encode("client-test-secret");
const adapters: WebSocketAdapter[] = [];

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

function token(clock: TestClock, scope: readonly string[] = ["platform.*.read"]): string {
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope,
    iat: clock.now(),
    exp: clock.now() + 60_000,
  }, SECRET, clock);
}

async function startAdapter(
  bus: EventBus,
  gatewayValue: Gateway = gateway(),
): Promise<WebSocketAdapter> {
  const adapter = createWebSocketAdapter(gatewayValue, bus, {
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

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.stop()));
});

describe("createWsClient: connect + auth (S2/S4)", () => {
  it("open() resolves on auth.ok and state becomes open", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    expect(client.state).toBe("open");
    await client.close();
  });

  it("bad token → open() rejects with auth failure", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({ url: url(adapter), token: "not-a-jwt" });
    await expect(client.open()).rejects.toThrow(/token invalid|1008/);
    await client.close();
  });

  it("invoke before open → rejects", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await expect(client.invoke("gateway.status")).rejects.toThrow(/not connected/);
    await client.close();
  });
});

describe("createWsClient: invoke (S1)", () => {
  it("invoke.result → resolves with output", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({ output: { tenants: 1 } })));
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    await expect(client.invoke("system.status")).resolves.toEqual({ tenants: 1 });
    await client.close();
  });

  it("passes input + sessionId through to the gateway", async () => {
    const seen: CanonicalInvocation[] = [];
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async (req) => {
      seen.push(req);
      return { output: { ok: true } };
    }));
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    await client.invoke("product.list", { input: { page: 2 }, sessionId: "s-9" });
    expect(seen[0].input).toEqual({ page: 2 });
    expect(seen[0].sessionId).toBe("s-9");
    await client.close();
  });

  it("invoke.error → rejects with WsInvokeError carrying code + message verbatim", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      error: { code: "GATEWAY_INTERNAL_ERROR", message: "boom", details: {}, retryable: false },
    })));
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    const failure = await client.invoke("product.list").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(WsInvokeError);
    expect((failure as WsInvokeError).code).toBe("GATEWAY_INTERNAL_ERROR");
    expect((failure as WsInvokeError).message).toBe("boom");
    await client.close();
  });
});

describe("createWsClient: subscribe + events (S7)", () => {
  it("subscribe resolves on subscribe.ok", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    await expect(client.subscribe(["session.*"])).resolves.toBeUndefined();
    await client.close();
  });

  it("onEvent receives event frames published on the bus", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    await client.subscribe(["session.*"]);
    const events: YamlValue[] = [];
    client.onEvent((event) => events.push(event.payload));
    await bus.publish("session.started", { sessionId: "s-1" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ sessionId: "s-1" });
    await client.close();
  });

  it("close() resolves pending invokes with a connection-closed error", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => {
      await new Promise(() => { /* never resolves */ });
      return { output: {} };
    }));
    const client = createWsClient({ url: url(adapter), token: token(new TestClock()) });
    await client.open();
    const pending = client.invoke("product.list");
    // attach the rejection handler BEFORE close() so the rejection is handled
    // the moment it fires (Node flags unhandled rejections eagerly)
    const assertion = expect(pending).rejects.toThrow(/closed/);
    await client.close();
    await assertion;
    expect(client.state).toBe("closed");
  });
});
