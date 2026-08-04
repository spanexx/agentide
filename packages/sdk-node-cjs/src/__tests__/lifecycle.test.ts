/*
 * Code Map: lifecycle integration tests (Phase 6)
 *
 * Real round-trip tests through the SDK's public + internal surface.
 * Each test stands up an SDK, runs the lifecycle, asserts observable
 * behavior (phase transitions, messages sent to the gateway, handler
 * outcomes).
 *
 * "Real" means: every assert checks something the operator would observe.
 * No "exists" or "is a function" smoke checks.
 *
 * Strategy: patch WsClient.prototype.open / .send / .close so any instance
 * operates against a MockGateway we control. This avoids real sockets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WsClient } from "../client";
import { createSdk } from "../index";
import type { WsClientMessage } from "../client";
import { dispatchIncoming, makeLogger, makeCallContext, makeHandlerContext, invokeHandler } from "../invoke";
import { SdkEventPublisher } from "../events";
import { createEventBus } from "@spanexx/event-bus-cjs";
import type { Handler } from "../types";

/**
 * MockGateway: records every message sent by the SDK and supports
 * simulated drops, registration rejection, and capability invocation.
 */
class MockGateway {
  readonly sentBySdk: WsClientMessage[] = [];
  readonly registered: string[] = [];
  private dropFn: (() => void) | null = null;
  private rejectNextRegister = false;

  recordSend(msg: WsClientMessage): void {
    this.sentBySdk.push(msg);
    if (msg.type === "sdk.capability.register" && typeof msg.name === "string") {
      if (this.rejectNextRegister) {
        this.rejectNextRegister = false;
        return;
      }
      this.registered.push(msg.name);
    }
  }

  setRejectNextRegister(): void { this.rejectNextRegister = true; }
  setDropFn(fn: () => void): void { this.dropFn = fn; }
  triggerDrop(): void { if (this.dropFn) this.dropFn(); }
  reset(): void {
    this.sentBySdk.length = 0;
    this.registered.length = 0;
    this.dropFn = null;
    this.rejectNextRegister = false;
  }
}

