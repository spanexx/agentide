/*
 * Code Map: adapter-websocket public types
 * - DEFAULT_CONFIG: locked defaults (port 7300, 1 MiB × 2, stats 1000ms, pre-auth 30s, heartbeat 30s/10s)
 * - WebSocketAdapterConfig: factory config (host/port/tokenSecret/clock/limits)
 * - ConnectionRecord: per-socket state (state machine, subs, outbound queue, timers)
 * - ClientFrame / ServerFrame: the 16-frame flat JSON envelope (no JSON-RPC)
 * - AUTH_ERROR_CODES: lowercase auth phrases from the locked wire contract
 * - WebSocketAdapter: Adapter-shaped handle with address() + connectionCount()
 *
 * CID Index:
 * CID:types-001 -> DEFAULT_CONFIG
 * CID:types-002 -> WebSocketAdapterConfig
 * CID:types-003 -> ConnectionState
 * CID:types-004 -> QueuedFrame
 * CID:types-005 -> ConnectionRecord
 * CID:types-006 -> ClientFrame (+ AuthFrame/SubscribeFrame/UnsubscribeFrame/InvokeFrame)
 * CID:types-007 -> ServerFrame (12 server frames)
 * CID:types-008 -> AUTH_ERROR_CODES
 * CID:types-009 -> WebSocketAdapter
 *
 * Quick lookup: rg -n "CID:types-" packages/adapter-websocket/src/types.ts
 */

import type { Subscription } from "@spanexx/event-bus";
import type { Adapter, Clock, TokenClaims, YamlValue } from "@spanexx/gateway-core";
import type { WebSocket as WSWebSocket } from "ws";

// CID:types-001 - DEFAULT_CONFIG
// Purpose: single source of truth for every locked default (PRD-TRD §Config;
//   port 7300 confirmed 2026-08-03 — MCP=7100, dashboard=7200). Tests assert
//   these constants so a future edit is a visible decision.
export const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 7300,
  maxBufferedBytes: 1_048_576,
  maxFrameBytes: 1_048_576,
  statsIntervalMs: 1000,
  preAuthTimeoutMs: 30_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
} as const;

