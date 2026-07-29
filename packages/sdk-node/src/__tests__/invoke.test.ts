/*
 * Code Map: invoke() tests (Phase 5)
 * - sdk.invoke() calls the local handler directly
 * - dispatchIncoming() with sdk.invoke message calls the handler
 * - dispatchIncoming() sends sdk.invoke.result on success
 * - dispatchIncoming() sends sdk.invoke.error when handler throws
 * - dispatchIncoming() sends sdk.invoke.error when handler not found
 * - dispatchIncoming() ignores messages that aren't sdk.invoke
 * - Handler context includes app, call (with id/capability/token), log
 * - Handler errors don't crash the SDK
 */

import { describe, it, expect, vi } from "vitest";
import type { WsClientMessage } from "../client.js";
import { dispatchIncoming, invokeHandler, makeHandlerContext, makeCallContext, makeLogger } from "../invoke.js";
import type { Handler, HandlerContext } from "../types.js";

describe("invokeHandler() — direct invocation (Phase 5)", () => {
  it("calls the handler with input and context, returns the result", async () => {
    const handler: Handler<{ x: number }, { doubled: number }> = async (input, _ctx) => ({
      doubled: input.x * 2,
    });
    const ctx = makeHandlerContext(
      { id: "app", name: "App" },
      makeCallContext("call-1", "test.double", "tok"),
      makeLogger(false),
    );
    const result = await invokeHandler(handler, { x: 5 }, ctx);
    expect(result).toEqual({ doubled: 10 });
  });

  it("propagates handler errors", async () => {
    const handler: Handler = async () => {
      throw new Error("boom");
    };
    const ctx = makeHandlerContext(
      { id: "app", name: "App" },
      makeCallContext("call-1", "test.fail", "tok"),
      makeLogger(false),
    );
    await expect(invokeHandler(handler, {}, ctx)).rejects.toThrow("boom");
  });
});

describe("dispatchIncoming() — Gateway → SDK (Phase 5)", () => {
  it("calls the matching handler and sends sdk.invoke.result", async () => {
    const sends: WsClientMessage[] = [];
    const client = {
      send: vi.fn((msg: WsClientMessage) => sends.push(msg)),
    } as unknown as Parameters<typeof dispatchIncoming>[0];

    const handlers: Record<string, Handler> = {
      "test.echo": (async (input: { msg: string }) => ({ echoed: input.msg })) as Handler,
    };

    await dispatchIncoming(
      client,
      handlers,
      { app: { id: "app", name: "App" }, token: "tok" },
      {
        type: "sdk.invoke",
        callId: "call-42",
        name: "test.echo",
        input: { msg: "hello" },
      } as unknown as WsClientMessage,
      makeLogger(false),
    );

    expect(sends).toHaveLength(1);
    expect(sends[0]?.type).toBe("sdk.invoke.result");
    expect(sends[0]?.callId).toBe("call-42");
  });

  it("sends sdk.invoke.error when handler throws", async () => {
    const sends: WsClientMessage[] = [];
    const client = { send: vi.fn((msg: WsClientMessage) => sends.push(msg)) } as unknown as Parameters<typeof dispatchIncoming>[0];

    const handlers: Record<string, Handler> = {
      "test.fail": (async () => {
        throw new Error("handler boom");
      }) as Handler,
    };

    await dispatchIncoming(
      client,
      handlers,
      { app: { id: "app", name: "App" }, token: "tok" },
      { type: "sdk.invoke", callId: "call-1", name: "test.fail", input: {} } as unknown as WsClientMessage,
      makeLogger(false),
    );

    expect(sends).toHaveLength(1);
    expect(sends[0]?.type).toBe("sdk.invoke.error");
    expect(sends[0]?.callId).toBe("call-1");
    expect(sends[0]?.message).toContain("handler boom");
  });

  it("sends sdk.invoke.error when handler not found", async () => {
    const sends: WsClientMessage[] = [];
    const client = { send: vi.fn((msg: WsClientMessage) => sends.push(msg)) } as unknown as Parameters<typeof dispatchIncoming>[0];

    await dispatchIncoming(
      client,
      {},
      { app: { id: "app", name: "App" }, token: "tok" },
      { type: "sdk.invoke", callId: "call-1", name: "test.missing", input: {} } as unknown as WsClientMessage,
      makeLogger(false),
    );

    expect(sends).toHaveLength(1);
    expect(sends[0]?.type).toBe("sdk.invoke.error");
    expect(sends[0]?.code).toBe("HANDLER_NOT_FOUND");
  });

  it("ignores messages that aren't sdk.invoke", async () => {
    const sends: WsClientMessage[] = [];
    const client = { send: vi.fn((msg: WsClientMessage) => sends.push(msg)) } as unknown as Parameters<typeof dispatchIncoming>[0];

    await dispatchIncoming(
      client,
      {},
      { app: { id: "app", name: "App" }, token: "tok" },
      { type: "something.else", payload: "x" } as unknown as WsClientMessage,
      makeLogger(false),
    );

    expect(sends).toHaveLength(0);
  });

  it("handler receives a HandlerContext with app, call, log", async () => {
    const captured: HandlerContext[] = [];
    const handlers: Record<string, Handler> = {
      "test.capture": (async (_input: Record<string, never>, ctx: HandlerContext) => {
        captured.push(ctx);
        return null;
      }) as Handler,
    };
    const client = { send: vi.fn() } as unknown as Parameters<typeof dispatchIncoming>[0];

    await dispatchIncoming(
      client,
      handlers,
      { app: { id: "my-app", name: "My App" }, token: "my-token" },
      { type: "sdk.invoke", callId: "call-x", name: "test.capture", input: {} } as unknown as WsClientMessage,
      makeLogger(false),
    );

    expect(captured).toHaveLength(1);
    const ctx = captured[0]!;
    expect(ctx.app.id).toBe("my-app");
    expect(ctx.call.id).toBe("call-x");
    expect(ctx.call.capability).toBe("test.capture");
    expect(ctx.call.token).toBe("my-token");
    expect(typeof ctx.log.info).toBe("function");
  });
});

describe("makeLogger() — Logger shape (Phase 5)", () => {
  it("returns an object with info/warn/error no-ops or console functions", () => {
    const logger = makeLogger(false);
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    // Should not throw when called
    expect(() => logger.info("test", { k: "v" })).not.toThrow();
  });
});