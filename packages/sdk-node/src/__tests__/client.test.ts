/*
 * Code Map: WebSocket client tests (Phase 3)
 *
 * Verifies the WsClient's behavior with real assertions on:
 *  - backoff() pure function
 *  - on/off handler registration
 *  - open() rejects on unreachable URL (real network test)
 */

import { describe, it, expect, vi } from "vitest";
import { WsClient } from "../client.js";

describe("WsClient — backoff schedule (Phase 3)", () => {
  it("computes exponential backoff capped at maxBackoffMs", () => {
    const c = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, maxBackoffMs: 30000, jitterRatio: 0 });
    expect(c.backoff(1)).toBe(1000);
    expect(c.backoff(2)).toBe(2000);
    expect(c.backoff(3)).toBe(4000);
    expect(c.backoff(4)).toBe(8000);
    expect(c.backoff(5)).toBe(16000);
    expect(c.backoff(6)).toBe(30000); // capped
    expect(c.backoff(20)).toBe(30000);
  });

  it("respects custom baseBackoffMs", () => {
    const c = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 500, maxBackoffMs: 10000, jitterRatio: 0 });
    expect(c.backoff(1)).toBe(500);
    expect(c.backoff(2)).toBe(1000);
    expect(c.backoff(3)).toBe(2000);
    expect(c.backoff(5)).toBe(8000);
    expect(c.backoff(6)).toBe(10000); // capped at 10000
  });

  it("applies ±20% jitter by default (IMPL Risk Notes)", () => {
    // random()=0 → factor=1-0.2=0.8 → 1000*0.8=800
    // random()=0.5 → factor=1+0=1 → 1000
    // random()=1 → factor=1+0.2=1.2 → 1200
    const min = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 0.2, random: () => 0 });
    const mid = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 0.2, random: () => 0.5 });
    const max = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 0.2, random: () => 1 });
    expect(min.backoff(1)).toBe(800);
    expect(mid.backoff(1)).toBe(1000);
    expect(max.backoff(1)).toBe(1200);
  });

  it("clamps jitterRatio to [0, 1] (values >1 cannot produce negative factors)", () => {
    // Without clamping, jitterRatio=2.0 with random()=0 would give
    // factor = 1 - 2 = -1 → result 0 (infinite reconnect loop).
    // The clamp coerces out-of-range values to the documented range.
    const cHigh = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 5.0, random: () => 0 });
    const cNeg = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: -0.5, random: () => 1 });
    const cBoundary = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 1.0, random: () => 0 });
    // High clamped to 1.0 → factor 0 → result 0
    expect(cHigh.backoff(1)).toBe(0);
    // Negative clamped to 0 → no jitter, exact value
    expect(cNeg.backoff(1)).toBe(1000);
    // Boundary: factor 0 → result 0 (still valid)
    expect(cBoundary.backoff(1)).toBe(0);
  });

  it("backoff never goes negative with extreme jitter", () => {
    // Sanity check: even at the clamped max (1.0), the result is non-negative.
    const c = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, jitterRatio: 1.0, random: () => 0 });
    expect(c.backoff(1)).toBe(0);
  });
});

describe("WsClient — handler registration (Phase 3)", () => {
  it("on() registers a handler that fires on the matching event", () => {
    const client = new WsClient({ url: "ws://x", token: "t" });
    const handler = vi.fn();
    client.on("open", handler);

    // Trigger the event by directly emitting — internal method.
    (client as unknown as { emit(event: string, arg: unknown): void }).emit("open", undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("off() unregisters a handler so it doesn't fire", () => {
    const client = new WsClient({ url: "ws://x", token: "t" });
    const handler = vi.fn();
    client.on("open", handler);
    client.off("open", handler);

    (client as unknown as { emit(event: string, arg: unknown): void }).emit("open", undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports handlers for all 5 event types", () => {
    const client = new WsClient({ url: "ws://x", token: "t" });
    const events = ["open", "close", "error", "reconnect_scheduled", "message"] as const;
    for (const ev of events) {
      const handler = vi.fn();
      expect(() => client.on(ev, handler)).not.toThrow();
      expect(() => client.off(ev, handler)).not.toThrow();
    }
  });
});

describe("WsClient — open() (Phase 3)", () => {
  it("rejects when the URL is unreachable", async () => {
    const client = new WsClient({ url: "ws://127.0.0.1:1", token: "t" });
    await expect(client.open()).rejects.toThrow();
  });
});