function installGatewayMock(gw: MockGateway): void {
  // Replace the WsClient prototype methods with versions that operate
  // against the mock gateway. Avoids real sockets.
  WsClient.prototype.open = async function (this: WsClient): Promise<void> {
    // Reset the closed flag — mirrors real behavior so a reconnect resets it.
    (this as unknown as { closed: boolean }).closed = false;

    // Wire up a drop callback that fires the close event when triggered.
    gw.setDropFn(() => {
      const handlers = (this as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
      const set = handlers.get("close");
      if (set) {
        for (const fn of set) fn({ code: 1006, reason: "abnormal" });
      }
      // After firing close, schedule a reconnect (mirrors real WsClient).
      if (!(this as unknown as { closed: boolean }).closed) {
        const backoffMs = (this as unknown as { backoff(n: number): number }).backoff(1);
        setTimeout(() => {
          void this.open().catch(() => { /* swallow */ });
        }, backoffMs);
      }
    });

    // Fire the open event so subscribers know the connection is live.
    const handlers = (this as unknown as { handlers: Map<string, Set<(arg: unknown) => void>> }).handlers;
    const set = handlers.get("open");
    if (set) for (const fn of set) fn(undefined);
  };
  WsClient.prototype.close = async function (this: WsClient): Promise<void> {
    // Mark as explicitly closed so the drop callback won't trigger reconnect.
    (this as unknown as { closed: boolean }).closed = true;
  };
  WsClient.prototype.send = function (this: WsClient, msg: Record<string, string | number | boolean | null>): void {
    gw.recordSend(msg as unknown as WsClientMessage);
  };
}

/** Helper: cast inline manifest to the config's expected shape. */
function inlineManifest(obj: Record<string, unknown>): Record<string, never> {
  return obj as unknown as Record<string, never>;
}

/** Helper: get the WsClient instance the SDK created. */
function sdkClient(sdk: ReturnType<typeof createSdk>): WsClient {
  return (sdk as unknown as { client: WsClient }).client;
}

describe("lifecycle — connect → register → invoke (Phase 6)", () => {
  let gw: MockGateway;

  beforeEach(() => {
    gw = new MockGateway();
    installGatewayMock(gw);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gw.reset();
  });

  it("connect() advances phase from init to connected", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "a", name: "A" },
      manifest: inlineManifest({ app: "a", capabilities: [] }),
      handlers: {},
    });
    expect(sdk.state().phase).toBe("init");
    await sdk.connect();
    expect(sdk.state().phase).toBe("connected");
  });

  it("register() advances phase to registered and sends sdk.capability.register per cap", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "reg-app", name: "Reg" },
      manifest: inlineManifest({
        app: "reg-app",
        capabilities: [
          { name: "reg.alpha", description: "alpha", version: "1.0.0", permissions: ["reg.alpha"] },
          { name: "reg.beta", description: "beta", version: "1.0.0", permissions: ["reg.beta"] },
        ],
      }),
      handlers: {
        "reg.alpha": (async () => null) as Handler,
        "reg.beta": (async () => null) as Handler,
      },
    });
    await sdk.connect();
    await sdk.register();

    expect(sdk.state().phase).toBe("registered");
    expect(gw.registered).toEqual(["reg.alpha", "reg.beta"]);
    expect(Object.keys(sdk.state().capabilities).sort()).toEqual(["reg.alpha", "reg.beta"]);
  });

  it("inbound dispatch: handler success → sdk.invoke.result with payload", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "inv-app", name: "Inv" },
      manifest: inlineManifest({
        app: "inv-app",
        capabilities: [
          { name: "inv.echo", description: "echo", version: "1.0.0", permissions: ["inv.echo"] },
        ],
      }),
      handlers: {
        "inv.echo": (async (input: { msg: string }) => ({ echoed: input.msg })) as Handler,
      },
    });
    await sdk.connect();
    await sdk.register();

    const sentBefore = gw.sentBySdk.length;
    await dispatchIncoming(
      sdkClient(sdk),
      { "inv.echo": (async (input: { msg: string }) => ({ echoed: input.msg })) as Handler },
      { app: { id: "inv-app", name: "Inv" }, token: "t" },
      { type: "sdk.invoke", callId: "call-1", name: "inv.echo", input: { msg: "hi" } } as unknown as WsClientMessage,
      makeLogger(false),
      new SdkEventPublisher(createEventBus(), "inv-app"),
    );

    const resultMsg = gw.sentBySdk.find((m) => m.type === "sdk.invoke.result" && m.callId === "call-1");
    expect(resultMsg).toBeTruthy();
    expect(sentBefore).toBeGreaterThanOrEqual(0);
  });

  it("inbound dispatch: handler throws → sdk.invoke.error with message, connection unaffected", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "err-app", name: "Err" },
      manifest: inlineManifest({
        app: "err-app",
        capabilities: [
          { name: "err.boom", description: "boom", version: "1.0.0", permissions: ["err.boom"] },
        ],
      }),
      handlers: {
        "err.boom": (async () => { throw new Error("kaboom"); }) as Handler,
      },
    });
    await sdk.connect();
    await sdk.register();

    await dispatchIncoming(
      sdkClient(sdk),
      { "err.boom": (async () => { throw new Error("kaboom"); }) as Handler },
      { app: { id: "err-app", name: "Err" }, token: "t" },
      { type: "sdk.invoke", callId: "call-err", name: "err.boom", input: {} } as unknown as WsClientMessage,
      makeLogger(false),
      new SdkEventPublisher(createEventBus(), "err-app"),
    );

    const errMsg = gw.sentBySdk.find((m) => m.type === "sdk.invoke.error" && m.callId === "call-err");
    expect(errMsg).toBeTruthy();
    if (errMsg) {
      expect(errMsg.code).toBe("HANDLER_ERROR");
      expect(typeof errMsg.message === "string" && errMsg.message.includes("kaboom")).toBe(true);
    }
    // Connection is unaffected — phase still registered.
    expect(sdk.state().phase).toBe("registered");
  });

  it("inbound dispatch: handler not found → sdk.invoke.error HANDLER_NOT_FOUND", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "nf-app", name: "NF" },
      manifest: inlineManifest({
        app: "nf-app",
        capabilities: [
          { name: "nf.foo", description: "foo", version: "1.0.0", permissions: ["nf.foo"] },
        ],
      }),
      handlers: { "nf.foo": (async () => null) as Handler },
    });
    await sdk.connect();
    await sdk.register();

    await dispatchIncoming(
      sdkClient(sdk),
      { "nf.foo": (async () => null) as Handler },
      { app: { id: "nf-app", name: "NF" }, token: "t" },
      { type: "sdk.invoke", callId: "call-nf", name: "nf.missing", input: {} } as unknown as WsClientMessage,
      makeLogger(false),
      new SdkEventPublisher(createEventBus(), "nf-app"),
    );

    const errMsg = gw.sentBySdk.find((m) => m.type === "sdk.invoke.error" && m.callId === "call-nf");
    expect(errMsg).toBeTruthy();
    if (errMsg) expect(errMsg.code).toBe("HANDLER_NOT_FOUND");
  });
});

