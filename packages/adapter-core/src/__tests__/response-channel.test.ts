import { describe, expect, it } from "vitest";
import { createResponseChannel, type ResponseChannelSink } from "../response-channel.js";

function recordingSink(): { sink: ResponseChannelSink; calls: string[]; chunks: unknown[]; events: unknown[] } {
  const calls: string[] = [];
  const chunks: unknown[] = [];
  const events: unknown[] = [];
  const sink: ResponseChannelSink = {
    emitChunk(chunk) { calls.push("chunk"); chunks.push(chunk); },
    emitEvent(topic, payload) { calls.push(`event:${topic}`); events.push(payload); },
    emitResult(output) { calls.push("result"); chunks.push(output); },
    emitError(error) { calls.push("error"); chunks.push(error); },
  };
  return { sink, calls, chunks, events };
}

describe("createResponseChannel", () => {
  it("streams chunks in order through the sink", () => {
    const { sink, calls, chunks } = recordingSink();
    const ch = createResponseChannel("c1", sink);
    ch.emit({ n: 1 });
    ch.emit({ n: 2 });
    ch.end({ done: true });
    expect(calls).toEqual(["chunk", "chunk", "result"]);
    expect(chunks).toEqual([{ n: 1 }, { n: 2 }, { done: true }]);
  });

  it("routes terminal error to emitError", () => {
    const { sink, calls } = recordingSink();
    const ch = createResponseChannel("c2", sink);
    ch.endError({ code: "WS_INTERNAL", message: "boom" });
    expect(calls).toEqual(["error"]);
  });

  it("emits events before end only", () => {
    const { sink, calls, events } = recordingSink();
    const ch = createResponseChannel("c3", sink);
    ch.event("job.progress", { pct: 50 });
    ch.end({ done: true });
    expect(calls).toEqual(["event:job.progress", "result"]);
    expect(events).toEqual([{ pct: 50 }]);
  });

  it("throws on emit after end", () => {
    const { sink } = recordingSink();
    const ch = createResponseChannel("c4", sink);
    ch.end({ done: true });
    expect(() => ch.emit({ n: 3 })).toThrow(/after end/);
  });

  it("throws on event after end", () => {
    const { sink } = recordingSink();
    const ch = createResponseChannel("c5", sink);
    ch.end({ done: true });
    expect(() => ch.event("late.topic", {})).toThrow(/after end/);
  });

  it("throws on double end", () => {
    const { sink } = recordingSink();
    const ch = createResponseChannel("c6", sink);
    ch.end({ done: true });
    expect(() => ch.end({ again: true })).toThrow(/exactly-once/);
  });

  it("throws on end after endError", () => {
    const { sink } = recordingSink();
    const ch = createResponseChannel("c7", sink);
    ch.endError({ code: "X", message: "err" });
    expect(() => ch.end({ done: true })).toThrow(/exactly-once/);
  });

  it("keeps the correlation id readable", () => {
    const { sink } = recordingSink();
    const ch = createResponseChannel("abc-123", sink);
    expect(ch.correlationId).toBe("abc-123");
  });
});
