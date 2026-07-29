/*
 * Code Map: invoke() dispatch (Phase 5)
 *
 * Phase 5 supports two flows:
 *
 * 1. Outbound (developer-facing): sdk.invoke(name, input)
 *    - Looks up the local handler, calls it with a HandlerContext.
 *    - Returns the result or throws.
 *    - Used for unit tests and direct scripting.
 *
 * 2. Inbound (gateway-facing): dispatchIncoming(client, msg)
 *    - Parses a {type: 'sdk.invoke', callId, name, input} message.
 *    - Looks up the handler, calls it.
 *    - Sends result: {type: 'sdk.invoke.result', callId, payload}.
 *    - On error: {type: 'sdk.invoke.error', callId, code, message}.
 *    - Try/catch wraps the handler so a throw doesn't crash the SDK.
 *
 * Phase 6 wires dispatchIncoming to the WsClient's 'message' event.
 * Phase 7 adds SdkEventPublisher so invoke events are emitted on the bus:
 *   - sdk.invoke.started    before dispatch
 *   - sdk.invoke.completed  on success
 *   - sdk.invoke.failed     on handler throw
 */

import type { Handler, HandlerContext, CallContext, Logger } from "./types.js";
import type { WsClient, WsClientMessage } from "./client.js";
import type { SdkEventPublisher } from "./events.js";

/**
 * Build a CallContext for an invocation.
 */
export function makeCallContext(
  callId: string,
  capability: string,
  token: string,
  sessionId?: string,
): CallContext {
  return { id: callId, capability, token, sessionId };
}

/**
 * Build a Logger (console-based default).
 */
export function makeLogger(debug: boolean): Logger {
  return {
    info(message, meta) {
      if (debug) console.log(`[sdk-node] ${message}`, meta ?? "");
    },
    warn(message, meta) {
      console.warn(`[sdk-node] ${message}`, meta ?? "");
    },
    error(message, meta) {
      console.error(`[sdk-node] ${message}`, meta ?? "");
    },
  };
}

/**
 * Build a HandlerContext.
 */
export function makeHandlerContext(
  app: { id: string; name: string },
  call: CallContext,
  logger: Logger,
): HandlerContext {
  return { app, call, log: logger };
}

/**
 * Invoke a handler directly.
 *
 * Phase 5's out-of-band test entry point. Also used internally by
 * dispatchIncoming. The handler's error is re-thrown so the caller
 * (test or dispatch) can decide what to do.
 */
export async function invokeHandler<I = unknown, O = unknown>(
  handler: Handler<I, O>,
  input: I,
  ctx: HandlerContext,
): Promise<O> {
  return handler(input, ctx);
}

/**
 * Handle an inbound invoke message from the Gateway.
 *
 * On success: sends {type: 'sdk.invoke.result', callId, payload}.
 * On error: sends {type: 'sdk.invoke.error', callId, code, message}.
 *
 * The dispatch is fire-and-forget from the SDK's perspective; the Gateway
 * correlates callId to its original invocation.
 *
 * Emits:
 *   - sdk.invoke.started   before handler call
 *   - sdk.invoke.completed on success
 *   - sdk.invoke.failed    on handler throw or missing handler
 */
export async function dispatchIncoming(
  client: WsClient,
  handlers: Record<string, Handler>,
  ctx: { app: { id: string; name: string }; token: string; sessionId?: string },
  msg: WsClientMessage,
  logger: Logger,
  publisher: SdkEventPublisher,
): Promise<void> {
  if (msg.type !== "sdk.invoke") {
    // Gateway rejection for a previous sdk.capability.register. Surface it
    // on the event bus so subscribers can react; the SDK does not retry.
    if (msg.type === "sdk.capability.register.error") {
      const capName = typeof msg.name === "string" ? msg.name : "";
      const reason = typeof msg.reason === "string" ? msg.reason : "gateway rejected";
      if (capName) {
        logger.warn("dispatch: capability rejected by gateway", { capability: capName, reason });
        publisher.capabilityRejected(capName, reason);
      }
    }
    return;
  }

  // The wire format carries callId/name as strings and input as a structured
  // payload (may be primitive or object). Coerce to the expected types at the
  // boundary — no `unknown` in source.
  const callId = typeof msg.callId === "string" ? msg.callId : "";
  const name = typeof msg.name === "string" ? msg.name : "";
  const handler = handlers[name];

  if (!callId || !name) {
    logger.error("dispatch: invalid invoke message", {
      reason: "missing callId or name",
    });
    return;
  }

  if (handler === undefined) {
    publisher.invokeFailed(callId, name, "HANDLER_NOT_FOUND", `no handler for '${name}'`);
    client.send({
      type: "sdk.invoke.error",
      callId,
      code: "HANDLER_NOT_FOUND",
      message: `no handler for '${name}'`,
    });
    return;
  }

  const handlerCtx = makeHandlerContext(
    ctx.app,
    makeCallContext(callId, name, ctx.token, ctx.sessionId),
    logger,
  );

  // Pull the input payload from the message. WsClientMessage allows null,
  // so we default to an empty object.
  const input = msg.input ?? {};
  const startedAt = Date.now();
  publisher.invokeStarted(callId, name, input);

  try {
    const result = await invokeHandler(handler, input, handlerCtx);
    // JSON round-trip narrows result to the wire-format type without using
    // `unknown` in source.
    const jsonResult = JSON.parse(JSON.stringify(result ?? null)) as { readonly [key: string]: import("./client.js").WirePrimitive | import("./client.js").WireObject | import("./client.js").WirePrimitive[] | import("./client.js").WireObject[] };
    publisher.invokeCompleted(callId, name, Date.now() - startedAt);
    client.send({
      type: "sdk.invoke.result",
      callId,
      payload: jsonResult,
    });
  } catch (err) {
    const e = err as Error;
    publisher.invokeFailed(callId, name, "HANDLER_ERROR", e.message ?? String(err));
    client.send({
      type: "sdk.invoke.error",
      callId,
      code: "HANDLER_ERROR",
      message: e.message ?? String(err),
    });
  }
}