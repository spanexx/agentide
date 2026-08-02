/** @vitest-environment jsdom */
/**
 * Phase 5 — createSdk end-to-end wiring.
 *
 * The DOM is the manifest: caps found by the initial scan (and by
 * `observe()` / DOM mutations) are registered with the Gateway ONLY while
 * connected (0→1 register, 1→0 unregister). Wire `sdk.invoke` fans out as
 * `CustomEvent` on every annotated element and replies with
 * `sdk.invoke.result` / `sdk.invoke.error`. Programmatic `invoke()` shares
 * the same path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSdk } from "../index.js";
import type { Sdk } from "../types.js";

const GATEWAY = "ws://127.0.0.1:8999/ws";
const TOKEN = "jwt-with-expectedOrigins";

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
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
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

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  closeFromServer(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let sdk: Sdk;

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances = [];
});

afterEach(async () => {
  sdk?.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Flush queued MutationObserver callbacks while the jsdom env is still
  // alive — otherwise they dangle into environment teardown and crash on
  // a now-undefined `Element`.
  document.body.innerHTML = "";
  await flush();
});

function annotate(html: string) {
  document.body.innerHTML = html;
}

function lastSent(ws: FakeWebSocket) {
  return ws.sent.map((raw) => JSON.parse(raw));
}

describe("factory validation", () => {
  it("throws when gateway / appId / token are missing", () => {
    expect(() => createSdk({ gateway: "", appId: "a", token: "t" })).toThrow(/gateway/);
    expect(() => createSdk({ gateway: GATEWAY, appId: "", token: "t" })).toThrow(/appId/);
    expect(() => createSdk({ gateway: GATEWAY, appId: "a", token: "" })).toThrow(/token/);
  });

  it("throws when globalThis.WebSocket is missing (T5 Q4)", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => createSdk({ gateway: GATEWAY, appId: "a", token: "t" })).toThrow(/WebSocket/);
  });
});

describe("register-on-connect (T2)", () => {
  it("sends sdk.auth first, then sdk.capability.register per unique cap", () => {
    annotate(`
      <button data-sdk-cap="shop.cart.add">Add</button>
      <button data-sdk-cap="shop.cart.add">Add 2</button>
      <input data-sdk-cap="notes.write" />
    `);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    const messages = lastSent(ws);
    expect(messages[0]).toEqual({ type: "sdk.auth", token: TOKEN });
    expect(messages.slice(1)).toEqual(
      expect.arrayContaining([
        { type: "sdk.capability.register", name: "shop.cart.add" },
        { type: "sdk.capability.register", name: "notes.write" },
      ]),
    );
  });

  it("state() flips registered flags once connected", () => {
    annotate(`<button data-sdk-cap="shop.cart.add">Add</button>`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });

    expect(sdk.state().capabilities[0].registered).toBe(false);
    sdk.connect();
    FakeWebSocket.instances[0].open();
    expect(sdk.state().capabilities[0].registered).toBe(true);
  });

  it("drops unregister everything (1→0); reconnect re-registers", async () => {
    vi.useFakeTimers(); // before connecting, so the backoff timer is fake
    annotate(`<button data-sdk-cap="shop.cart.add">Add</button>`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(sdk.state().capabilities[0].registered).toBe(true);

    ws.closeFromServer(1006); // drop → reconnecting
    expect(sdk.state().capabilities[0].registered).toBe(false);
    expect(sdk.state().connectionState).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2000); // 1s backoff + jitter
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    expect(sdk.state().capabilities[0].registered).toBe(true);
    expect(lastSent(ws2).filter((m) => m.type === "sdk.capability.register")).toEqual([
      { type: "sdk.capability.register", name: "shop.cart.add" },
    ]);
  });

  it("registers caps discovered via DOM mutation while connected", async () => {
    annotate(`<div id="root"><button data-sdk-cap="notes.write">W</button></div>`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(lastSent(ws).some((m) => m.name === "shop.quick.add")).toBe(false);

    const el = document.createElement("button");
    el.setAttribute("data-sdk-cap", "shop.quick.add");
    document.getElementById("root")!.appendChild(el);
    await flush(); // MutationObserver callback

    expect(
      lastSent(ws).some((m) => m.type === "sdk.capability.register" && m.name === "shop.quick.add"),
    ).toBe(true);
  });

  it("observe() scans an extra root and registers its caps while connected", () => {
    annotate(`<button data-sdk-cap="notes.write">W</button>`);
    const extra = document.createElement("section");
    extra.innerHTML = `<input data-sdk-cap="quick.reply" />`;
    document.body.appendChild(extra);

    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.observe(extra); // cap present before connect — registered on connect
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    expect(lastSent(ws).some((m) => m.name === "quick.reply")).toBe(true);
  });
});

describe("wire invoke → fan-out → reply (T2 Q5)", () => {
  it("dispatches on every annotated element and sends sdk.invoke.result", () => {
    annotate(`
      <button data-sdk-cap="shop.cart.add" id="a1">A</button>
      <button data-sdk-cap="shop.cart.add" id="a2">B</button>
    `);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    const seen: Array<{ id: string; input: unknown; token: unknown }> = [];
    for (const id of ["a1", "a2"]) {
      document.getElementById(id)!.addEventListener("sdk:cap:shop.cart.add", (ev) => {
        const e = ev as CustomEvent<{ input: unknown; ctx: { token: unknown } }>;
        seen.push({ id, input: e.detail.input, token: e.detail.ctx.token });
      });
    }

    ws.message({ type: "sdk.invoke", callId: "c-77", name: "shop.cart.add", input: { sku: "A1" } });

    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(seen[0].input).toEqual({ sku: "A1" });
    expect(seen[0].token).toBe(TOKEN); // JWT verbatim (T5 Q3)
    expect(lastSent(ws).at(-1)).toEqual({
      type: "sdk.invoke.result",
      callId: "c-77",
      payload: null,
    });
  });

  it("unknown capability → sdk.invoke.error NO_TARGETS", () => {
    annotate(`<button data-sdk-cap="shop.cart.add">A</button>`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.message({ type: "sdk.invoke", callId: "c-9", name: "ghost.cap", input: {} });
    expect(lastSent(ws).at(-1)).toEqual({
      type: "sdk.invoke.error",
      callId: "c-9",
      code: "NO_TARGETS",
      message: "no annotated elements for ghost.cap",
    });
  });

  it("programmatic invoke() shares the same dispatch + reply path", () => {
    annotate(`<input data-sdk-cap="notes.write" id="n" />`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    const el = document.getElementById("n") as HTMLInputElement;
    const got: string[] = [];
    el.addEventListener("sdk:cap:notes.write", (ev) => {
      const e = ev as CustomEvent<{ input: unknown }>;
      got.push(String(e.detail.input));
    });

    sdk.invoke("notes.write", "hello");
    expect(got).toEqual(["hello"]);
    expect(el.value).toBe("hello"); // form-fill fallback (T1)
    expect(lastSent(ws).at(-1)?.type).toBe("sdk.invoke.result");
  });
});

describe("register.error routing", () => {
  it("does not crash and leaves the capability unregistered in state", () => {
    annotate(`<button data-sdk-cap="shop.cart.add">A</button>`);
    sdk = createSdk({ gateway: GATEWAY, appId: "app-1", token: TOKEN });
    sdk.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(sdk.state().capabilities[0].registered).toBe(true);

    ws.message({ type: "sdk.capability.register.error", name: "shop.cart.add", reason: "denied" });
    // Rejection surfaces on the bus (unit-tested); the SDK does not retry.
    expect(sdk.state().capabilities[0].registered).toBe(true);
  });
});
