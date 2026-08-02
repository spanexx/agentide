/**
 * Phase 5 — state surface (GRILL T4 D3).
 *
 * `onStateChange` fires ONLY on real transitions between the four states
 * (connecting | connected | reconnecting | disconnected); `state()` returns
 * a synchronous snapshot. Capability inventory mirrors the registry, with
 * the connection-aware `registered` flag.
 */

import type { CapRegistry } from "./observer.js";
import type { ConnectionState, SdkState } from "./types.js";

export class StateStore {
  private current: ConnectionState = "disconnected";
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(private readonly registry: CapRegistry) {}

  /** Apply a client state. Deduplicates — same state is not a transition. */
  setConnection(state: ConnectionState): void {
    if (state === this.current) return;
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Subscribe; returns an unsubscribe handle. */
  onStateChange(cb: (state: ConnectionState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Synchronous snapshot (GRILL T4 D3). */
  state(): SdkState {
    return {
      connectionState: this.current,
      capabilities: this.registry.list(),
    };
  }
}
