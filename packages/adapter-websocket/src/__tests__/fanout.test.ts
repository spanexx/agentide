import { describe, expect, it } from "vitest";
import { createEventBus } from "@spanexx/event-bus";
import type { TokenClaims } from "@spanexx/gateway-core";
import type { WebSocket as WSWebSocket } from "ws";
import { ConnectionRegistry } from "../registry.js";
import { subscribeTopics, type SubscriptionOptions } from "../fanout.js";

const claims: TokenClaims = {
  sub: { tenantId: "acme", callerId: "ops" },
  scope: ["platform.*.read"],
  iat: 1,
  exp: 2,
};

const queueOptions: SubscriptionOptions = {
  maxBufferedBytes: 1_048_576,
  statsIntervalMs: 1000,
};

describe("subscription fan-out", () => {
  it("relays matching Event Bus events into the connection queue", async () => {
    const bus = createEventBus();
    const record = new ConnectionRegistry().add({ readyState: 0 } as WSWebSocket, undefined);
    const result = subscribeTopics(record, ["session.*"], bus, claims, queueOptions);
    expect(result).toEqual({ ok: true, topics: ["session.*"] });
    await bus.publish("session.created", { id: "s1" });
    expect(record.queue).toHaveLength(1);
    expect(record.queue[0].frame).toMatchObject({ type: "event", topic: "session.created" });
  });

  it("rejects a batch atomically when one pattern is invalid", async () => {
    const bus = createEventBus();
    const record = new ConnectionRegistry().add({ readyState: 0 } as WSWebSocket, undefined);
    const result = subscribeTopics(record, ["session.*", "a.*.b"], bus, claims, queueOptions);
    expect(result).toMatchObject({ ok: false, code: "WS_INVALID_TOPIC" });
    expect(record.subs.size).toBe(0);
    await bus.publish("session.created", { id: "s1" });
    expect(record.queue).toHaveLength(0);
  });

  it("rejects unauthorized patterns and reserved topics", () => {
    const bus = createEventBus();
    const record = new ConnectionRegistry().add({ readyState: 0 } as WSWebSocket, undefined);
    const narrow: TokenClaims = { ...claims, scope: ["platform.session.read"] };
    expect(subscribeTopics(record, ["plugin.*"], bus, narrow, queueOptions)).toMatchObject({
      ok: false,
      code: "WS_FORBIDDEN",
    });
    expect(subscribeTopics(record, ["event.foo"], bus, claims, queueOptions)).toMatchObject({
      ok: false,
      code: "WS_INVALID_TOPIC",
    });
  });

  it("deduplicates subscriptions and makes unsubscribe idempotent", async () => {
    const bus = createEventBus();
    const record = new ConnectionRegistry().add({ readyState: 0 } as WSWebSocket, undefined);
    expect(subscribeTopics(record, ["session.*", "session.*"], bus, claims, queueOptions)).toEqual({
      ok: true,
      topics: ["session.*", "session.*"],
    });
    expect(record.subs.size).toBe(1);
    await bus.publish("session.created", { id: "s1" });
    expect(record.queue).toHaveLength(1);
  });
});
