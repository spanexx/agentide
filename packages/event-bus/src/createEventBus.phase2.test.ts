import { describe, it, expect } from "vitest";
import {
  createEventBus,
  RESERVED_INTERNAL_PREFIX,
  type HandlerFailurePayload,
} from "./index.js";

describe("createEventBus — Phase 2 async + failure surfacing", () => {
  it("invokes mixed sync and async handlers in registration order", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("e", () => {
      order.push("sync1");
    });
    bus.subscribe("e", async () => {
      // longer delay to force completion AFTER the trailing sync handler
      await new Promise((r) => setTimeout(r, 20));
      order.push("async");
    });
    bus.subscribe("e", () => {
      order.push("sync2");
    });
    await bus.publish("e", {});
    // Per PRD AC-5: handlers are INVOKED in registration order, but
    // completion order is not guaranteed. The async handler was started
    // second and finished last because of the delay; sync2 still ran
    // immediately after the async handler started.
    expect(order).toEqual(["sync1", "sync2", "async"]);
  });

  it("publish() waits for delayed async handlers to settle", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("e", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("after-delay");
    });
    const p = bus.publish("e", {});
    // publish has not yet resolved because the async handler hasn't settled.
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    expect(order).toEqual([]); // handler has not yet run its tail
    await p;
    expect(order).toEqual(["after-delay"]);
    expect(resolved).toBe(true);
  });

  it("a throwing handler does not stop later handlers", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("e", () => {
      throw new Error("boom");
    });
    bus.subscribe("e", () => {
      order.push("later");
    });
    await expect(bus.publish("e", {})).resolves.toBeUndefined();
    expect(order).toEqual(["later"]);
  });

  it("a rejected async handler does not stop later handlers", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe("e", async () => {
      throw new Error("async-boom");
    });
    bus.subscribe("e", () => {
      order.push("after-async-fail");
    });
    await expect(bus.publish("e", {})).resolves.toBeUndefined();
    expect(order).toEqual(["after-async-fail"]);
  });

  it("original publish() resolves even when handlers fail", async () => {
    const bus = createEventBus();
    bus.subscribe("e", () => {
      throw new Error("sync-fail");
    });
    bus.subscribe("e", async () => {
      throw new Error("async-fail");
    });
    await expect(bus.publish("e", {})).resolves.toBeUndefined();
  });

  it("emits exactly one event.handler_failed per failing handler with original event, index, and error", async () => {
    const bus = createEventBus();
    const failures: HandlerFailurePayload<unknown>[] = [];
    bus.subscribe("event.handler_failed", (e) => {
      failures.push(e.payload as HandlerFailurePayload<unknown>);
    });
    const err1 = new Error("first-failure");
    const err2 = new Error("second-failure");
    bus.subscribe("topic", () => {
      throw err1;
    });
    bus.subscribe("topic", async () => {
      throw err2;
    });
    bus.subscribe("topic", () => {
      /* healthy */
    });
    await bus.publish("topic", { id: "abc" });
    expect(failures).toHaveLength(2);
    // Order: failures surface in handler index order.
    expect(failures[0].handlerIndex).toBe(0);
    expect(failures[0].error).toBe(err1);
    expect(failures[0].event.name).toBe("topic");
    expect(failures[0].event.payload).toEqual({ id: "abc" });
    expect(failures[1].handlerIndex).toBe(1);
    expect(failures[1].error).toBe(err2);
    expect(failures[1].event.name).toBe("topic");
  });

  it("publish() resolves successfully even when event.handler_failed subscriber itself throws", async () => {
    const bus = createEventBus();
    bus.subscribe("event.handler_failed", () => {
      throw new Error("observer-broken");
    });
    bus.subscribe("topic", () => {
      throw new Error("original-failure");
    });
    await expect(bus.publish("topic", {})).resolves.toBeUndefined();
  });

  it("external caller cannot publish into the reserved event.* namespace", async () => {
    const bus = createEventBus();
    await expect(bus.publish("event.anything", {})).rejects.toThrow(
      /Reserved namespace/,
    );
    await expect(
      bus.publish("event.handler_failed", { fake: true }),
    ).rejects.toThrow(/Reserved namespace/);
  });

  it("RESERVED_INTERNAL_PREFIX is exported as \"event.\"", () => {
    expect(RESERVED_INTERNAL_PREFIX).toBe("event.");
  });
});