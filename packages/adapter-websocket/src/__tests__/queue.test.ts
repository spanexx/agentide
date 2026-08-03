import { describe, expect, it, vi } from "vitest";
import type { WebSocket as WSWebSocket } from "ws";
import { ConnectionRegistry } from "../registry.js";
import { enqueueFrame, type QueueOptions } from "../queue.js";
import type { ServerFrame } from "../types.js";

function frame(message: string): ServerFrame {
  return { type: "error", code: "WS_INTERNAL", message };
}

function options(maxBufferedBytes: number): QueueOptions {
  return { maxBufferedBytes, statsIntervalMs: 1000 };
}

describe("outbound queue", () => {
  it("drops oldest queued frames when the byte budget is exceeded", () => {
    const socket = { readyState: 0 } as WSWebSocket;
    const record = new ConnectionRegistry().add(socket, undefined);
    enqueueFrame(record, frame("one"), options(120));
    enqueueFrame(record, frame("two"), options(120));
    enqueueFrame(record, frame("three"), options(120));
    expect(record.dropped).toBe(1);
    expect(record.queue.map((item) => (item.frame as { message: string }).message)).toEqual(["two", "three"]);
  });

  it("drains FIFO and releases bytes only after send completion", () => {
    const callbacks: Array<() => void> = [];
    const sent: string[] = [];
    const socket = {
      readyState: 1,
      send(data: string, callback: () => void) {
        sent.push(data);
        callbacks.push(callback);
      },
    } as unknown as WSWebSocket;
    const record = new ConnectionRegistry().add(socket, undefined);
    enqueueFrame(record, frame("one"), options(120));
    enqueueFrame(record, frame("two"), options(120));
    expect(sent).toHaveLength(1);
    callbacks.shift()?.();
    expect(sent).toHaveLength(2);
    callbacks.shift()?.();
    expect(record.bufferedBytes).toBe(0);
  });

  it("emits one cumulative stats frame after a drop burst", () => {
    vi.useFakeTimers();
    try {
      const socket = { readyState: 0 } as WSWebSocket;
      const record = new ConnectionRegistry().add(socket, undefined);
      enqueueFrame(record, frame("one"), options(120));
      enqueueFrame(record, frame("two"), options(120));
      enqueueFrame(record, frame("three"), options(120));
      vi.advanceTimersByTime(1000);
      expect(record.queue.some((item) => item.frame.type === "stats")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes oversized outbound frames to the close callback", () => {
    const socket = { readyState: 0 } as WSWebSocket;
    const record = new ConnectionRegistry().add(socket, undefined);
    let oversized = 0;
    enqueueFrame(record, frame("too large"), {
      ...options(120),
      maxFrameBytes: 10,
      onFrameTooLarge: () => { oversized += 1; },
    });
    expect(oversized).toBe(1);
    expect(record.queue).toHaveLength(0);
  });
});
