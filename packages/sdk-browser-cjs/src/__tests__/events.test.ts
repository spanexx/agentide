/** @vitest-environment jsdom */
/**
 * Phase 5 — event publisher (sdk-node parity).
 *
 * The 8 lifecycle events go through `@spanexx/event-bus`:
 *   sdk.connected / sdk.disconnected / sdk.capability.{registered,
 *   unregistered, rejected} / sdk.invoke.{started, completed, failed}
 * Payload shapes mirror sdk-node's events.ts (readonly fields + appId).
 */

import { createEventBus } from "@spanexx/event-bus-cjs";
import { describe, expect, it } from "vitest";
import {
  SdkEventPublisher,
  type SdkCapabilityRegisteredPayload,
  type SdkCapabilityRejectedPayload,
  type SdkCapabilityUnregisteredPayload,
  type SdkConnectedPayload,
  type SdkDisconnectedPayload,
  type SdkInvokeCompletedPayload,
  type SdkInvokeFailedPayload,
  type SdkInvokeStartedPayload,
} from "../events";

const APP_ID = "app-checkout";

function makePublisher() {
  const bus = createEventBus();
  const publisher = new SdkEventPublisher(bus, APP_ID);
  return { bus, publisher };
}

describe("sdk.connected / sdk.disconnected", () => {
  it("publishes sdk.connected with gatewayUrl and latency", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkConnectedPayload[] = [];
    bus.subscribe<SdkConnectedPayload>("sdk.connected", (e) => {
      seen.push(e.payload);
    });

    publisher.connected("ws://gw/ws", 42);
    expect(seen).toEqual([
      { appId: APP_ID, gatewayUrl: "ws://gw/ws", latencyMs: 42 },
    ]);
  });

  it("publishes sdk.disconnected with a reason", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkDisconnectedPayload[] = [];
    bus.subscribe<SdkDisconnectedPayload>("sdk.disconnected", (e) => {
      seen.push(e.payload);
    });

    publisher.disconnected("origin-mismatch");
    expect(seen).toEqual([{ appId: APP_ID, reason: "origin-mismatch" }]);
  });
});

describe("sdk.capability.* events", () => {
  it("publishes registered with the reconnected flag", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkCapabilityRegisteredPayload[] = [];
    bus.subscribe<SdkCapabilityRegisteredPayload>("sdk.capability.registered", (e) => {
      seen.push(e.payload);
    });

    publisher.capabilityRegistered("shop.add", false);
    publisher.capabilityRegistered("shop.add", true); // post-reconnect
    expect(seen).toEqual([
      { appId: APP_ID, capability: "shop.add", reconnected: false },
      { appId: APP_ID, capability: "shop.add", reconnected: true },
    ]);
  });

  it("publishes unregistered", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkCapabilityUnregisteredPayload[] = [];
    bus.subscribe<SdkCapabilityUnregisteredPayload>("sdk.capability.unregistered", (e) => {
      seen.push(e.payload);
    });

    publisher.capabilityUnregistered("shop.add");
    expect(seen).toEqual([{ appId: APP_ID, capability: "shop.add" }]);
  });

  it("publishes rejected with the gateway reason", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkCapabilityRejectedPayload[] = [];
    bus.subscribe<SdkCapabilityRejectedPayload>("sdk.capability.rejected", (e) => {
      seen.push(e.payload);
    });

    publisher.capabilityRejected("shop.add", "not permitted");
    expect(seen).toEqual([
      { appId: APP_ID, capability: "shop.add", reason: "not permitted" },
    ]);
  });
});

describe("sdk.invoke.* events", () => {
  it("publishes started with callId, capability, input", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkInvokeStartedPayload[] = [];
    bus.subscribe<SdkInvokeStartedPayload>("sdk.invoke.started", (e) => {
      seen.push(e.payload);
    });

    publisher.invokeStarted("c1", "shop.add", { sku: "A1" });
    expect(seen).toEqual([
      { appId: APP_ID, callId: "c1", capability: "shop.add", input: { sku: "A1" } },
    ]);
  });

  it("publishes completed with durationMs", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkInvokeCompletedPayload[] = [];
    bus.subscribe<SdkInvokeCompletedPayload>("sdk.invoke.completed", (e) => {
      seen.push(e.payload);
    });

    publisher.invokeCompleted("c1", "shop.add", 7);
    expect(seen).toEqual([
      { appId: APP_ID, callId: "c1", capability: "shop.add", durationMs: 7 },
    ]);
  });

  it("publishes failed with message and code", () => {
    const { bus, publisher } = makePublisher();
    const seen: SdkInvokeFailedPayload[] = [];
    bus.subscribe<SdkInvokeFailedPayload>("sdk.invoke.failed", (e) => {
      seen.push(e.payload);
    });

    publisher.invokeFailed("c1", "shop.add", "no targets", "NO_TARGETS");
    expect(seen).toEqual([
      {
        appId: APP_ID,
        callId: "c1",
        capability: "shop.add",
        error: { message: "no targets", code: "NO_TARGETS" },
      },
    ]);
  });
});