// CID:types-002 - WebSocketAdapterConfig
// Purpose: factory config. tokenSecret is REQUIRED — the base64-encoded HS256
//   secret bytes (agentide bootstraps `gateway-secret`); the adapter decodes
//   it and hands the bytes to gateway-core verifyToken.
export interface WebSocketAdapterConfig {
  readonly host?: string;
  readonly port?: number;
  readonly tokenSecret: Uint8Array;
  readonly clock?: Clock;
  readonly maxBufferedBytes?: number;
  readonly maxFrameBytes?: number;
  readonly statsIntervalMs?: number;
  readonly preAuthTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

// CID:types-003 - ConnectionState
// Purpose: per-socket state machine (locked W2): open → pre-auth →
//   authenticated | auth-error-closed. `open` is the instant before the
//   pre-auth timer arms; pre-auth is the waiting-for-auth window.
export type ConnectionState =
  | "open"
  | "pre-auth"
  | "authenticated"
  | "auth-error-closed";

// CID:types-004 - QueuedFrame
// Purpose: outbound frame + its serialized byte size; the byte budget lives
//   on ConnectionRecord.bufferedBytes (backpressure W6 — FIFO drop-oldest).
export interface QueuedFrame {
  readonly frame: ServerFrame;
  readonly bytes: number;
}

// CID:types-005 - ConnectionRecord
// Purpose: everything the adapter knows about one socket. `subs` maps
//   subscribed PATTERN → event-bus unsubscribe handle (fan-out W5: per
//   (connection × pattern) bus.subscribe). Queue/bytes/dropped drive the
//   backpressure budget. Timers: preAuth (30s → 1008), heartbeat ping/pong
//   (30s/10s → 1011), stats (~1s after first drop, one-shot per burst).
export interface ConnectionRecord {
  readonly id: string;
  readonly socket: WSWebSocket;
  readonly origin: string | undefined;
  state: ConnectionState;
  token: string | null;
  claims: TokenClaims | null;
  subs: Map<string, Subscription>;
  queue: QueuedFrame[];
  bufferedBytes: number;
  dropped: number;
  statsTimer: ReturnType<typeof setTimeout> | null;
  preAuthTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  awaitingPong: boolean;
  closeReason: string | null;
}

// CID:types-006 - ClientFrame
// Purpose: the 4 client→server frame types. `subscribe`/`unsubscribe` carry a
//   non-empty topics array (validated + deduped); `invoke` is the universal
//   pull entry (mode defaults to "call", "stream" wraps partials + end).
export type ClientFrame =
  | AuthFrame
  | SubscribeFrame
  | UnsubscribeFrame
  | InvokeFrame;

export interface AuthFrame {
  readonly type: "auth";
  readonly token: string;
}

export interface SubscribeFrame {
  readonly type: "subscribe";
  readonly topics: readonly string[];
}

export interface UnsubscribeFrame {
  readonly type: "unsubscribe";
  readonly topics: readonly string[];
}

export interface InvokeFrame {
  readonly type: "invoke";
  readonly correlationId: string;
  readonly name: string;
  readonly input?: YamlValue;
  readonly sessionId?: string;
  readonly mode?: "call" | "stream";
}

// CID:types-007 - ServerFrame
// Purpose: the 12 server→client frame types. `event` carries the bus
//   PlatformEvent identity (topic/id/publishedAt/payload); `invoke.*` echo
//   correlationId verbatim; `stats` is the recovery signal for drops;
//   `error` is the generic WS-native error frame (WS_* codes).
export type ServerFrame =
  | AuthOkFrame
  | AuthErrorFrame
  | SubscribeOkFrame
  | SubscribeErrorFrame
  | UnsubscribeOkFrame
  | EventFrame
  | InvokeResultFrame
  | InvokeErrorFrame
  | InvokePartialFrame
  | InvokeEndFrame
  | StatsFrame
  | ErrorFrame;

export interface AuthOkFrame {
  readonly type: "auth.ok";
  readonly connectionId: string;
  readonly claims: TokenClaims;
}

export interface AuthErrorFrame {
  readonly type: "auth.error";
  readonly code: string;
  readonly message: string;
}

export interface SubscribeOkFrame {
  readonly type: "subscribe.ok";
  readonly topics: readonly string[];
}

export interface SubscribeErrorFrame {
  readonly type: "subscribe.error";
  readonly code: string;
  readonly message: string;
  readonly topics: readonly string[];
}

export interface UnsubscribeOkFrame {
  readonly type: "unsubscribe.ok";
  readonly topics: readonly string[];
}

export interface EventFrame {
  readonly type: "event";
  readonly topic: string;
  readonly id: string;
  readonly publishedAt: number;
  readonly payload: Readonly<YamlValue>;
}

export interface InvokeResultFrame {
  readonly type: "invoke.result";
  readonly correlationId: string;
  readonly output: YamlValue;
}

export interface InvokeErrorFrame {
  readonly type: "invoke.error";
  readonly correlationId: string;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, YamlValue>>;
}

export interface InvokePartialFrame {
  readonly type: "invoke.partial";
  readonly correlationId: string;
  readonly output: YamlValue;
}

export interface InvokeEndFrame {
  readonly type: "invoke.end";
  readonly correlationId: string;
}

export interface StatsFrame {
  readonly type: "stats";
  readonly dropped: number;
}

export interface ErrorFrame {
  readonly type: "error";
  readonly code: string;
  readonly message: string;
}

// CID:types-008 - AUTH_ERROR_CODES
// Purpose: the five lowercase auth phrases from the locked wire contract
//   (W2). auth.error frames use these verbatim; auth failures close 1008.
export const AUTH_ERROR_CODES = {
  TOKEN_EXPIRED: "token expired",
  TOKEN_INVALID: "token invalid",
  TOKEN_MISSING: "token missing",
  ORIGIN_MISMATCH: "origin mismatch",
  TENANT_SUSPENDED: "tenant suspended",
} as const;

// CID:types-009 - WebSocketAdapter
// Purpose: Adapter-shaped handle (gateway-core Adapter + extras).
//   address() reports the bound host:port (port 0 = OS-assigned);
//   connectionCount() is the live authenticated+socket count.
export interface WebSocketAdapter extends Adapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  address(): { readonly host: string; readonly port: number } | null;
  connectionCount(): number;
}
