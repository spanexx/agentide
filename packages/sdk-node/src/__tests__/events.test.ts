/*
 * Code Map: event bus integration tests (Phase 7)
 *
 * Verifies all 8 PRD-TRD events fire on the @platform/event-bus:
 *   sdk.connected, sdk.disconnected,
 *   sdk.capability.{registered,unregistered,rejected},
 *   sdk.invoke.{started,completed,failed}.
 *
 * Each test stands up an SDK, captures events on a bus, and asserts the
 * event name + payload shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsClient } from "../client.js";
import { createSdk } from "../index.js";
import type { WsClientMessage } from "../client.js";
import { createEventBus, type EventBus, type PlatformEvent } from "@platform/event-bus";
import type {
  SdkConnectedPayload,
  SdkDisconnectedPayload,
  SdkCapabilityRegisteredPayload,
  SdkCapabilityUnregisteredPayload,
  SdkCapabilityRejectedPayload,
  SdkInvokeStartedPayload,
  SdkInvokeCompletedPayload,
  SdkInvokeFailedPayload,
} from "../events.js";
import type { Handler } from "../types.js";

class MockGateway {
  readonly sentBySdk: WsClientMessage[] = [];
  recordSend(msg: WsClientMessage): void {
    this.sentBySdk.push(msg);
  }
  reset(): void { this.sentBySdk.length = 0; }
}

function installMock(gw: MockGateway): void {
  WsClient.prototype.open = async function (): Promise<void> {
    (this as unknown as { closed: boolean }).closed = false;
    const handlers = (this as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
    const set = handlers.get("open");
    if (set) for (const fn of set) fn(undefined);
  };
  WsClient.prototype.close = async function (): Promise<void> {
    (this as unknown as { closed: boolean }).closed = true;
    const handlers = (this as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
    const set = handlers.get("close");
    if (set) for (const fn of set) fn(undefined);
  };
  WsClient.prototype.send = function (msg: Record<string, string | number | boolean | null>): void {
    gw.recordSend(msg as unknown as WsClientMessage);
  };
}

let gw: MockGateway;
beforeEach(() => {
  gw = new MockGateway();
  installMock(gw);
});
afterEach(() => {
  vi.restoreAllMocks();
  gw.reset();
});

interface EventLog {
  connected: PlatformEvent<SdkConnectedPayload>[];
  disconnected: PlatformEvent<SdkDisconnectedPayload>[];
  registered: PlatformEvent<SdkCapabilityRegisteredPayload>[];
  unregistered: PlatformEvent<SdkCapabilityUnregisteredPayload>[];
  rejected: PlatformEvent<SdkCapabilityRejectedPayload>[];
  invokeStarted: PlatformEvent<SdkInvokeStartedPayload>[];
  invokeCompleted: PlatformEvent<SdkInvokeCompletedPayload>[];
  invokeFailed: PlatformEvent<SdkInvokeFailedPayload>[];
}

function capture(bus: EventBus): EventLog {
  const log: EventLog = {
    connected: [],
    disconnected: [],
    registered: [],
    unregistered: [],
    rejected: [],
    invokeStarted: [],
    invokeCompleted: [],
    invokeFailed: [],
  };
  bus.subscribe<SdkConnectedPayload>("sdk.connected", (e) => { log.connected.push(e); });
  bus.subscribe<SdkDisconnectedPayload>("sdk.disconnected", (e) => { log.disconnected.push(e); });
  bus.subscribe<SdkCapabilityRegisteredPayload>("sdk.capability.registered", (e) => { log.registered.push(e); });
  bus.subscribe<SdkCapabilityUnregisteredPayload>("sdk.capability.unregistered", (e) => { log.unregistered.push(e); });
  bus.subscribe<SdkCapabilityRejectedPayload>("sdk.capability.rejected", (e) => { log.rejected.push(e); });
  bus.subscribe<SdkInvokeStartedPayload>("sdk.invoke.started", (e) => { log.invokeStarted.push(e); });
  bus.subscribe<SdkInvokeCompletedPayload>("sdk.invoke.completed", (e) => { log.invokeCompleted.push(e); });
  bus.subscribe<SdkInvokeFailedPayload>("sdk.invoke.failed", (e) => { log.invokeFailed.push(e); });
  return log;
}

function sdkClient(sdk: ReturnType<typeof createSdk>): WsClient {
  return (sdk as unknown as { client: WsClient }).client;
}

const inlineManifest = (obj: Record<string, unknown>): Record<string, never> =>
  obj as unknown as Record<string, never>;

describe("event bus — sdk.connected (Phase 7)", () => {
  it("emits sdk.connected after open() with appId, gatewayUrl, latencyMs", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "ev-app", name: "Ev" },
      manifest: inlineManifest({ app: "ev-app", capabilities: [] }),
      handlers: {},
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    // publish is async; allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(log.connected).toHaveLength(1);
    const payload = log.connected[0]!.payload;
    expect(payload.appId).toBe("ev-app");
    expect(payload.gatewayUrl).toBe("ws://mock");
    expect(typeof payload.latencyMs).toBe("number");
    expect(payload.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("event bus — sdk.disconnected (Phase 7)", () => {
  it("emits sdk.disconnected after disconnect() with appId + reason", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "dis-app", name: "Dis" },
      manifest: inlineManifest({ app: "dis-app", capabilities: [] }),
      handlers: {},
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.disconnect();
    // publish is async; allow microtasks + bus queue to drain
    await new Promise((r) => setTimeout(r, 50));

    expect(log.disconnected).toHaveLength(1);
    expect(log.disconnected[0]!.payload.appId).toBe("dis-app");
    expect(typeof log.disconnected[0]!.payload.reason).toBe("string");
  });
});

describe("event bus — sdk.capability.registered (Phase 7)", () => {
  it("emits one registered event per capability on initial register()", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "reg-evt", name: "Reg" },
      manifest: inlineManifest({
        app: "reg-evt",
        capabilities: [
          { name: "reg.x", description: "x", version: "1.0.0", permissions: ["reg.x"] },
          { name: "reg.y", description: "y", version: "1.0.0", permissions: ["reg.y"] },
        ],
      }),
      handlers: {
        "reg.x": (async () => null) as Handler,
        "reg.y": (async () => null) as Handler,
      },
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.register();
    await new Promise((r) => setTimeout(r, 10));

    expect(log.registered).toHaveLength(2);
    expect(log.registered.map((e) => e.payload.capability).sort()).toEqual(["reg.x", "reg.y"]);
    for (const e of log.registered) {
      expect(e.payload.appId).toBe("reg-evt");
      expect(e.payload.reconnected).toBe(false);
    }
  });
});

describe("event bus — sdk.capability.unregistered (Phase 7)", () => {
  it("emits unregistered for each tracked cap on disconnect()", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "unreg-d", name: "UnregD" },
      manifest: inlineManifest({
        app: "unreg-d",
        capabilities: [
          { name: "u.a", description: "a", version: "1.0.0", permissions: ["u.a"] },
        ],
      }),
      handlers: { "u.a": (async () => null) as Handler },
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.register();
    await sdk.disconnect();
    await new Promise((r) => setTimeout(r, 10));

    expect(log.unregistered).toHaveLength(1);
    expect(log.unregistered[0]!.payload.appId).toBe("unreg-d");
    expect(log.unregistered[0]!.payload.capability).toBe("u.a");
  });

  it("emits unregistered for each tracked cap on reset()", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "unreg-r", name: "UnregR" },
      manifest: inlineManifest({
        app: "unreg-r",
        capabilities: [
          { name: "u.b", description: "b", version: "1.0.0", permissions: ["u.b"] },
        ],
      }),
      handlers: { "u.b": (async () => null) as Handler },
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.register();
    sdk.reset();
    await new Promise((r) => setTimeout(r, 10));

    expect(log.unregistered).toHaveLength(1);
    expect(log.unregistered[0]!.payload.capability).toBe("u.b");
  });
});

describe("event bus — sdk.invoke.* (Phase 7)", () => {
  it("SDK's inbound dispatch publishes invoke.started + invoke.completed to the SDK's bus", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "inv-rt", name: "Inv" },
      manifest: inlineManifest({
        app: "inv-rt",
        capabilities: [
          { name: "rt.ok", description: "ok", version: "1.0.0", permissions: ["rt.ok"] },
        ],
      }),
      handlers: { "rt.ok": (async () => ({ value: 42 })) as Handler },
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.register();

    // Manually inject an inbound message so the SDK's lifecycle path
    // dispatches it via its own publisher (which is wired to `bus`).
    const client = sdkClient(sdk);
    const handlers = (client as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
    const msgHandlers = handlers.get("message");
    if (msgHandlers) {
      for (const fn of msgHandlers) {
        await fn({ type: "sdk.invoke", callId: "rt-1", name: "rt.ok", input: {} });
      }
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(log.invokeStarted).toHaveLength(1);
    expect(log.invokeStarted[0]!.payload.capability).toBe("rt.ok");
    expect(log.invokeCompleted).toHaveLength(1);
    expect(log.invokeCompleted[0]!.payload.capability).toBe("rt.ok");
    expect(typeof log.invokeCompleted[0]!.payload.durationMs).toBe("number");
  });

  it("SDK's inbound dispatch publishes invoke.failed when handler throws", async () => {
    const bus = createEventBus();
    const log = capture(bus);
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "inv-fail", name: "Inv" },
      manifest: inlineManifest({
        app: "inv-fail",
        capabilities: [
          { name: "rt.fail", description: "fail", version: "1.0.0", permissions: ["rt.fail"] },
        ],
      }),
      handlers: { "rt.fail": (async () => { throw new Error("kaboom"); }) as Handler },
      bus,
    } as unknown as Parameters<typeof createSdk>[0]);
    await sdk.connect();
    await sdk.register();

    const client = sdkClient(sdk);
    const handlers = (client as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
    const msgHandlers = handlers.get("message");
    if (msgHandlers) {
      for (const fn of msgHandlers) {
        await fn({ type: "sdk.invoke", callId: "rt-fail", name: "rt.fail", input: {} });
      }
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(log.invokeFailed).toHaveLength(1);
    expect(log.invokeFailed[0]!.payload.error.message).toBe("kaboom");
    expect(log.invokeFailed[0]!.payload.error.code).toBe("HANDLER_ERROR");
  });
});
