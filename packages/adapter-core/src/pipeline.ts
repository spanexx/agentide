/*
 * Code Map: adapter-core invocation pipeline (A1)
 * - createAdapterPipeline: the shared server-side invocation seam. Door hands
 *   in: gateway handle, error converter (A5), and a response-sink factory
 *   (A4, packaging door-local). The pipeline owns dispatch: handleInvocation →
 *   route output/error through the per-invocation ResponseChannel.
 *
 * A1 contract mapping:
 *   {gateway, config, input, output, errors, response} → options.gateway,
 *   options.response (sink factory); config passthrough is omitted in v1 —
 *   per-invocation input/output flow through invoke() args, errors via the
 *   shared ErrorConverter (A5 Option A default -32006).
 *
 * Emits NO events; imports @spanexx/gateway-core at runtime (A1).
 * Internal-error rendering (e.g. WS_INTERNAL frames) stays in the door's
 * try/catch — door-local bytes per A5 (zero wire delta).
 *
 * CID Index:
 * CID:adapter-core-007 -> createAdapterPipeline + AdapterPipeline + PipelineInvocation
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import type { ErrorConverter } from "./error-converter.js";
import { createResponseChannel, type ResponseChannelSink } from "./response-channel.js";

// CID:adapter-core-007 - PipelineInvocation
// Purpose: protocol-agnostic invocation input (one per request). `mode`
//   mirrors the WS wire ("call" | "stream"); v1 streams by emitting the
//   single-shot output as a chunk then ending (kernel streaming is additive,
//   future.md #1).
export interface PipelineInvocation {
  readonly correlationId: string;
  readonly token: string;
  readonly name: string;
  readonly input?: YamlValue;
  readonly sessionId?: string;
  readonly mode?: "call" | "stream";
}

export interface AdapterPipelineOptions {
  readonly gateway: Gateway;
  /** Shared converter with the door's table (A5). */
  readonly errors: ErrorConverter;
  /** Door strategy factory: builds the packaging sink for one correlation id. */
  readonly response: (correlationId: string) => ResponseChannelSink;
}

export interface AdapterPipeline {
  readonly gateway: Gateway;
  invoke(invocation: PipelineInvocation): Promise<void>;
}

// CID:adapter-core-007 - createAdapterPipeline
// Purpose: wire the canonical invocation path once, share it across doors.
//   Success → end(output); stream mode → emit(chunk) then end; error →
//   endError(converted). Exact-once terminal semantics enforced by the
//   ResponseChannel (A4).
export function createAdapterPipeline(options: AdapterPipelineOptions): AdapterPipeline {
  const { gateway, errors, response } = options;

  return {
    gateway,
    async invoke(invocation) {
      const channel = createResponseChannel(invocation.correlationId, response(invocation.correlationId));
      const result = await gateway.handleInvocation({
        token: invocation.token,
        capability: { name: invocation.name },
        // Preserve explicit null input (WS test c5); default only on undefined.
        input: invocation.input === undefined ? {} : invocation.input,
        ...(invocation.sessionId === undefined ? {} : { sessionId: invocation.sessionId }),
      });
      if ("error" in result) {
        channel.endError(errors(result.error));
        return;
      }
      if (invocation.mode === "stream") {
        channel.emit(result.output);
        // Sink drops the payload when rendering invoke.end (door-local).
        channel.end(result.output);
        return;
      }
      channel.end(result.output);
    },
  };
}