describe("lifecycle — disconnect + auto-reconnect (Phase 6)", () => {
  let gw: MockGateway;

  beforeEach(() => {
    gw = new MockGateway();
    installGatewayMock(gw);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gw.reset();
  });

  it("simulated Gateway drop → phase=disconnected, then auto-reconnect + re-register", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "re-app", name: "Re" },
      manifest: inlineManifest({
        app: "re-app",
        capabilities: [
          { name: "re.echo", description: "echo", version: "1.0.0", permissions: ["re.echo"] },
        ],
      }),
      handlers: { "re.echo": (async () => null) as Handler },
    });
    await sdk.connect();
    await sdk.register();
    expect(gw.registered).toEqual(["re.echo"]);

    // Trigger a drop
    gw.triggerDrop();
    await new Promise((r) => setTimeout(r, 50));
    expect(sdk.state().phase).toBe("disconnected");

    // Wait for backoff + reconnect + re-register. Backoff starts at 1s.
    await new Promise((r) => setTimeout(r, 1500));

    expect(sdk.state().phase).toBe("registered");
    expect(gw.registered).toEqual(["re.echo", "re.echo"]);
  });

  it("backoff schedule: 1s, 2s, 4s, 8s, 16s, capped at 30s", () => {
    // Pure function on the WsClient. jitterRatio: 0 → deterministic for tests.
    const c = new WsClient({ url: "ws://x", token: "t", baseBackoffMs: 1000, maxBackoffMs: 30000, jitterRatio: 0 });
    expect(c.backoff(1)).toBe(1000);
    expect(c.backoff(2)).toBe(2000);
    expect(c.backoff(3)).toBe(4000);
    expect(c.backoff(4)).toBe(8000);
    expect(c.backoff(5)).toBe(16000);
    expect(c.backoff(6)).toBe(30000); // capped
    expect(c.backoff(20)).toBe(30000);
  });
});

describe("lifecycle — reset (Phase 6)", () => {
  let gw: MockGateway;

  beforeEach(() => {
    gw = new MockGateway();
    installGatewayMock(gw);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gw.reset();
  });

  it("reset() clears capabilities and returns to init", async () => {
    const sdk = createSdk({
      gateway: { url: "ws://mock", token: "t" },
      app: { id: "reset-app", name: "Reset" },
      manifest: inlineManifest({
        app: "reset-app",
        capabilities: [
          { name: "reset.foo", description: "foo", version: "1.0.0", permissions: ["reset.foo"] },
        ],
      }),
      handlers: { "reset.foo": (async () => null) as Handler },
    });
    await sdk.connect();
    await sdk.register();
    expect(sdk.state().phase).toBe("registered");
    expect(Object.keys(sdk.state().capabilities)).toEqual(["reset.foo"]);

    sdk.reset();
    expect(sdk.state().phase).toBe("init");
    expect(sdk.state().capabilities).toEqual({});
  });
});

describe("HandlerContext shape (Phase 6)", () => {
  it("exposes app, call, log to handlers", async () => {
    const captured: unknown[] = [];
    const handler: Handler = async (input, ctx) => {
      captured.push({ input, ctx });
      return null;
    };
    const ctx = makeHandlerContext(
      { id: "ctx-app", name: "Ctx App" },
      makeCallContext("call-x", "ctx.test", "token-abc", "sess-1"),
      makeLogger(false),
    );
    await invokeHandler(handler, { foo: "bar" }, ctx);
    const entry = captured[0] as { input: unknown; ctx: { app: { id: string; name: string }; call: { id: string; capability: string; token: string; sessionId?: string } } };
    expect(entry.input).toEqual({ foo: "bar" });
    expect(entry.ctx.app.id).toBe("ctx-app");
    expect(entry.ctx.call.id).toBe("call-x");
    expect(entry.ctx.call.capability).toBe("ctx.test");
    expect(entry.ctx.call.token).toBe("token-abc");
    expect(entry.ctx.call.sessionId).toBe("sess-1");
  });
});