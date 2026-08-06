// Phase 5/6b/7 — runConsumer against a real adapter with a scripted gateway.
// Failure surfaces (S8) map to exit codes; aliases/invoke/watch assert shapes.
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus, type EventBus } from "@spanexx/event-bus";
import {
  issueToken,
  type CanonicalInvocation,
  type CanonicalResponse,
  type Clock,
  type Gateway,
} from "@spanexx/gateway-core";
import { createWebSocketAdapter, type WebSocketAdapter } from "@spanexx/adapter-websocket";
import { runConsumer } from "../consumer.js";

const SECRET = new TextEncoder().encode("consumer-test-secret");
const adapters: WebSocketAdapter[] = [];

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(callback: () => void, delayMs: number): number { return setTimeout(callback, delayMs) as unknown as number; }
  clearTimeout(handle: number): void { clearTimeout(handle); }
}

function gateway(handler?: (request: CanonicalInvocation) => Promise<CanonicalResponse>): Gateway {
  const userHandler = handler;
  const h = async (req: CanonicalInvocation): Promise<CanonicalResponse> => {
    // CID:test-session-stub - tests that drive the consumer expect
    // session.create / session.destroy to be handled by the gateway stub
    // (the auto-mint path in runInvoke / runWatch always calls them).
    // The session id is deterministic per request so tests can assert on
    // it if needed.
    if (req.capability.name === "session.create") return { output: { id: "sess-stub" } };
    if (req.capability.name === "session.destroy") return { output: {} };
    if (userHandler) return userHandler(req);
    switch (req.capability.name) {
      case "session.create": return { output: { id: "sess-default" } };
      case "session.destroy": return { output: {} };
      case "session.list": return { output: [] };
      case "capability.list": return {
        output: [
          { name: "gateway.status", version: "1.0.0", type: "platform", description: "x", tier: "read" },
          { name: "product.list", version: "1.0.0", type: "business", description: "y", tier: null },
        ],
      };
      case "plugin.list": return { output: [{ id: "p-1", version: "1.0.0", enabled: true }] };
      case "gateway.status": return { output: { status: "ok", tenantCount: 1, pluginCount: 1, uptimeMs: 42 } };
      case "system.health": return { output: { status: "ok" } };
      default: return { output: { echoed: req.input ?? {} } };
    }
  };
  return {
    listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
    handleInvocation: h,
  } as unknown as Gateway;
}

function token(): string {
  const clock = new TestClock();
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope: ["platform.*.read"],
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
  adapters.push(adapter);
  return adapter;
}

function url(adapter: WebSocketAdapter): string {
  const address = adapter.address();
  if (!address) throw new Error("adapter has no address");
  return `ws://127.0.0.1:${address.port}/ws`;
}

function signalAfter(ms: number): (handler: () => void) => () => void {
  return (handler) => {
    const t = setTimeout(handler, ms);
    return () => clearTimeout(t);
  };
}

const TTY = { isTTY: true };
void TTY;

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.stop()));
});

describe("consumer: aliases (S2/S3)", () => {
  it("sessions → table ID/STATUS/CREATED, exit 0", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: [{ id: "s-1", status: "active", createdAt: 1700000000000 }],
    })));
    const res = await runConsumer(
      ["sessions", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/ID\s+STATUS\s+CREATED/);
    expect(res.stdout).toMatch(/s-1\s+active\s+1700000000000/);
  });

  it("capabilities → table NAME/VERSION/TIER", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["capabilities", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/NAME\s+VERSION\s+TIER/);
    expect(res.stdout).toMatch(/gateway\.status\s+1\.0\.0\s+read/);
  });

  // Regression (2026-08-06): the capabilities alias invoked capability.list
  // with NO input; the gateway defensively returns [] for empty scope
  // (BI[7]), so `agentide capabilities` showed an empty catalog even when
  // caps were registered. The alias must pass the operator view scope.
  it("capabilities alias passes operator scope ['*'] to capability.list", async () => {
    const bus = createEventBus();
    let seen: unknown;
    const adapter = await startAdapter(bus, gateway(async (req) => {
      seen = req.input;
      return { output: [] };
    }));
    const res = await runConsumer(
      ["capabilities", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(seen).toEqual({ scope: ["*"] });
  });

  it("status alias → key:value, exit 0", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["status", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("status: ok\ntenantCount: 1\npluginCount: 1\nuptimeMs: 42");
  });

  it("plugins alias → table ID/VERSION/STATUS with enabled status", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["plugins", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/p-1\s+1\.0\.0\s+enabled/);
  });

  it("capability list (remote form) → capabilities alias", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["capability", "list", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/NAME\s+VERSION\s+TIER/);
  });

  it("--json alias → compact one-line JSON", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["sessions", "--url", url(adapter), "--token", token(), "--json"],
      { env: {}, isTTY: true },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("[]");
  });
});

