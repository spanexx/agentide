/*
 * Code Map: adapter-core response channel (A4)
 * - createResponseChannel: per-invocation channel. One correlation id; the
 *   door supplies the sink (strategy factory) that packages chunks into wire
 *   frames — WS renders invoke.partial/invoke.end, MCP merges into one result.
 * - Terminal guarantees locked in v1:
 *     end()/endError() exactly once (second call throws)
 *     emit() after end throws
 *     event() only before end (throws after)
 * - Backpressure is adapter-local v1: emit() is synchronous, never awaited.
 *   Channel state lives per-invocation; queueing graduates to core as a
 *   future item (future.md #3).
 *
 * CID Index:
 * CID:adapter-core-006 -> ResponseChannel + ResponseChannelSink + createResponseChannel
 */

import type { YamlValue } from "@spanexx/gateway-core";
import type { DoorError } from "./error-converter.js";

// CID:adapter-core-006 - ResponseChannelSink
// Purpose: door-side packaging strategy. Core guarantees ordering + terminal
//   semantics; the door decides byte-level rendering (chunks shared
//   intermediate, packaging door-local per A4).
export interface ResponseChannelSink {
  /** Render one chunk — WS: invoke.partial; MCP: buffer into merged result. */
  emitChunk(chunk: YamlValue): void;
  /** Render a streamed event — only legal before end. */
  emitEvent(topic: string, payload: YamlValue): void;
  /** Render the terminal success — WS: invoke.result / invoke.end. */
  emitResult(output: YamlValue): void;
  /** Render the terminal error — WS: invoke.error; MCP: JSON-RPC error. */
  emitError(error: DoorError): void;
}

export interface ResponseChannel {
  readonly correlationId: string;
  /** Stream a chunk. Throws if the channel already ended. */
  emit(chunk: YamlValue): void;
  /** Emit a side event before the terminal frame. Throws after end. */
  event(topic: string, payload: YamlValue): void;
  /** Terminate successfully. Exactly once — second call throws. */
  end(output: YamlValue): void;
  /** Terminate with an error. Exactly once — second call throws. */
  endError(error: DoorError): void;
}

export function createResponseChannel(
  correlationId: string,
  sink: ResponseChannelSink,
): ResponseChannel {
  let ended = false;

  const assertOpen = (verb: string): void => {
    if (ended) throw new Error(`response channel ${correlationId}: ${verb} after end`);
  };

  const finish = (verb: string): void => {
    if (ended) throw new Error(`response channel ${correlationId}: ${verb} called twice (end is exactly-once)`);
    ended = true;
  };

  return {
    correlationId,
    emit(chunk) {
      assertOpen("emit");
      sink.emitChunk(chunk);
    },
    event(topic, payload) {
      assertOpen("event");
      sink.emitEvent(topic, payload);
    },
    end(output) {
      finish("end");
      sink.emitResult(output);
    },
    endError(error) {
      finish("endError");
      sink.emitError(error);
    },
  };
}
