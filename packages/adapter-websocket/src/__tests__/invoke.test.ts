import { describe, expect, it } from "vitest";
import type { CanonicalInvocation, CanonicalResponse, Gateway } from "@platform/gateway-core";
import type { WebSocket as WSWebSocket } from "ws";
import { ConnectionRegistry } from "../registry.js";
import { invokeFrame, parseInvokeFrame, type InvokeOptions } from "../invoke.js";
import type { InvokeFrame } from "../types.js";

const options: InvokeOptions = { maxBufferedBytes: 1_048_576, statsIntervalMs: 1000 };

function gateway(response: CanonicalResponse, seen?: CanonicalInvocation[]): Gateway {
  return {
    handleInvocation: async (request) => {
      seen?.push(request);
      return response;
    },
  } as Gateway;
}

function record() {
  const connection = new ConnectionRegistry().add({ readyState: 0 } as WSWebSocket, undefined);
  connection.token = "verified-token";
  return connection;
}

describe("invoke translation", () => {
  it("maps a successful call response to invoke.result", async () => {
    const connection = record();
    const frame: InvokeFrame = { type: "invoke", correlationId: "c1", name: "capability.list" };
    await invokeFrame(connection, frame, gateway({ output: { ok: true } }), options);
    expect(connection.queue[0].frame).toEqual({ type: "invoke.result", correlationId: "c1", output: { ok: true } });
  });

  it("passes gateway error codes and details through unchanged", async () => {
    const connection = record();
    const frame: InvokeFrame = { type: "invoke", correlationId: "c2", name: "session.list" };
    await invokeFrame(connection, frame, gateway({
      error: { code: "SESSION_NOT_FOUND", message: "missing", details: { id: "s1" }, retryable: false },
    }), options);
    expect(connection.queue[0].frame).toEqual({
      type: "invoke.error",
      correlationId: "c2",
      code: "SESSION_NOT_FOUND",
      message: "missing",
      details: { id: "s1" },
    });
  });

  it("wraps a call result in partial and end frames for stream mode", async () => {
    const connection = record();
    const frame: InvokeFrame = { type: "invoke", correlationId: "c3", name: "capability.list", mode: "stream" };
    await invokeFrame(connection, frame, gateway({ output: { ok: true } }), options);
    expect(connection.queue.map((item) => item.frame)).toEqual([
      { type: "invoke.partial", correlationId: "c3", output: { ok: true } },
      { type: "invoke.end", correlationId: "c3" },
    ]);
  });

  it("translates optional input and session id to the canonical invocation", async () => {
    const seen: CanonicalInvocation[] = [];
    const connection = record();
    const frame: InvokeFrame = {
      type: "invoke",
      correlationId: "c4",
      name: "session.list",
      input: { filter: "active" },
      sessionId: "s1",
    };
    await invokeFrame(connection, frame, gateway({ output: [] }, seen), options);
    expect(seen[0]).toMatchObject({ token: "verified-token", capability: { name: "session.list" }, input: { filter: "active" }, sessionId: "s1" });
  });

  it("preserves explicit null input", async () => {
    const seen: CanonicalInvocation[] = [];
    const connection = record();
    const frame: InvokeFrame = { type: "invoke", correlationId: "c5", name: "system.health", input: null };
    await invokeFrame(connection, frame, gateway({ output: { ok: true } }, seen), options);
    expect(seen[0].input).toBeNull();
  });
});

describe("parseInvokeFrame", () => {
  it("rejects missing correlation ids, names, and invalid modes", () => {
    expect(parseInvokeFrame({ type: "invoke", name: "x" })).toBeNull();
    expect(parseInvokeFrame({ type: "invoke", correlationId: "c", name: "" })).toBeNull();
    expect(parseInvokeFrame({ type: "invoke", correlationId: "c", name: "x", mode: "bad" })).toBeNull();
  });
});
