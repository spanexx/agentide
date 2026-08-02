/**
 * Phase 4 — WebSocket client (GRILL T5).
 *
 * Transport: `globalThis.WebSocket` only — no polyfill, no fallback (T5 Q4).
 * Handshake: the FIRST message after `onopen` is `{ type: "sdk.auth",
 * token }` (T5 Q1) — there is no Authorization header; the JWT itself is the
 * credential, and its signed `expectedOrigins` claim binds the origin.
 *
 * Reconnect (T3): backoff 1s, 2s, 4s, 8s, 16s, capped at 30s, ±20% jitter.
 * `backoffIdx` increments on ATTEMPT (not on drop) and resets on a
 * successful open. A close with code 1008 (origin mismatch) is terminal:
 * `disconnected` with NO reconnect — the pending timer is cleared so a
 * zombie reconnect can never resurrect the binding (GRILL T5 Q2).
 *
 * Lifecycle gates (visibility / offline / pagehide) live in Phase 5; this
 * client exposes pauseReconnect / reconnectNow / markSocketDead for them.
 */

import type { BackendValue } from "@platform/backend-runtime";
import type { ConnectionState } from "./types.js";

/** Gateway→SDK wire message that triggers a dispatch (Phase 3 fan-out). */
export interface InvokeMessage {
  type: "sdk.invoke";
  capability: string;
  input?: BackendValue;
}

/** Callbacks the client fires into the state/event wiring (Phases 5). */
export interface ClientHooks {
  onState(state: ConnectionState): void;
  onInvoke(message: InvokeMessage): void;
}

/** Backoff ladder — 1s → 30s cap (GRILL T3). */
const BACKOFF_BASE_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class SdkClient {
  private ws: WebSocket | null = null;
  private current: ConnectionState = "disconnected";
  private backoffIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deliberate = false;
  private reconnectPending = false;

  constructor(
    private readonly gateway: string,
    private readonly token: string,
    private readonly hooks: ClientHooks,
  ) {}

  get connectionState(): ConnectionState {
    return this.current;
  }

  /** Open (or reopen) the socket. No-op while connecting/connected. */
  connect(): void {
    if (this.ws !== null) {
      const ready = this.ws.readyState;
      if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return;
    }
    this.clearTimer();
    this.reconnectPending = false;
    this.deliberate = false;
    this.setState("connecting");

    const ws = new globalThis.WebSocket(this.gateway);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale socket
      // Auth-first: the very first frame on the wire (T5 Q1).
      ws.send(JSON.stringify({ type: "sdk.auth", token: this.token }));
      this.backoffIdx = 0;
      this.setState("connected");
    };

    ws.onclose = (ev) => this.handleClose(ev);

    ws.onmessage = (ev) => {
      let message: { type?: string };
      try {
        message = JSON.parse(String(ev.data));
      } catch {
        return; // non-JSON frames are ignored
      }
      if (message.type === "sdk.invoke") {
        this.hooks.onInvoke(message as InvokeMessage);
      }
    };
  }

  /** Deliberate teardown — close(1000), no reconnect, timer cleared. */
  disconnect(): void {
    this.deliberate = true;
    this.clearTimer();
    this.reconnectPending = false;
    const ws = this.ws;
    this.ws = null;
    if (ws !== null) {
      try {
        ws.close(1000, "deliberate");
      } catch {
        /* already closed */
      }
    }
    this.setState("disconnected");
  }

  /**
   * Lifecycle gate — visibility hidden (T3 Q1): cancel a pending reconnect
   * but remember it, so `reconnectNow()` fires immediately on visible.
   */
  pauseReconnect(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.reconnectPending = true;
    }
  }

  /** Lifecycle gate — visible / online (T3 Q1/Q2): fire immediately. */
  reconnectNow(): void {
    const wasPending = this.timer !== null || this.reconnectPending;
    this.clearTimer();
    this.reconnectPending = false;
    if (!wasPending) return;
    if (this.ws === null || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }
  }

  /** Lifecycle gate — offline (T3 Q2): drop the socket, no auto-reconnect. */
  markSocketDead(): void {
    this.deliberate = true;
    this.clearTimer();
    this.reconnectPending = false;
    this.ws = null;
    this.setState("disconnected");
  }

  /** Online (T3 Q2): backoff resets; reconnectNow fires immediately. */
  resetBackoff(): void {
    this.backoffIdx = 0;
  }

  /** Send a structured message to the Gateway (best-effort when open). */
  send(message: object): void {
    const ws = this.ws;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private handleClose(ev: { code: number }): void {
    if (this.deliberate) return; // teardown already handled
    if (ev.code === 1008) {
      // Origin binding failed — terminal. Clear any pending reconnect so
      // the socket can never come back with the wrong origin.
      this.clearTimer();
      this.reconnectPending = false;
      this.ws = null;
      this.setState("disconnected");
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearTimer();
    this.setState("reconnecting");
    const slot = Math.min(this.backoffIdx, BACKOFF_BASE_MS.length - 1);
    this.backoffIdx += 1; // increments on ATTEMPT
    const base = BACKOFF_BASE_MS[slot];
    const jitter = 0.8 + Math.random() * 0.4; // ±20%
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, base * jitter);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (state === this.current) return;
    this.current = state;
    this.hooks.onState(state);
  }
}
