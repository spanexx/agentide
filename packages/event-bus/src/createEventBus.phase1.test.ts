import { describe, it, expect, vi } from "vitest";
import { createEventBus, type PublishedEvent } from "./index.js";

describe("createEventBus — Phase 1 core publish/subscribe", () => {
  it("returns an EventBus with publish + subscribe", () => {
    const bus = createEventBus();
    expect(typeof bus.publish).toBe("function");
    expect(typeof bus.subscribe).toBe("function");
  });

  it("delivers an exact-name subscription", async () => {
    const bus = createEventBus();
    const received: PublishedEvent<unknown>[] = [];
    bus.subscribe("session.created", (e) => {
      received.push(e);
    });
    await bus.publish("session.created", { id: "s1" });
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("session.created");
  });

  it("delivers a single-segment wildcard subscription", async () => {
    const bus = createEventBus();
    const received: string[] = [];
    bus.subscribe("browser.*", (e) => received.push(e.name));
    await bus.publish("browser.started", {});
    await bus.publish("browser.page.loaded", {}); // 2 segments — should NOT match
    expect(received).toEqual(["browser.started"]);
  });

  it("delivers a `**` catch-all subscription", async () => {
    const bus = createEventBus();
    const received: string[] = [];
    bus.subscribe("**", (e) => received.push(e.name));
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
    bus.subscribe("a", () => order.push("first"));
    bus.subscribe("a", () => order.push("second"));
    bus.subscribe("a", () => order.push("third"));
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
    const unsub = bus.subscribe("topic", handler);
    await bus.publish("topic", { a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    await bus.publish("topic", { a: 2 });
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("unsubscribe during handler does not affect in-flight dispatch", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    let unsubSelf: () => void = () => {};
    unsubSelf = bus.subscribe("x", () => {
      order.push("first");
      unsubSelf(); // handler removes itself mid-dispatch
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
    a.subscribe("topic.*", (e) => seenByA.push(e.name));
    b.subscribe("topic.*", (e) => seenByB.push(e.name));
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