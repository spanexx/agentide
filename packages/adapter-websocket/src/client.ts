/*
 * Code Map: adapter-websocket client (Phase 6a — agentide-cli-consumer)
 *
 * createWsClient({url, token}) → {open, invoke, subscribe, onEvent, close, state}
 *   - open(): connect + `{type:"auth", token}` handshake; resolves on auth.ok
 *   - invoke(name, {input?, sessionId?}): correlationId-mapped promise;
 *     resolves invoke.result → output; rejects invoke.error → WsInvokeError
 *     (code/message/details verbatim); error frame / close → rejects pending
 *   - subscribe(topics): resolves on subscribe.ok, rejects on subscribe.error
 *   - onEvent(handler): event-frame listener; returns deregister
 *   - close(): clean close; pending invokes reject with connection-closed
 *   - state: "connecting" | "open" | "closed"
 *
 * Error taxonomy (mirrors exit-codes.ts classification):
 *   - auth handshake failures reject with name "WsAuthError" (→ exit 4)
 *   - TLS/upgrade failures surface as ws 'error' (→ exit 3)
 *   - close 1009/1011, error frames, refused → descriptive messages (→ exit 2)
 *
 * CID Index:
 * CID:client-001 -> createWsClient
 * CID:client-002 -> WsInvokeError
 * CID:client-003 -> WsClientHandle
 *
 * Quick lookup: rg -n "CID:client-" packages/adapter-websocket/src/client.ts
 */

import WebSocket from "ws";
import type { YamlValue } from "@spanexx/gateway-core";
import type { EventFrame } from "./types.js";

export interface WsClientConfig {
  readonly url: string;
  readonly token: string;
  /** Per-invoke timeout in ms (default 30_000). */
  readonly timeoutMs?: number;
  /** Auth handshake timeout in ms (default 3_000). When the WS upgrade
   *  succeeds but no auth.ok arrives within this window, client.open()
   *  rejects with WsDoorMismatchError. The CLI uses this to detect the
   *  case where the operator pointed at the SDK door (port 7350), which
   *  silently ignores the consumer auth frame `{type:"auth"}` and
   *  expects `{type:"sdk.auth"}` instead. */
  readonly authTimeoutMs?: number;
}

// CID:client-002 - WsInvokeError
// Purpose: carries the gateway's invoke.error code/message/details verbatim
//   so the CLI can print `error: <code> — <message>` and exit 1 (no third
//   vocabulary, GRILL Q5). Name is stable for instanceof across copies.
export class WsInvokeError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, YamlValue>>;
  constructor(code: string, message: string, details?: Readonly<Record<string, YamlValue>>) {
    super(message);
    this.name = "WsInvokeError";
    this.code = code;
    this.details = details;
  }
}

// CID:client-004 - WsDoorMismatchError
// Purpose: surfaced when the WS upgrade succeeds but the server doesn't speak
//   the consumer protocol (typical: the SDK door accepted the upgrade but
//   silently ignores the consumer auth frame). The CLI prints the locked
//   wrong-door message and exits 2.
export class WsDoorMismatchError extends Error {
  readonly code = "GATEWAY_DOOR_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "WsDoorMismatchError";
  }
}

// CID:client-003 - WsClientHandle
export interface WsClientHandle {
  readonly state: "connecting" | "open" | "closed";
  open(): Promise<void>;
  invoke(name: string, options?: {
    readonly input?: YamlValue;
    readonly sessionId?: string;
  }): Promise<YamlValue>;
  subscribe(topics: readonly string[]): Promise<void>;
  onEvent(handler: (event: EventFrame) => void): () => void;
  onStats(handler: (dropped: number) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): Promise<void>;
}

