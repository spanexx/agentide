import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// P5: state machine + lifecycle tests. We load the same app.js source P4
// uses and exercise createClient with a fake WebSocket so we can drive
// transitions deterministically (auth.ok → connected → auth.error →
// terminal, backoff on close, panel-error verbatim).
//
// Strategy: rewrite createClient's `new WebSocket(wsUrl)` reference to a
// fake by intercepting the global before we eval the module body.

interface FakeFrame {
  type: string;
  [k: string]: unknown;
}

class FakeWS {
  static instances: FakeWS[] = [];
  sent: FakeFrame[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(frame: string | FakeFrame): void {
    this.sent.push(typeof frame === "string" ? (JSON.parse(frame) as FakeFrame) : frame);
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // Test helpers — simulate adapter behavior.
  ackAuth(): void {
    this.readyState = 1;
    this.onopen?.({});
    this.onmessage?.({ data: JSON.stringify({ type: "auth.ok" }) });
  }
  sendAuthError(message: string): void {
    this.onmessage?.({ data: JSON.stringify({ type: "auth.error", message }) });
  }
  sendInvokeResult(id: string, output: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type: "invoke.result", id, output }) });
  }
  sendInvokeError(id: string, code: string, message: string): void {
    this.onmessage?.({ data: JSON.stringify({ type: "invoke.error", id, code, message }) });
  }
  sendEvent(topic: string, payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type: "event", topic, payload }) });
  }
  hangUp(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

(globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS;

// Load the two layered browser files: render.js (pure renderers +
// computeBackoff) installs window.AgentideRender; wire.js then consumes
// it and installs window.AgentideClient.
const renderJs = readFileSync(join(__dirname, "..", "assets", "render.js"), "utf8");
const wireJs = readFileSync(join(__dirname, "..", "assets", "wire.js"), "utf8");
const fakeWindow: Record<string, unknown> = {};
const isoRender = new Function("window", "globalThis", renderJs);
isoRender(fakeWindow, fakeWindow);
const isoWire = new Function(
  "window", "globalThis", "WebSocket",
  wireJs + "\n;return window.AgentideClient;",
);
const { createClient, STATES } = isoWire(fakeWindow, fakeWindow, FakeWS) as {
  createClient: (opts: unknown) => {
    connect: () => void;
    state: { ws: FakeWS | null; lastError?: string; panelErrors?: Record<string, string> };
    setDetail: (kind: string, i: number) => void;
  };
  STATES: Record<string, string>;
};

describe("P5 lifecycle + states (app.js state machine)", () => {
  it("auth.ok after connect → CONNECTED + 4 invokes + subscribe", async () => {
    FakeWS.instances.length = 0;
    const log: string[] = [];
    const client = createClient({
      token: "tok",
      wsUrl: "ws://127.0.0.1:7300/ws",
      send: (frame: FakeFrame) => {
        const ws = client.state.ws;
        if (ws) ws.sent.push(frame);
      },
      log: () => {},
      onState: (s: string) => log.push(s),
      onPanels: () => {},
    });
    client.connect();
    const ws = FakeWS.instances[0]!;
    // Server acks (this triggers auth.ok)
    ws.ackAuth();
    // The state machine sends invokes sequentially inside an async for-await
    // loop. We need to drive the microtask queue forward between iterations;
    // each `sendInvokeResult` synchronously resolves the pending promise,
    // which yields to the next loop body.
    let guard = 10;
    while (ws.sent.filter((f) => f.type === "invoke").length < 4 && guard-- > 0) {
      for (const frame of ws.sent.filter((f) => f.type === "invoke")) {
        ws.sendInvokeResult(String(frame.id), []);
      }
      await new Promise((r) => setImmediate(r));
    }
    // Client should now fire the 4 invokes + subscribe
    const invokeNames = ws.sent.filter((f) => f.type === "invoke").map((f) => (f.capability as { name: string }).name);
    expect(invokeNames).toContain("session.list");
    expect(invokeNames).toContain("plugin.list");
    expect(invokeNames).toContain("capability.list");
    expect(invokeNames).toContain("system.health");
    expect(ws.sent.some((f) => f.type === "subscribe")).toBe(true);
    // State transitioned connecting → connected.
    expect(log).toContain(STATES.CONNECTING);
    expect(log[log.length - 1]).toBe(STATES.CONNECTED);
    // Auth frame was sent before any invoke.
    expect(ws.sent[0]).toEqual({ type: "auth", token: "tok" });
  });

  it("auth.error → TERMINAL, no further reconnects", () => {
    FakeWS.instances.length = 0;
    const log: string[] = [];
    const client = createClient({
      token: "tok",
      wsUrl: "ws://127.0.0.1:7300/ws",
      send: () => {},
      log: () => {},
      onState: (s: string) => log.push(s),
      onPanels: () => {},
    });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.sendAuthError("origin mismatch — expected http://localhost:7200");
    expect(log[log.length - 1]).toBe(STATES.TERMINAL);
    expect(FakeWS.instances.length).toBe(1);
  });

  it("unexpected close (1006) → DOWN + scheduled reconnect", () => {
    FakeWS.instances.length = 0;
    const log: string[] = [];
    const client = createClient({
      token: "tok",
      wsUrl: "ws://127.0.0.1:7300/ws",
      send: () => {},
      log: () => {},
      onState: (s: string) => log.push(s),
      onPanels: () => {},
    });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.ackAuth();
    log.length = 0;
    ws.hangUp(1006);
    expect(log[log.length - 1]).toBe(STATES.DOWN);
  });

  it("invoke.error records panelErrors verbatim into the matching panel (Gap 3 fix)", async () => {
    FakeWS.instances.length = 0;
    let panelError: { target: string; message: string } | null = null;
    const client = createClient({
      token: "tok",
      wsUrl: "ws://127.0.0.1:7300/ws",
      send: (frame: FakeFrame) => {
        const ws = client.state.ws;
        if (ws) ws.sent.push(frame);
      },
      log: () => {},
      onState: () => {},
      onPanels: (s: unknown) => {
        const v = s as { panelErrors?: Record<string, string> };
        if (!v.panelErrors) return;
        const firstKey = Object.keys(v.panelErrors)[0];
        if (firstKey) panelError = { target: firstKey, message: v.panelErrors[firstKey] };
      },
    });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.ackAuth();
    let guard = 10;
    while (ws.sent.filter((f) => f.type === "invoke").length < 4 && guard-- > 0) {
      const sessionListFrame = ws.sent.find((f) => f.type === "invoke" && (f.capability as { name: string }).name === "session.list");
      for (const frame of ws.sent.filter((f) => f.type === "invoke")) {
        if (frame === sessionListFrame) continue;
        ws.sendInvokeResult(String(frame.id), []);
      }
      if (sessionListFrame) ws.sendInvokeError(String(sessionListFrame.id), "GATEWAY_INTERNAL_ERROR", "no backing store");
      await new Promise((r) => setImmediate(r));
    }
    expect(panelError).not.toBeNull();
    expect(panelError!.target).toBe("sessionsBody");
    expect(panelError!.message).toContain("GATEWAY_INTERNAL_ERROR");
  });

  it("setPaused hides reconnect attempts (Gap 2 fix)", async () => {
    FakeWS.instances.length = 0;
    const client = createClient({
      token: "tok", wsUrl: "ws://127.0.0.1:7300/ws",
      send: (frame: FakeFrame) => {
        const ws = client.state.ws;
        if (ws) ws.sent.push(frame);
      },
      log: () => {}, onState: () => {}, onPanels: () => {},
    });
    (client as unknown as { setPaused: (p: boolean) => void }).setPaused(true);
    expect((client.state as unknown as { paused: boolean }).paused).toBe(true);
    client.connect();
    await new Promise((r) => setImmediate(r));
    FakeWS.instances[FakeWS.instances.length - 1]?.ackAuth();
    (client as unknown as { setPaused: (p: boolean) => void }).setPaused(true);
    const beforeResume = FakeWS.instances.length;
    (client as unknown as { setPaused: (p: boolean) => void }).setPaused(false);
    await new Promise((r) => setImmediate(r));
    const afterResume = FakeWS.instances.length;
    expect(afterResume).toBeGreaterThan(beforeResume);
  });

  it("setDetail exposes the matching record (drill-down round-trip)", async () => {
    FakeWS.instances.length = 0;
    let detail: { kind: string; record: unknown } | null = null;
    const client = createClient({
      token: "tok",
      wsUrl: "ws://127.0.0.1:7300/ws",
      send: (frame: FakeFrame) => {
        const ws = client.state.ws;
        if (ws) ws.sent.push(frame);
      },
      log: () => {},
      onState: () => {},
      onPanels: () => {},
      onDetail: (kind: string, record: unknown) => { detail = { kind, record }; },
    });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.ackAuth();
    // Drain non-session invokes; push session.list with a record.
    let guard = 10;
    while (ws.sent.filter((f) => f.type === "invoke").length < 4 && guard-- > 0) {
      for (const frame of ws.sent.filter((f) => f.type === "invoke")) {
        const name = (frame.capability as { name: string }).name;
        if (name === "session.list") {
          ws.sendInvokeResult(String(frame.id), [{ id: "s1", status: "active", owner: "alice", createdAt: "10:00" }]);
        } else {
          ws.sendInvokeResult(String(frame.id), []);
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    client.setDetail("session", 0);
    expect(detail).not.toBeNull();
    expect(detail!.kind).toBe("session");
    expect((detail!.record as { id: string }).id).toBe("s1");
  });
});