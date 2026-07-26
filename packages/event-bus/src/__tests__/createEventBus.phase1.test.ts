import { describe, it, expect, vi } from "vitest";
import { createEventBus, type PlatformEvent } from "../index.js";

describe("createEventBus — Phase 1 core publish/subscribe", () => {
  it("returns an EventBus with publish + subscribe", () => {
    const bus = createEventBus();
    expect(typeof bus.publish).toBe("function");
    expect(typeof bus.subscribe).toBe("function");
  });

  it("delivers an exact-name subscription", async () => {
    const bus = createEventBus();
    const received: PlatformEvent<object>[] = [];
    bus.subscribe("session.created", (e) => {
      received.push(e);
    });
    await bus.publish("session.created", { id: "s1" });
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("session.created");
    expect(typeof received[0].id).toBe("string");
    expect(typeof received[0].publishedAt).toBe("number");
    expect(received[0].publishedAt).toBeGreaterThan(0);
  });

  it("delivers a prefix wildcard subscription", async () => {
    const bus = createEventBus();
    const received: string[] = [];
    bus.subscribe("browser.*", (e) => { received.push(e.name); });
    await bus.publish("browser.started", {});
    await bus.publish("browser.page.loaded", {});
    await bus.publish("session.created", {});
    expect(received).toEqual(["browser.started", "browser.page.loaded"]);
  });

  it("delivers a bare `*` catch-all subscription", async () => {
    const bus = createEventBus();
    const received: string[] = [];
    bus.subscribe("*", (e) => { received.push(e.name); });
    await bus.publish("browser.page.loaded", {});
    await bus.publish("capability.registered", {});
    await bus.publish("session.created", {});
    expect(received).toEqual([
      "browser.page.loaded",
      "capability.registered",
      "session.created",
    ]);
  });

  it("preserves registration order across repeated publishes", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("a", () => { order.push("first"); });
    bus.subscribe("a", () => { order.push("second"); });
    bus.subscribe("a", () => { order.push("third"); });
    await bus.publish("a", {});
    await bus.publish("a", {});
    expect(order).toEqual([
      "first",
      "second",
      "third",
      "first",
      "second",
      "third",
    ]);
  });

  it("returns an unsubscribe handle that stops later deliveries", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const sub = bus.subscribe("topic", handler);
    await bus.publish("topic", { a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
    await bus.publish("topic", { a: 2 });
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("unsubscribe during handler does not affect in-flight dispatch", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    let unsubSelf: { unsubscribe(): void } = { unsubscribe() {} };
    unsubSelf = bus.subscribe("x", () => {
      order.push("first");
      unsubSelf.unsubscribe(); // handler removes itself mid-dispatch
    });
    bus.subscribe("x", () => {
      order.push("second");
    });
    bus.subscribe("x", () => {
      order.push("third");
    });
    await bus.publish("x", {});
    // Current dispatch still completes; self-unsubscribe only affects later publishes.
    expect(order).toEqual(["first", "second", "third"]);
    // Subsequent publish: first handler gone.
    order.length = 0;
    await bus.publish("x", {});
    expect(order).toEqual(["second", "third"]);
  });

  it("keeps separate bus instances isolated", async () => {
    const a = createEventBus();
    const b = createEventBus();
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    a.subscribe("topic.*", (e) => { seenByA.push(e.name); });
    b.subscribe("topic.*", (e) => { seenByB.push(e.name); });
    await a.publish("topic.alpha", {});
    expect(seenByA).toEqual(["topic.alpha"]);
    expect(seenByB).toEqual([]);
  });

  it("validates subscription patterns", () => {
    const bus = createEventBus();
    expect(() => bus.subscribe("", () => {})).toThrow();
    expect(() => bus.subscribe("a..b", () => {})).toThrow();
    expect(() => bus.subscribe("a.**.b", () => {})).toThrow();
    expect(() => bus.subscribe("a.b*c", () => {})).toThrow();
  });
});