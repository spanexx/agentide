/*
 * Code Map: register() tests (Phase 4)
 * - reads manifest from path, sends each capability to Gateway
 * - reads manifest from inline object, sends each capability
 * - rejects when handler not found for a manifest capability (mismatch)
 * - rejects when manifest fails validation (delegates to manifest.ts)
 * - phase transitions to 'registered' after success
 * - register() requires connect() first
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WsClientMessage } from "../client";
import { createEventBus, type EventBus } from "@spanexx/event-bus-cjs";
import { SdkEventPublisher, type SdkCapabilityRejectedPayload } from "../events";
import { dispatchIncoming, makeLogger } from "../invoke";

// Capture sends across tests; the WsClient constructor returns a stub.
const sends: WsClientMessage[] = [];

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  const stub = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn((msg: WsClientMessage) => sends.push(msg)),
    on: vi.fn(),
    off: vi.fn(),
  };
  function MockWsClient(): unknown {
    return stub;
  }
  return {
    ...actual,
    WsClient: MockWsClient as unknown as typeof actual.WsClient,
  };
});

import { createSdk } from "../index";

// Test helper: cast an inline manifest to the config's ManifestSource type.
function asManifest(obj: Record<string, unknown>): Record<string, never> {
  return obj as unknown as Record<string, never>;
}

beforeEach(() => {
  sends.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSdk().register() — manifest + handlers (Phase 4)", () => {
  it("registers each manifest capability with the Gateway", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://x", token: "t" },
      app: { id: "test-app", name: "Test App" },
      manifest: asManifest({
        app: "test-app",
        capabilities: [
          { name: "test.foo", description: "foo", version: "1.0.0", permissions: ["test.foo"] },
          { name: "test.bar", description: "bar", version: "1.0.0", permissions: ["test.bar"] },
        ],
      }),
      handlers: {
        "test.foo": async () => ({ ok: true }),
        "test.bar": async () => ({ ok: true }),
      },
    });
    await sdk.connect();
    await sdk.register();

    const registerMsgs = sends.filter(m => m.type === "sdk.capability.register");
    expect(registerMsgs).toHaveLength(2);
    expect(registerMsgs[0]?.name).toBe("test.foo");
    expect(registerMsgs[1]?.name).toBe("test.bar");
    expect(sdk.state().phase).toBe("registered");
  });

  it("throws when a manifest capability has no matching handler", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://x", token: "t" },
      app: { id: "test-app", name: "Test App" },
      manifest: asManifest({
        app: "test-app",
        capabilities: [
          { name: "test.foo", description: "foo", version: "1.0.0", permissions: ["test.foo"] },
          { name: "test.missing", description: "missing", version: "1.0.0", permissions: ["test.missing"] },
        ],
      }),
      handlers: {
        "test.foo": async () => ({ ok: true }),
        // test.missing has no handler — should fail
      },
    });
    await sdk.connect();
    await expect(sdk.register()).rejects.toThrow(/test.missing/);
  });

  it("throws when manifest fails validation", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://x", token: "t" },
      app: { id: "test-app", name: "Test App" },
      manifest: asManifest({
        app: "test-app",
        capabilities: [
          { name: "bad_name", description: "no dot", version: "1.0.0", permissions: ["x"] },
        ],
      }),
      handlers: { bad_name: async () => undefined },
    });
    await sdk.connect();
    await expect(sdk.register()).rejects.toThrow(/dot|name/);
  });

  it("register() requires connect() first", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://x", token: "t" },
      app: { id: "test-app", name: "Test App" },
      manifest: asManifest({ app: "x", capabilities: [] }),
      handlers: {},
    });
    await expect(sdk.register()).rejects.toThrow(/connect/);
  });

  it("publishes sdk.capability.rejected when Gateway rejects a register request (Phase 7)", async () => {
    // The SDK's inbound dispatch detects `sdk.capability.register.error`
    // and emits `sdk.capability.rejected` on the bus. Verify directly:
    const bus: EventBus = createEventBus();
    const rejected: SdkCapabilityRejectedPayload[] = [];
    bus.subscribe<SdkCapabilityRejectedPayload>("sdk.capability.rejected", (e) => {
      rejected.push(e.payload);
    });

    const stubClient = { send: vi.fn() };
    await dispatchIncoming(
      stubClient as unknown as Parameters<typeof dispatchIncoming>[0],
      {},
      { app: { id: "rej-app", name: "Rej" }, token: "t" },
      { type: "sdk.capability.register.error", name: "rej.foo", reason: "unauthorized" } as unknown as WsClientMessage,
      makeLogger(false),
      new SdkEventPublisher(bus, "rej-app"),
    );
    // Allow the void'd publish promise to resolve.
    await new Promise((r) => setTimeout(r, 20));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.appId).toBe("rej-app");
    expect(rejected[0]!.capability).toBe("rej.foo");
    expect(rejected[0]!.reason).toBe("unauthorized");
    // No sdk.invoke.error sent back (this is a registration message, not an invoke).
    expect(stubClient.send).not.toHaveBeenCalled();
  });
});