interface PendingInvoke {
  resolve: (output: YamlValue) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// CID:client-001 - createWsClient
export function createWsClient(config: WsClientConfig): WsClientHandle {
  let ws: WebSocket | null = null;
  let state: "connecting" | "open" | "closed" = "connecting";
  let correlationCounter = 0;
  const pending = new Map<string, PendingInvoke>();
  const eventHandlers = new Set<(event: EventFrame) => void>();
  const statsHandlers = new Set<(dropped: number) => void>();
  const closeHandlers = new Set<() => void>();
  const timeoutMs = config.timeoutMs ?? 30_000;
  const authTimeoutMs = config.authTimeoutMs ?? 3_000;
  let openResolve: (() => void) | null = null;
  let openReject: ((err: Error) => void) | null = null;
  let closeResolve: (() => void) | null = null;
  // CID:client-005 - auth handshake timer. Lives at module-scope of
  //   createWsClient so `handleFrame` can clear it on auth.ok/auth.error.
  //   (Defining it inside `open()` would put it out of scope of the
  //   frame handler — ReferenceError on every happy-path open.)
  let authTimer: ReturnType<typeof setTimeout> | null = null;
  const clearAuthTimer = (): void => {
    if (authTimer !== null) {
      clearTimeout(authTimer);
      authTimer = null;
    }
  };

  const failPending = (message: string): void => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pending.clear();
  };

