/** @vitest-environment jsdom */
/**
 * Phase 5 — lifecycle gates (GRILL T3).
 *
 * visibilitychange (Q1): hidden cancels a pending reconnect; visible fires
 * it immediately (no extra backoff wait). offline (Q2): socket marked dead,
 * no reconnect while offline; online (Q2): backoff resets and the
 * connection restores immediately. pagehide (Q3): best-effort
 * `disconnect()` with close(1000, "pagehide"); skipped when
 * `event.persisted` (bfcache). Heartbeat is server-initiated only — there
 * is no SDK heartbeat code to test (Q4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkClient } from "../client";
import { attachLifecycle } from "../lifecycle";
import type { ConnectionState } from "../types";

const GATEWAY = "ws://127.0.0.1:8999/ws";
const TOKEN = "jwt-with-expectedOrigins";

/** Controllable WebSocket stand-in (same contract as client tests). */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closeCalls: Array<{ code: number; reason: string }> = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send() {}
  close(code = 1000, reason = "") {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  closeFromServer(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

let states: ConnectionState[];
let reasons: string[];
let cleanup: () => void;

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances = [];
  states = [];
  reasons = [];
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeClient() {
  const client = new SdkClient(GATEWAY, TOKEN, {
    onState: (s) => states.push(s),
    onInvoke: vi.fn(),
    onOpen: vi.fn(),
    onDisconnected: (r) => reasons.push(r),
    onRegisterError: vi.fn(),
  });
  return client;
}

function connectOpen(): { client: SdkClient; ws: FakeWebSocket } {
  const client = makeClient();
  cleanup = attachLifecycle(client);
  client.connect();
  const ws = FakeWebSocket.instances[0];
  ws.open();
  return { client, ws };
}

function setHidden(hidden: boolean) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibility gate (GRILL T3 Q1)", () => {
  it("hidden cancels a pending reconnect; visible fires it immediately", () => {
    const { client } = connectOpen();
    const ws = FakeWebSocket.instances[0];
    ws.closeFromServer(1006); // drop → reconnecting with 1s timer
    expect(states.at(-1)).toBe("reconnecting");

    setHidden(true); // pause: timer cancelled
    vi.advanceTimersByTime(5000); // far past the 1s backoff
    expect(FakeWebSocket.instances.length).toBe(1); // no reconnect while hidden

    setHidden(false); // visible → reconnect fires immediately
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(client.connectionState).toBe("connecting");
  });

  it("hidden/visible with no pending reconnect are no-ops", () => {
    const { client } = connectOpen();
    setHidden(true);
    setHidden(false);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(client.connectionState).toBe("connected");
  });
});

describe("offline / online gate (GRILL T3 Q2)", () => {
  it("offline marks the socket dead; online restores immediately with reset backoff", () => {
    const { client } = connectOpen();
    expect(client.connectionState).toBe("connected");

    window.dispatchEvent(new Event("offline"));
    expect(states.at(-1)).toBe("disconnected");
    expect(reasons).toContain("offline");

    // Backoff was climbing before the drop; online must reset it (index 0
    // means the FIRST reconnect attempt uses the 1s slot — covered by the
    // ladder tests; here we only assert an immediate reconnect).
    window.dispatchEvent(new Event("online"));
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(client.connectionState).toBe("connecting");
  });
});

describe("pagehide gate (GRILL T3 Q3)", () => {
  it("pagehide disconnects best-effort with close(1000, 'pagehide')", () => {
    const { client, ws } = connectOpen();
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    );
    expect(ws.closeCalls).toEqual([{ code: 1000, reason: "pagehide" }]);
    expect(client.connectionState).toBe("disconnected");
    expect(reasons).toContain("pagehide");
  });

  it("persisted (bfcache) pagehide tears nothing down", () => {
    const { client, ws } = connectOpen();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(ws.closeCalls).toEqual([]);
    expect(client.connectionState).toBe("connected");
  });
});
