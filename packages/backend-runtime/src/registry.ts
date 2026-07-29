/*
 * Code Map: ConnectionRegistry — appId-keyed map of connected SDKs
 * - accept: register a new connection; replace prior connection for the same appId
 *   (closes the prior socket; emits nothing — the caller decides what to publish)
 * - get / remove / count / entries / clear: lookup primitives
 *
 * Pure in-memory store. No timers, no events. Server.ts composes this with
 * ws.Server + event publishing.
 *
 * CID Index:
 * CID:registry-001 -> ConnectionRegistry.accept
 * CID:registry-002 -> ConnectionRegistry.get
 * CID:registry-003 -> ConnectionRegistry.remove
 * CID:registry-004 -> ConnectionRegistry.clear
 * CID:registry-005 -> ConnectionRegistry.entries
 * CID:registry-006 -> ConnectionRegistry.count
 */

import type { BackendConnection, Clock, WebSocketLike } from "./types.js";

export class ConnectionRegistry {
  private readonly map = new Map<string, BackendConnection>();

  /**
   * CID:registry-001 - accept
   * Register a new connection for `appId`. If a connection is already registered
   * for the same `appId`, the prior connection's socket is closed and the prior
   * BackendConnection is returned (so the caller can decide whether to publish a
   * `closed` event). If no prior connection existed, returns null.
   * The new connection becomes the active one.
   * Defensive: a close() throw does not propagate — the registry stays consistent.
   *
   * `connectedAt` is set to `clock.now()` at accept time.
   */
  accept(appId: string, socket: WebSocketLike, clock: Clock): BackendConnection | null {
    const previous = this.map.get(appId) ?? null;
    if (previous) {
      try {
        previous.socket.close();
      } catch {
        // Defensive: stale socket may throw on close. Do not propagate.
      }
    }
    const conn: BackendConnection = {
      appId,
      connectedAt: clock.now(),
      capabilities: [],
      socket,
    };
    this.map.set(appId, conn);
    return previous;
  }

  /** CID:registry-002 - get */
  get(appId: string): BackendConnection | undefined {
    return this.map.get(appId);
  }

  /**
   * CID:registry-003 - remove
   * Remove the entry for `appId`. Returns the removed connection (or undefined
   * if no entry existed). Idempotent — second call returns undefined.
   */
  remove(appId: string): BackendConnection | undefined {
    const conn = this.map.get(appId);
    this.map.delete(appId);
    return conn;
  }

  /**
   * CID:registry-004 - clear
   * Remove every entry and return a snapshot of the prior entries as an array.
   * Used by stop() before closing sockets so close handlers can detect
   * "I'm being torn down, don't publish a `dropped` event".
   */
  clear(): BackendConnection[] {
    const snapshot = [...this.map.values()];
    this.map.clear();
    return snapshot;
  }

  /** CID:registry-005 - entries */
  *entries(): IterableIterator<[string, BackendConnection]> {
    yield* this.map.entries();
  }

  /** CID:registry-006 - count */
  count(): number {
    return this.map.size;
  }
}