describe("consumer: invoke (S4)", () => {
  it("invoke happy → output JSON, exit 0", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async (req: CanonicalInvocation) => {
      if (req.capability.name === "session.create") return { output: { id: "sess-test" } } as unknown as CanonicalResponse;
      if (req.capability.name === "session.destroy") return { output: {} } as unknown as CanonicalResponse;
      return { output: { hello: "world" } } as unknown as CanonicalResponse;
    }));
    const res = await runConsumer(
      ["invoke", "product.list", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: false },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('{"hello":"world"}');
  });

  it("invoke passes --args and --session through", async () => {
    const seen: CanonicalInvocation[] = [];
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async (req) => {
      seen.push(req);
      return { output: {} };
    }));
    const res = await runConsumer(
      ["invoke", "product.list", "--args", '{"page":2}', "--session", "s-9", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(0);
    expect(seen[0]?.input).toEqual({ page: 2 });
    expect(seen[0]?.sessionId).toBe("s-9");
  });

  it("invoke.error → `error: <code> — <message>` verbatim, exit 1", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      error: { code: "GATEWAY_INTERNAL_ERROR", message: "boom", details: {}, retryable: false },
    })));
    const res = await runConsumer(
      ["invoke", "product.list", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe("error: GATEWAY_INTERNAL_ERROR — boom\n");
    expect(res.stdout).toBe("");
  });

  it("missing capability name → usage, exit 2", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(["invoke", "--url", url(adapter), "--token", token()], { env: {} });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/usage: agentide invoke/);
  });

  it("invalid --args JSON → exit 2", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["invoke", "product.list", "--args", "{nope", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/invalid --args JSON/);
  });

  it("--mode stream → warning + still invokes in call mode, exit 0", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["invoke", "product.list", "--mode", "stream", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toMatch(/reserved for v2/);
    // PRD S4: the flag is a no-op in v1 — the invoke still runs as `call`
    expect(res.stdout).toContain('"echoed":{}');
  });
});

describe("consumer: failure surfaces (S8)", () => {
  it("unreachable gateway → exit 2 (refused)", async () => {
    const res = await runConsumer(
      ["sessions", "--url", "ws://127.0.0.1:1/ws", "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/^error: .*ECONNREFUSED/);
  });

  it("bad token → exit 4 (auth.error before auth.ok)", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["sessions", "--url", url(adapter), "--token", "not-a-jwt"],
      { env: {} },
    );
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toMatch(/^error: /);
  });

  it("missing URL + non-TTY → exit 2 (no prompt for URL)", async () => {
    const res = await runConsumer(["sessions", "--token", token()], { env: {}, isTTY: false });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/gateway URL required/);
  });

  it("gateway throw → error frame → exit 2", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => {
      throw new Error("kaboom");
    }));
    const res = await runConsumer(
      ["sessions", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/error frame/);
  });

  it("close 1009 (outbound frame too large) → exit 2", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: { blob: "x".repeat(4096) },
    })), { maxFrameBytes: 256 });
    const res = await runConsumer(
      ["invoke", "product.list", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(2);
  });
});

describe("consumer: watch (S7)", () => {
  it("sessions watch → snapshot + NDJSON events, Ctrl-C → exit 5", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: [{ id: "s-1", status: "active", createdAt: 1 }],
    })));
    const run = runConsumer(
      ["watch", "sessions", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true, onSignal: signalAfter(300) },
    );
    await new Promise((r) => setTimeout(r, 100));
    await bus.publish("session.started", { sessionId: "s-2" });
    const res = await run;
    expect(res.exitCode).toBe(5);
    expect(res.stdout).toMatch(/ID\s+STATUS\s+CREATED/); // snapshot table
    const eventLine = res.stdout.split("\n").find((l) => l.startsWith('{"type":"event"'));
    expect(eventLine).toBeDefined();
    expect(eventLine).toContain('"topic":"session.started"');
    expect(eventLine).toContain('"payload":{"sessionId":"s-2"}');
  });

  it("watch --json → compact snapshot + pure NDJSON stream", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: [{ id: "s-1", status: "active", createdAt: 1 }],
    })));
    const run = runConsumer(
      ["--watch", "sessions", "--json", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true, onSignal: signalAfter(250) },
    );
    await new Promise((r) => setTimeout(r, 100));
    await bus.publish("session.started", { sessionId: "s-3" });
    const res = await run;
    expect(res.exitCode).toBe(5);
    expect(res.stdout.split("\n")[0]).toBe('[{"id":"s-1","status":"active","createdAt":1}]');
  });

  it("watch --topic override: only matching events stream", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: [{ id: "s-1", status: "active", createdAt: 1 }],
    })));
    const run = runConsumer(
      ["watch", "sessions", "--topic", "order.*", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true, onSignal: signalAfter(300) },
    );
    await new Promise((r) => setTimeout(r, 100));
    await bus.publish("session.started", { sessionId: "s-5" }); // filtered out
    await bus.publish("order.created", { orderId: "o-1" }); // matches override
    const res = await run;
    expect(res.exitCode).toBe(5);
    expect(res.stdout).not.toContain("session.started");
    expect(res.stdout).toContain('"topic":"order.created"');
  });

  it("unknown watch alias → exit 2", async () => {
    const bus = createEventBus();
    const adapter = await startAdapter(bus);
    const res = await runConsumer(
      ["watch", "nope", "--url", url(adapter), "--token", token()],
      { env: {} },
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/unrecognized watch alias/);
  });

  it("stats dropped>0 → one stderr warning, stream continues to signal", async () => {
    const bus = createEventBus();
    // 1024 keeps auth.ok/subscribe.ok in the budget; the burst overflows it.
    const adapter = await startAdapter(bus, gateway(async () => ({
      output: [{ id: "s-1", status: "active", createdAt: 1 }],
    })), { maxBufferedBytes: 1024, statsIntervalMs: 50 });
    const run = runConsumer(
      ["watch", "sessions", "--url", url(adapter), "--token", token()],
      { env: {}, isTTY: true, onSignal: signalAfter(400) },
    );
    await new Promise((r) => setTimeout(r, 100));
    // Burst well over the 1024-byte budget → outbound drops → stats frame
    for (let i = 0; i < 300; i += 1) {
      await bus.publish("session.started", { sessionId: `s-${i}`, note: "x".repeat(256) });
    }
    const res = await run;
    expect(res.exitCode).toBe(5);
    expect(res.stderr).toMatch(/warning: gateway dropped \d+ events \(backpressure\)/);
    expect(res.stdout).toContain('"topic":"session.started"'); // events still flowed
  });
});
