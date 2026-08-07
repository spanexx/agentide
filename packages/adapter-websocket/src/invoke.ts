/*
 * Code Map: adapter-websocket invoke translation (call + stream)
 * - invokeFrame: dispatch a single client `invoke` frame to gateway.handleInvocation, map response → wire frames
 * - parseInvokeFrame: validate the inbound `invoke` shape (correlationId, name, mode, optional input/sessionId)
 *
 * A1/A4 migration: dispatch now delegates to @spanexx/adapter-core
 * createAdapterPipeline. This file keeps the door bytes: the WS sink renders
 * invoke.partial/invoke.end (stream) and invoke.result (call), errors pass
 * through verbatim (PRD Scenario 11 — no third vocabulary), and internal
 * failures render the WS_INTERNAL error frame (door-local try/catch, A5).
 *
 * CID Index:
 * CID:invoke-001 -> invokeFrame
 * CID:invoke-002 -> parseInvokeFrame
 *
 * Quick lookup: rg -n "CID:invoke-" packages/adapter-websocket/src/invoke.ts
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import { createAdapterPipeline, createErrorConverter, type DoorError } from "@spanexx/adapter-core";
import type { ConnectionRecord, InvokeFrame, ServerFrame } from "./types.js";
import { enqueueFrame, type QueueOptions } from "./queue.js";

export type InvokeOptions = QueueOptions;

// WS door error table (A5): identity passthrough — gateway codes ride the
// wire verbatim (PRD Scenario 11), so the shared converter's default is set
// to carry code/message/details unchanged.
const wsConverter = createErrorConverter({
  defaultError: (payload) => ({
    code: payload.code,
    message: payload.message,
    details: payload.details,
  }),
});

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
  const pipeline = createAdapterPipeline({
    gateway,
    errors: wsConverter,
    response: (correlationId) => wsSink(record, frame, correlationId, options),
  });
  try {
    await pipeline.invoke({
      correlationId: frame.correlationId,
      token: record.token,
      name: frame.name,
      input: frame.input,
      sessionId: frame.sessionId,
      mode: frame.mode,
    });
  } catch {
    enqueueFrame(record, invalidFrame("invocation failed", "WS_INTERNAL"), options);
  }
}

// WS door sink (A4): packaging is door-local. Stream renders invoke.partial +
// invoke.end; call renders invoke.result; errors render invoke.error verbatim.
function wsSink(
  record: ConnectionRecord,
  frame: InvokeFrame,
  correlationId: string,
  options: InvokeOptions,
) {
  const streaming = frame.mode === "stream";
  return {
    emitChunk(chunk: YamlValue) {
      enqueueFrame(record, { type: "invoke.partial", correlationId, output: chunk }, options);
    },
    emitEvent() {
      // v1: no event frames in the invoke path (future.md #2/#4).
    },
    emitResult(output: YamlValue) {
      if (streaming) {
        enqueueFrame(record, { type: "invoke.end", correlationId }, options);
        return;
      }
      enqueueFrame(record, { type: "invoke.result", correlationId, output }, options);
    },
    emitError(error: DoorError) {
      const errorFrame: ServerFrame = {
        type: "invoke.error",
        correlationId,
        code: error.code as string,
        message: error.message,
        details: error.details,
      };
      enqueueFrame(record, errorFrame, options);
    },
  };
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
