/*
 * Code Map: adapter-websocket per-connection registry
 * - add: open a record (auto-incrementing ws-<n> id, fresh timers + queue)
 * - get / remove / snapshot / clear / count: lookup primitives for server.ts
 *
 * CID Index:
 * CID:registry-001 -> add
 * CID:registry-002 -> get
 * CID:registry-003 -> remove
 * CID:registry-004 -> snapshot
 * CID:registry-005 -> clear
 * CID:registry-006 -> count
 *
 * Quick lookup: rg -n "CID:registry-" packages/adapter-websocket/src/registry.ts
 */

import type { WebSocket as WSWebSocket } from "ws";
import type { ConnectionRecord } from "./types.js";

// CID:registry-001 - add
// Pure in-memory record store. ConnectionRecord owns the transport-visible
// fields (id, socket, origin, state machine, queue, timers); this class is the
// only place the nextId counter lives.
export class ConnectionRegistry {
  private readonly records = new Map<string, ConnectionRecord>();
  private nextId = 1;

  add(socket: WSWebSocket, origin: string | undefined): ConnectionRecord {
    const record: ConnectionRecord = {
      id: `ws-${this.nextId++}`,
      socket,
      origin,
      state: "open",
      token: null,
      claims: null,
      subs: new Map(),
      queue: [],
      bufferedBytes: 0,
      dropped: 0,
      statsTimer: null,
      preAuthTimer: null,
      heartbeatTimer: null,
      pongTimer: null,
      awaitingPong: false,
      closeReason: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  get(id: string): ConnectionRecord | undefined {
    return this.records.get(id);
  }

  remove(id: string): ConnectionRecord | undefined {
    const record = this.records.get(id);
    this.records.delete(id);
    return record;
  }

  snapshot(): ConnectionRecord[] {
    return [...this.records.values()];
  }

  clear(): ConnectionRecord[] {
    const records = this.snapshot();
    this.records.clear();
    return records;
  }

  count(): number {
    return this.records.size;
  }
}
