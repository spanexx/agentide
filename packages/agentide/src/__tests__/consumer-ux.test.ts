// Phase 3 + 4 + 5: consumer UX tests (GRILL-cli-consumer-ux Q1, Q2, Q3)
//   - wrong-door message when the WS server doesn't send auth.ok
//   - auto-mint session for invoke when --session is omitted
//   - supplied --session is reused, no auto-mint
//   - watch auto-mints + destroys on clean exit
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
import {
  createWebSocketAdapter,
  type WebSocketAdapter,
} from "@spanexx/adapter-websocket";
import { runConsumer } from "../consumer.js";

const SECRET = new TextEncoder().encode("consumer-ux-secret");
const adapters: WebSocketAdapter[] = [];
const inertServers: WebSocketServer[] = [];

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(callback: () => void, delayMs: number): number { return setTimeout(callback, delayMs) as unknown as number; }
  clearTimeout(handle: number): void { clearTimeout(handle); }
}

// Helper to type a handler returning arbitrary {output: ...} responses.
function handler(impl: (req: CanonicalInvocation) => unknown): (req: CanonicalInvocation) => Promise<CanonicalResponse> {
  return async (req) => impl(req) as Promise<CanonicalResponse>;
}

function token(clock: TestClock = new TestClock()): string {
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope: ["*"],
    iat: clock.now(),
    exp: clock.now() + 60_000,
  }, SECRET, clock);
}

function gateway(handler: (request: CanonicalInvocation) => Promise<CanonicalResponse>): Gateway {
  return {
    listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
    handleInvocation: handler,
  } as unknown as Gateway;
}

async function startAdapter(bus: EventBus, handler: (req: CanonicalInvocation) => Promise<CanonicalResponse>): Promise<WebSocketAdapter> {
  const adapter = createWebSocketAdapter(gateway(handler), bus, {
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

// Inert server: completes WS upgrade but never sends auth.ok.
// Mirrors the SDK door (silent-ignore on the consumer auth frame).
async function startInertServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  inertServers.push(wss);
  wss.on("connection", (ws: WsSocket) => {
    ws.on("message", () => { /* silent */ });
  });
  const port = (wss.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    close: () => new Promise<void>((r) => {
      // Terminate any clients that don't close cleanly (the inert server
      // doesn't respond to WS close frames, so the close handshake can hang).
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* already closed */ }
      }
      wss.close(() => r());
    }),
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

describe("consumer-ux: wrong-door (Q2)", () => {
  it("emits the locked wrong-door message and exits 2", async () => {
    const inert = await startInertServer();
    const res = await runConsumer(
      ["sessions", "--url", inert.url, "--token", token()],
      { env: {}, isTTY: true, authTimeoutMs: 200 },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("SDK door");
    expect(res.stderr).toContain("websocket adapter");
    expect(res.stderr).toContain("ws://...:7300/ws");
  });

  it("url without port → defaults to 7300, then succeeds against adapter on 7300", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, handler(async () => ({ output: [] })));
    const port = (adapter.address() as { port: number }).port;
    const urlNoPort = `ws://127.0.0.1/ws`; // CPU author: defaults port to 7300
    // The adapter binds a real port; rewrite the bound port into the URL if
    // it isn't 7300 by using PLATFORM_GATEWAY_URL with the right host.
    // This test only verifies that `applyPortDefault` was applied: the
    // request arrives at the adapter. We override the host to hit a
    // server we know is on 7300 by spinning up a separate adapter on 7300.
    const fixedAdapter = createWebSocketAdapter(gateway(handler(async () => ({ output: [] }))), createEventBus(), {
      tokenSecret: SECRET, port: 7300, clock: new TestClock(),
    });
    await fixedAdapter.start();
    adapters.push(fixedAdapter);
    const ok = await runConsumer(
      ["sessions", "--url", urlNoPort, "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(ok.exitCode).toBe(0);
    // The adapter we created just to test 7300 is no longer needed; the
    // original `port` variable is unused but kept for legibility.
    void port;
  });
});

describe("consumer-ux: session auto-mint (Q1)", () => {
  it("invoke without --session auto-mints, invokes, destroys", async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const adapter = await startAdapter(bus, handler(async (req) => {
      seen.push(req.capability.name);
      if (req.capability.name === "session.create") return { output: { id: "sess-test-1" } };
      if (req.capability.name === "session.destroy") return { output: {} };
      if (req.capability.name === "product.list") return { output: { items: [{ id: "p1", name: "Hammer" }] } };
      return { output: null };
    }));
    const res = await runConsumer(
      ["invoke", "product.list", "--args", "{}", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(seen).toContain("session.create");
    expect(seen).toContain("product.list");
    expect(seen).toContain("session.destroy");
    // The product.list invoke must have used the auto-minted session id.
    expect(res.stdout).toContain("Hammer");
  });

  it("invoke with --session supplied reuses the id and does NOT destroy", async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const adapter = await startAdapter(bus, handler(async (req) => {
      seen.push(req.capability.name);
      if (req.capability.name === "session.create") return { output: { id: "sess-should-not-appear" } };
      if (req.capability.name === "session.destroy") return { output: {} };
      if (req.capability.name === "product.list") return { output: { items: [] } };
      return { output: null };
    }));
    const res = await runConsumer(
      ["invoke", "product.list", "--args", "{}", "--session", "sess-operator-supplied", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(seen).not.toContain("session.create");
    expect(seen).not.toContain("session.destroy");
    expect(seen).toContain("product.list");
  });
});

describe("consumer-ux: watch lifecycle (Q3)", () => {
  it("watch auto-mints, then destroys on clean exit", async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const adapter = await startAdapter(bus, handler(async (req) => {
      seen.push(req.capability.name);
      if (req.capability.name === "session.create") return { output: { id: "sess-watch-1" } };
      if (req.capability.name === "session.destroy") return { output: {} };
      if (req.capability.name === "session.list") return { output: [] };
      return { output: null };
    }));
    // Wire the signal handler so it fires after the watch loop is set up.
    // The handler resolves the inner `done` promise; runConsumer then
    // returns and the test continues.
    const consumerPromise = runConsumer(
      ["watch", "sessions", "--url", url(adapter), "--token", token()],
      {
        env: {},
        isTTY: true,
        onSignal: (handler) => {
          // Fire the handler after the watch loop wires the event listeners.
          setTimeout(handler, 200);
          return () => {};
        },
      },
    );
    const res = await consumerPromise;
    expect(res.exitCode).toBe(5); // ExitCode.Interrupted
    // The watch must have auto-minted and then destroyed the session.
    expect(seen).toContain("session.create");
    expect(seen).toContain("session.list");
    expect(seen).toContain("session.destroy");
  });
});