  const handleFrame = (frame: Record<string, YamlValue>): void => {
    const type = frame.type;
    if (type === "auth.ok") {
      clearAuthTimer();
      state = "open";
      openResolve?.();
      openResolve = null;
      openReject = null;
      return;
    }
    if (type === "auth.error") {
      clearAuthTimer();
      const message = String(frame.message ?? "auth rejected");
      const err = new Error(`auth.error: ${message}`);
      err.name = "WsAuthError";
      openReject?.(err);
      openReject = null;
      openResolve = null;
      return;
    }
    if (type === "invoke.result") {
      const p = pending.get(String(frame.correlationId));
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(String(frame.correlationId));
      p.resolve(frame.output as YamlValue);
      return;
    }
    if (type === "invoke.error") {
      const id = String(frame.correlationId);
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new WsInvokeError(
        String(frame.code),
        String(frame.message),
        frame.details as Readonly<Record<string, YamlValue>> | undefined,
      ));
      return;
    }
    if (type === "subscribe.ok") {
      pendingSubscribe.resolve?.();
      pendingSubscribe = { resolve: null, reject: null };
      return;
    }
    if (type === "subscribe.error") {
      const err = new Error(`subscribe.error: ${String(frame.code)} ${String(frame.message)}`);
      pendingSubscribe.reject?.(err);
      pendingSubscribe = { resolve: null, reject: null };
      return;
    }
    if (type === "event") {
      // Build the documented shape field-by-field (no cast needed — the
      // adapter only serializes these five keys).
      const event: EventFrame = {
        type: "event",
        topic: String(frame.topic),
        id: String(frame.id),
        publishedAt: typeof frame.publishedAt === "number" ? frame.publishedAt : 0,
        payload: frame.payload as Readonly<YamlValue>,
      };
      for (const handler of eventHandlers) handler(event);
      return;
    }
    if (type === "stats") {
      const dropped = typeof frame.dropped === "number" ? frame.dropped : 0;
      for (const handler of statsHandlers) handler(dropped);
      return;
    }
    if (type === "error") {
      const message = `error frame: ${String(frame.code)} ${String(frame.message)}`;
      openReject?.(new Error(message));
      openReject = null;
      openResolve = null;
      failPending(message);
      return;
    }
  };

  let pendingSubscribe: { resolve: (() => void) | null; reject: ((err: Error) => void) | null } =
    { resolve: null, reject: null };

  return {
    get state(): "connecting" | "open" | "closed" { return state; },

    open(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (state === "open") { resolve(); return; }
        if (state === "closed") { reject(new Error("connection closed")); return; }
        openResolve = resolve;
        openReject = reject;
        let wsError: Error | null = null;
        const socket = new WebSocket(config.url);
        ws = socket;
        socket.on("open", () => {
          socket.send(JSON.stringify({ type: "auth", token: config.token }));
          // CID:client-005 - auth handshake timeout. If the server didn't
          // send auth.ok (or auth.error) within authTimeoutMs, we
          // surfaced a connection to a door that doesn't speak the
          // consumer protocol (e.g. the SDK door). Reject with a
          // typed error so the CLI can render the wrong-door message.
          authTimer = setTimeout(() => {
            authTimer = null;
            const err = new WsDoorMismatchError(
              "no auth.ok within authTimeoutMs (likely the SDK door; expected consumer protocol)",
            );
            openReject?.(err);
            openReject = null;
            openResolve = null;
            try { socket.close(); } catch { /* already closed */ }
          }, authTimeoutMs);
        });
        socket.on("message", (raw) => {
          let value: Record<string, YamlValue>;
          try {
            value = JSON.parse(raw.toString()) as Record<string, YamlValue>;
          } catch {
            failPending("invalid json from gateway");
            return;
          }
          handleFrame(value);
        });
        socket.on("error", (err: Error) => {
          wsError = err;
          clearAuthTimer();
          const message = err.message || "websocket error";
          openReject?.(new Error(message));
          openReject = null;
          openResolve = null;
          failPending(message);
        });
        socket.on("close", (code: number, reason: Buffer) => {
          clearAuthTimer();
          const reasonText = reason.toString();
          const message = code === 1008
            ? `closed with 1008 (auth rejected${reasonText ? `: ${reasonText}` : ""})`
            : code === 1009
              ? "closed with 1009 (frame too large)"
              : code === 1011
                ? "closed with 1011 (heartbeat timeout)"
                : code === 1000
                  ? "connection closed"
                  : `closed with ${code}${reasonText ? ` (${reasonText})` : ""}`;
          if (state === "connecting" && openReject) {
            openReject?.(new Error(message));
            openReject = null;
            openResolve = null;
          }
          failPending(message);
          state = "closed";
          ws = null;
          closeResolve?.();
          closeResolve = null;
          for (const handler of closeHandlers) handler();
          void wsError; // 'error' already rejected; keep reference for clarity
        });
      });
    },

    invoke(name: string, options?: { readonly input?: YamlValue; readonly sessionId?: string }): Promise<YamlValue> {
      if (state !== "open" || ws === null) {
        return Promise.reject(new Error("not connected"));
      }
      const correlationId = `cli-${++correlationCounter}`;
      return new Promise<YamlValue>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(correlationId);
          reject(new Error(`invoke timeout (${name})`));
        }, timeoutMs);
        pending.set(correlationId, { resolve, reject, timer });
        ws!.send(JSON.stringify({
          type: "invoke",
          correlationId,
          name,
          mode: "call",
          ...(options?.input === undefined ? {} : { input: options.input }),
          ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        }));
      });
    },

    subscribe(topics: readonly string[]): Promise<void> {
      if (state !== "open" || ws === null) {
        return Promise.reject(new Error("not connected"));
      }
      return new Promise<void>((resolve, reject) => {
        pendingSubscribe = { resolve, reject };
        ws!.send(JSON.stringify({ type: "subscribe", topics }));
      });
    },

    onEvent(handler: (event: EventFrame) => void): () => void {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },

    onStats(handler: (dropped: number) => void): () => void {
      statsHandlers.add(handler);
      return () => statsHandlers.delete(handler);
    },

    onClose(handler: () => void): () => void {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },

    close(): Promise<void> {
      failPending("connection closed");
      clearAuthTimer();
      if (ws !== null) {
        // Use terminate() rather than close() to avoid hanging on a peer
        // that doesn't respond to the close handshake (e.g. an inert
        // server, the SDK door, or a gateway that's mid-restart). The
        // WS RFC requires a graceful close handshake, but for a CLI
        // that exits after one round-trip, hang-free cleanup matters more.
        try { ws.terminate(); } catch { /* already closed */ }
      } else if (state !== "closed") {
        // never opened (or failed to open): nothing to wait for
        state = "closed";
        return Promise.resolve();
      }
      if (state === "closed") return Promise.resolve();
      return new Promise<void>((resolve) => {
        closeResolve = resolve;
      });
    },
  };
}
