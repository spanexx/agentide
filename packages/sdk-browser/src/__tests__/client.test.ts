/** @vitest-environment jsdom */
/**
 * Phase 4 — WebSocket client (GRILL T5).
 *
 * Transport is `globalThis.WebSocket` only (T5 Q4). First message after
 * `onopen` is `{ type: "sdk.auth", token }` (T5 Q1) — no Authorization
 * header. Reconnect backoff: 1s, 2s, 4s, 8s, 16s, 30s cap, ±20% jitter;
 * the index increments on ATTEMPT, not on drop. A close with code 1008
 * (origin binding, T5 Q2) means NO reconnect — the reconnect timer must
 * be cleared (zombie-reconnect bug class).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkClient } from "../client.js";
import type { ConnectionState } from "../types.js";

const GATEWAY = "ws://127.0.0.1:8999/ws";
const TOKEN = "jwt-with-expectedOrigins";

/** Minimal controllable WebSocket stand-in, keyed to the global stub. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCalls: Array<{ code: number; reason: string }> = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Test helpers — simulate the server side. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  closeFromServer(code: number) {
    // Real close events imply the socket is CLOSED — mirror that so
    // client.connect() does not early-return on a stale OPEN state.
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function stubWebSocket() {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}

let states: ConnectionState[];

beforeEach(() => {
  stubWebSocket();
  states = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeClient() {
  const hooks = {
    onState: (s: ConnectionState) => states.push(s),
    onInvoke: vi.fn(),
    onOpen: vi.fn(),
    onDisconnected: vi.fn(),
    onRegisterError: vi.fn(),
  };
  const client = new SdkClient(GATEWAY, TOKEN, hooks);
  return { client, hooks };
}

describe("auth-first handshake (GRILL T5 Q1)", () => {
  it("sends { type: 'sdk.auth', token } as the very first message on open", () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent).toEqual([]); // nothing before open
    ws.open();
    expect(ws.sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: "sdk.auth", token: TOKEN },
    ]);
  });

  it("connects to the gateway URL", () => {
    const { client } = makeClient();
    client.connect();
    expect(FakeWebSocket.instances[0].url).toBe(GATEWAY);
  });
});

describe("state surface (GRILL T4 D3)", () => {
  it("reports connecting → connected on open, connecting → reconnecting on drop", () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.closeFromServer(1006);
    expect(states).toEqual(["connecting", "connected", "reconnecting"]);
  });
});

describe("reconnect backoff (GRILL T3)", () => {
  it("schedules 1s, 2s, 4s … with ±20% jitter, capped at 30s", () => {
    vi.useFakeTimers();
    const { client } = makeClient();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter ≈ 1.0×
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.closeFromServer(1006); // drop → schedule attempt 1

    // Each attempt FAILS before open (closeFromServer while connecting),
    // so the index climbs the ladder instead of resetting on success.
    const bases = [1000, 2000, 4000, 8000, 16000, 30000];
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i];
      vi.advanceTimersByTime(base - 1);
      expect(FakeWebSocket.instances).toHaveLength(i + 1); // not fired yet
      vi.advanceTimersByTime(2); // float delay ≈ base + ε → fires here
      expect(FakeWebSocket.instances).toHaveLength(i + 2); // attempt fired
      FakeWebSocket.instances[i + 1].closeFromServer(1006); // fails
    }
  });

  it("keeps the delay within ±20% of the base at the jitter extremes", () => {
    vi.useFakeTimers();
    const { client } = makeClient();
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter = 0.8× exactly
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.closeFromServer(1006);
    // Lower bound: must NOT fire before 800ms.
    vi.advanceTimersByTime(799);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2); // fires at 801 (float delay ≈ 800 + ε)
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("resets the backoff index after a successful reconnect", () => {
    vi.useFakeTimers();
    const { client } = makeClient();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    client.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.closeFromServer(1006); // attempt 1: ≈1s
    vi.advanceTimersByTime(1001); // attempt fires → ws2 exists
    const ws2 = FakeWebSocket.instances[1];
    ws2.open(); // success → index resets
    ws2.closeFromServer(1006); // next drop → back to ≈1s
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(2); // fires at 1001 again
    expect(FakeWebSocket.instances).toHaveLength(3);
  });
});

describe("close code 1008 — origin binding (GRILL T5 Q2)", () => {
  it("goes disconnected with NO reconnect and clears the reconnect timer", () => {
    vi.useFakeTimers();
    const { client } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.closeFromServer(1006); // a reconnect is now pending
    expect(FakeWebSocket.instances).toHaveLength(1);
    ws.closeFromServer(1008); // origin mismatch
    expect(states[states.length - 1]).toBe("disconnected");
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1); // zombie prevented
  });
});

describe("deliberate disconnect", () => {
  it("closes with 1000 and never reconnects", () => {
    vi.useFakeTimers();
    const { client } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    client.disconnect();
    expect(ws.closeCalls[0]).toEqual({ code: 1000, reason: "deliberate" });
    expect(states[states.length - 1]).toBe("disconnected");
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("is a no-op when never connected", () => {
    const { client } = makeClient();
    expect(() => client.disconnect()).not.toThrow();
  });
});

describe("wire messages (sdk.invoke)", () => {
  it("delivers sdk.invoke to the onInvoke hook", () => {
    const { client, hooks } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message({ type: "sdk.invoke", capability: "shop.cart.add", input: { productId: 202 } });
    expect(hooks.onInvoke).toHaveBeenCalledWith({
      type: "sdk.invoke",
      capability: "shop.cart.add",
      input: { productId: 202 },
    });
  });
});
