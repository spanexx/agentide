/*
 * Code Map: adapter-websocket invoke translation (call + stream)
 * - invokeFrame: dispatch a single client `invoke` frame to gateway.handleInvocation, map response → wire frames
 * - parseInvokeFrame: validate the inbound `invoke` shape (correlationId, name, mode, optional input/sessionId)
 *
 * CID Index:
 * CID:invoke-001 -> invokeFrame
 * CID:invoke-002 -> parseInvokeFrame
 *
 * Quick lookup: rg -n "CID:invoke-" packages/adapter-websocket/src/invoke.ts
 */

import type { Gateway, YamlValue } from "@platform/gateway-core";
import type { ConnectionRecord, InvokeFrame, ServerFrame } from "./types.js";
import { enqueueFrame, type QueueOptions } from "./queue.js";

export type InvokeOptions = QueueOptions;

// CID:invoke-001 - invokeFrame
// Purpose: gateway translation surface for `invoke` frames (W1 REOPEN + W4).
//   - call mode → `{output}` → invoke.result; `{error}` → invoke.error (verbatim code/details)
//   - stream mode → one invoke.partial per single-shot result + invoke.end
//   - missing token → WS_INVALID_FRAME error (defensive: shouldn't happen post-auth)
//   - throw from handleInvocation → WS_INTERNAL error frame (never silent)
// Used by: server.ts handleMessage
export async function invokeFrame(
  record: ConnectionRecord,
  frame: InvokeFrame,
  gateway: Gateway,
  options: InvokeOptions,
): Promise<void> {
  if (record.token === null) {
    enqueueFrame(record, invalidFrame("connection is not authenticated"), options);
    return;
  }
  try {
    const response = await gateway.handleInvocation({
      token: record.token,
      capability: { name: frame.name },
      input: frame.input === undefined ? {} : frame.input,
      ...(frame.sessionId === undefined ? {} : { sessionId: frame.sessionId }),
    });
    if ("error" in response) {
      const errorFrame: ServerFrame = {
        type: "invoke.error",
        correlationId: frame.correlationId,
        code: response.error.code,
        message: response.error.message,
        details: response.error.details,
      };
      enqueueFrame(record, errorFrame, options);
      return;
    }
    if (frame.mode === "stream") {
      enqueueFrame(record, {
        type: "invoke.partial",
        correlationId: frame.correlationId,
        output: response.output,
      }, options);
      enqueueFrame(record, { type: "invoke.end", correlationId: frame.correlationId }, options);
      return;
    }
    enqueueFrame(record, {
      type: "invoke.result",
      correlationId: frame.correlationId,
      output: response.output,
    }, options);
  } catch {
    enqueueFrame(record, invalidFrame("invocation failed", "WS_INTERNAL"), options);
  }
}

// CID:invoke-002 - parseInvokeFrame
// Purpose: validate the wire-level `invoke` payload before the server commits
//   to the dispatch path. Returns null on any structural violation; the caller
//   surfaces WS_INVALID_FRAME.
export function parseInvokeFrame(value: Record<string, YamlValue>): InvokeFrame | null {
  if (value.type !== "invoke" || typeof value.correlationId !== "string" || value.correlationId.length === 0) return null;
  if (typeof value.name !== "string" || value.name.length === 0) return null;
  if (value.mode !== undefined && value.mode !== "call" && value.mode !== "stream") return null;
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") return null;
  return {
    type: "invoke",
    correlationId: value.correlationId,
    name: value.name,
    ...(value.input === undefined ? {} : { input: value.input }),
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(value.mode === undefined ? {} : { mode: value.mode }),
  } as InvokeFrame;
}

function invalidFrame(message: string, code = "WS_INVALID_FRAME"): ServerFrame {
  return { type: "error", code, message };
}
