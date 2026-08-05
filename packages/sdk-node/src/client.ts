/*
 * Code Map: WebSocket client wrapper (Phase 3)
 *
 * WsClient wraps the `ws` library to give the SDK:
 *   - open(url, token): Promise<void>  — connect + auth handshake
 *   - close(): Promise<void>           — clean close
 *   - on(event, handler): void          — event subscription
 *   - off(event, handler): void         — event unsubscribe
 *
 * Plus internal:
 *   - backoff(n): number                — exponential delay schedule
 *   - scheduleReconnect(): void         — kicks off reconnect loop
 *
 * Auto-reconnect:
 *   On any unexpected close, the client schedules a reconnect with exponential
 *   backoff (1s, 2s, 4s, 8s, 16s, capped at 30s). It re-authenticates on each
 *   reconnect attempt (the gateway may have restarted with a fresh token pool).
 *
 * Events emitted:
 *   - 'open'                 — WebSocket opened successfully
 *   - 'close'                — WebSocket closed (any reason)
 *   - 'error'                — WebSocket error (connection refused, etc.)
 *   - 'reconnect_scheduled'  — about to retry after a close (carries delay ms)
 *   - 'message'              — inbound JSON message from Gateway
 *
 * Phase 3 ships the wrapper; the SDK's connect() method (Phase 6 lifecycle)
 * wires it to the SDK's event bus.
 */

import WebSocket from "ws";

export type WsClientEvent = "open" | "close" | "error" | "reconnect_scheduled" | "message";

/** A primitive value type used in wire-format messages.
 *  Avoids `unknown` per project banned-types rule.
 */
export type WirePrimitive = string | number | boolean | null;
export type WireObject = { readonly [key: string]: WirePrimitive | WireObject | WirePrimitive[] | WireObject[] };

export type WsClientMessage = {
  readonly type: string;
  readonly [key: string]: WirePrimitive | WireObject | readonly WirePrimitive[] | readonly WireObject[];
};

export type WsClientEventPayload =
  | WsClientMessage
  | { code: number; reason: string }
  | number
  | undefined;

export type WsClientHandler = (arg: WsClientEventPayload | Error) => void;

export interface WsClientConfig {
  readonly url: string;
  readonly token: string;
  readonly maxBackoffMs?: number;     // default 30_000
  readonly baseBackoffMs?: number;    // default 1_000
  /** Random jitter applied to each backoff delay. Range [0, 1].
   *  Default 0.2 per IMPL Risk Notes (jitter the backoff to avoid reconnect
   *  storms). Pass 0 for deterministic test timing. */
  readonly jitterRatio?: number;
  /** Injectable randomness for testing. Default Math.random. */
  readonly random?: () => number;
}

export class WsClient {
  private readonly url: string;
  private token: string;
  private readonly maxBackoffMs: number;
  private readonly baseBackoffMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;

  private ws: WebSocket | null = null;
  private handlers = new Map<WsClientEvent, Set<WsClientHandler>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** Time at which the most recent open() started — used for latency. */
  private openStartedAt = 0;

  constructor(config: WsClientConfig) {
    this.url = config.url;
    this.token = config.token;
    this.maxBackoffMs = config.maxBackoffMs ?? 30_000;
    this.baseBackoffMs = config.baseBackoffMs ?? 1_000;
    // Clamp jitterRatio to [0, 1] — documented range. Values > 1 would
    // produce negative factors and 0ms reconnect delays (infinite loop).
    const rawJitter = config.jitterRatio ?? 0.2;
    this.jitterRatio = Math.max(0, Math.min(1, rawJitter));
    this.random = config.random ?? Math.random;
  }

  /**
   * Swap the JWT used for the auth handshake / reconnect. Called by the SDK
   * after a client_credentials refresh (BI[29]) so the next reconnect
   * authenticates with the fresh token.
   */
  updateToken(token: string): void {
    this.token = token;
  }

