/*
 * Code Map: adapter-websocket per-connection registry
 * - add: open a record (auto-incrementing ws-<n> id, fresh timers + queue)
 * - get / remove / snapshot / clear / count: lookup primitives for server.ts
 *
 * A1 migration: bookkeeping primitives now live in @spanexx/adapter-core
 * (RecordRegistry<T>). This file stays as the door's thin wrapper: it keeps
 * the ConnectionRecord shape + `ws-<n>` id naming (door bytes), and hands the
 * record factory into the generic store.
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
import { RecordRegistry } from "@spanexx/adapter-core";
import type { ConnectionRecord } from "./types.js";

interface AddInputs {
  readonly socket: WSWebSocket;
  readonly origin: string | undefined;
}

// CID:registry-001 - add
// Pure in-memory record store. ConnectionRecord owns the transport-visible
// fields (id, socket, origin, state machine, queue, timers); the generic core
// registry owns the nextId counter, we own the record shape.
export class ConnectionRegistry {
  private readonly records: RecordRegistry<ConnectionRecord, AddInputs>;

  constructor() {
    this.records = new RecordRegistry<ConnectionRecord, AddInputs>({
      prefix: "ws",
      create: (id, extra) => ({
        id,
        socket: extra.socket,
        origin: extra.origin,
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
      }),
    });
  }

  add(socket: WSWebSocket, origin: string | undefined): ConnectionRecord {
    return this.records.add({ socket, origin });
  }

  get(id: string): ConnectionRecord | undefined {
    return this.records.get(id);
  }

  remove(id: string): ConnectionRecord | undefined {
    return this.records.remove(id);
  }

  snapshot(): ConnectionRecord[] {
    return this.records.snapshot();
  }

  clear(): ConnectionRecord[] {
    return this.records.clear();
  }

  count(): number {
    return this.records.count();
  }
}
