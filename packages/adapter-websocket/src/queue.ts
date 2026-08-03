/*
 * Code Map: adapter-websocket per-connection outbound queue
 * - enqueueFrame: append + byte-budget enforcement (FIFO drop oldest) + optional stats arm
 * - drainQueue: serialize socket.send (one frame in flight per connection)
 * - clearQueue: timer cleanup + bufferedBytes reset on socket close
 *
 * CID Index:
 * CID:queue-001 -> enqueueFrame
 * CID:queue-002 -> drainQueue
 * CID:queue-003 -> clearQueue
 * CID:queue-004 -> armStats
 * CID:queue-005 -> QueueOptions
 *
 * Quick lookup: rg -n "CID:queue-" packages/adapter-websocket/src/queue.ts
 */

import type { ConnectionRecord, ServerFrame } from "./types.js";

// CID:queue-005 - QueueOptions
// Purpose: shared queue knobs (byte budget + stats interval + outbound frame cap
//   + onFrameTooLarge hook). All four are constructed per-record by server.ts.
export interface QueueOptions {
  readonly maxBufferedBytes: number;
  readonly statsIntervalMs: number;
  readonly maxFrameBytes?: number;
  readonly onFrameTooLarge?: () => void;
}

interface QueueState {
  options: QueueOptions;
  sending: boolean;
  sendingBytes: number;
}

// Per-record state lives in a WeakMap so ConnectionRecord stays free of
// transport-internal fields (the queue module owns the bookkeeping).
const states = new WeakMap<ConnectionRecord, QueueState>();

function stateFor(record: ConnectionRecord, options?: QueueOptions): QueueState {
  const existing = states.get(record);
  if (existing) {
    if (options) existing.options = options;
    return existing;
  }
  const state: QueueState = {
    options: options ?? { maxBufferedBytes: 1_048_576, statsIntervalMs: 1000 },
    sending: false,
    sendingBytes: 0,
  };
  states.set(record, state);
  return state;
}

// CID:queue-001 - enqueueFrame
// Purpose: serialize the frame, drop oldest until under the byte budget, arm
//   the stats timer on the first drop, then kick the drainer.
// Used by: server.ts (auth, subscribe, invoke paths) + fanout.ts (event relay)
//          + invoke.ts (result/error/partial/end)
export function enqueueFrame(record: ConnectionRecord, frame: ServerFrame, options: QueueOptions): void {
  const state = stateFor(record, options);
  const serialized = JSON.stringify(frame);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (state.options.maxFrameBytes !== undefined && bytes > state.options.maxFrameBytes) {
    state.options.onFrameTooLarge?.();
    return;
  }
  record.queue.push({ frame, bytes });
  record.bufferedBytes += bytes;
  while (record.bufferedBytes > state.options.maxBufferedBytes && record.queue.length > 0) {
    const dropped = record.queue.shift();
    if (!dropped) break;
    record.bufferedBytes -= dropped.bytes;
    record.dropped += 1;
  }
  armStats(record, state);
  drainQueue(record);
}

// CID:queue-002 - drainQueue
// Purpose: serialize socket.send via the `sending` flag; release bytes only
//   after the send callback fires. Bounds to one frame in flight per connection.
export function drainQueue(record: ConnectionRecord): void {
  const state = stateFor(record);
  if (state.sending || record.queue.length === 0) return;
  if (record.socket.readyState !== 1) return;
  const item = record.queue.shift();
  if (!item) return;
  state.sending = true;
  state.sendingBytes = item.bytes;
  const done = (): void => {
    if (!state.sending) return;
    record.bufferedBytes = Math.max(0, record.bufferedBytes - state.sendingBytes);
    state.sending = false;
    state.sendingBytes = 0;
    drainQueue(record);
  };
  try {
    record.socket.send(JSON.stringify(item.frame), done);
  } catch {
    done();
  }
}

// CID:queue-003 - clearQueue
// Purpose: drop pending frames + reset bufferedBytes + cancel the stats timer.
//   Called on socket close so a closed connection doesn't keep bookkeeping alive.
export function clearQueue(record: ConnectionRecord): void {
  const state = stateFor(record);
  if (record.statsTimer !== null) {
    clearTimeout(record.statsTimer);
    record.statsTimer = null;
  }
  record.queue = [];
  record.bufferedBytes = state.sending ? state.sendingBytes : 0;
}

// CID:queue-004 - armStats
// Purpose: one-shot stats timer that emits a single cumulative {type:"stats",
//   dropped:N} frame after `statsIntervalMs`. Re-armed only when `dropped > 0`
//   and no timer is pending — rate-limits to ~1/s in burst scenarios.
function armStats(record: ConnectionRecord, state: QueueState): void {
  if (record.dropped === 0 || record.statsTimer !== null) return;
  record.statsTimer = setTimeout(() => {
    record.statsTimer = null;
    enqueueFrame(record, { type: "stats", dropped: record.dropped }, state.options);
  }, state.options.statsIntervalMs);
}