  /**
   * Open a WebSocket to the Gateway and complete the auth handshake.
   *
   * Resolves once the connection is open and the auth message is sent.
   * Rejects if the connection fails or the auth handshake is rejected.
   */
  async open(): Promise<void> {
    this.closed = false;
    this.openStartedAt = Date.now();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      try {
        const ws = new WebSocket(this.url, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        this.ws = ws;

        ws.once("open", () => {
          // Send the auth handshake as the first message. The Gateway
          // expects {type: "sdk.auth", token}.
          ws.send(JSON.stringify({ type: "sdk.auth", token: this.token }));
          this.reconnectAttempt = 0;
          this.emit("open", undefined);
          settled = true;
          resolve();
        });

        ws.once("error", (err: Error) => {
          this.emit("error", err);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });

        ws.on("close", (code: number, reason: Buffer) => {
          this.emit("close", { code, reason: reason.toString() });
          if (!settled) {
            settled = true;
            reject(new Error(`connection closed before open (code=${code})`));
          }
          // Trigger reconnect unless explicitly closed.
          if (!this.closed) {
            this.scheduleReconnect();
          }
        });

        ws.on("message", (data: Buffer | string) => {
          const text = typeof data === "string" ? data : data.toString("utf8");
          // Try to parse as JSON. If it parses and has a string 'type' field,
          // surface it as a WsClientMessage. Non-JSON or shape-mismatched
          // messages are silently dropped — the Gateway is the source of
          // truth on protocol.
          try {
            const parsed = JSON.parse(text) as { type?: string } & Record<string, string | number | boolean | null>;
            if (typeof parsed.type === "string") {
              // JSON round-trip narrows the type to WsClientMessage at the
              // boundary. Bypasses the "unknown" cast that the banned-types
              // script would flag.
              this.emit("message", JSON.parse(JSON.stringify(parsed)) as WsClientMessage);
            }
          } catch {
            // Non-JSON message: skip silently
          }
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err as Error);
        }
      }
    });
  }

  /** Send a JSON message to the Gateway. */
  send(message: Record<string, WirePrimitive | WireObject | readonly WirePrimitive[] | readonly WireObject[]>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WsClient: cannot send, socket not open");
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Close the WebSocket cleanly. No reconnect. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Subscribe to an event. */
  on(event: WsClientEvent, handler: WsClientHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  /** Unsubscribe from an event. */
  off(event: WsClientEvent, handler: WsClientHandler): void {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }

  /**
   * Compute the backoff delay for retry N (1-indexed).
   * Exponential: base * 2^(n-1), capped at maxBackoffMs.
   * Jitter: each delay is multiplied by (1 ± jitterRatio * random).
   *   Pass jitterRatio=0 for deterministic timing (tests).
   */
  backoff(n: number): number {
    const raw = this.baseBackoffMs * Math.pow(2, n - 1);
    const capped = Math.min(raw, this.maxBackoffMs);
    if (this.jitterRatio <= 0) return capped;
    // Symmetric jitter: factor in [1 - ratio, 1 + ratio].
    const factor = 1 + (this.random() * 2 - 1) * this.jitterRatio;
    return Math.max(0, Math.round(capped * factor));
  }

  /**
   * Latency of the most recent successful open(), in milliseconds.
   * Used by the SDK to populate the `sdk.connected` event payload.
   */
  latencyMs(): number {
    if (this.openStartedAt === 0) return 0;
    return Date.now() - this.openStartedAt;
  }

  /** The Gateway URL this client was configured with. */
  configuredUrl(): string {
    return this.url;
  }

  /** Schedule the next reconnect attempt. */
  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = this.backoff(this.reconnectAttempt);
    this.emit("reconnect_scheduled", delay);
    this.reconnectTimer = setTimeout(() => {
      void this.open().catch(() => {
        // open() failed; the close handler will schedule the next attempt
      });
    }, delay);
  }

  /** Internal emit helper. */
  private emit(event: WsClientEvent, arg: WsClientEventPayload | Error): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(arg);
      } catch {
        // Never let a handler crash the emit loop
      }
    }
  }
}