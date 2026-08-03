/*
 * Code Map: adapter-websocket server lifecycle
 * - createWebSocketAdapter: factory returning the Adapter handle (start / stop / address / connectionCount)
 * - handleConnection: per-socket pre-auth timer + message routing + heartbeat
 * - processAuth: token verify → claims swap; on refresh publishes event.connection.rotated
 * - armHeartbeat / handlePong: protocol-level ping/pong (no app-level pong frame)
 * - queueOptions / sendOversized: outbound byte budget + 1009 close on oversized
 * - cleanupRecord: timer cleanup + bus unsubscribe + queue reset on socket close
 *
 * CID Index:
 * CID:server-001 -> createWebSocketAdapter
 * CID:server-002 -> handleConnection
 * CID:server-003 -> handleMessage
 * CID:server-004 -> processAuth
 * CID:server-005 -> sendAuthFailure
 * CID:server-006 -> sendOversized
 * CID:server-007 -> queueOptions
 * CID:server-008 -> armHeartbeat
 * CID:server-009 -> handlePong
 * CID:server-010 -> closeRecord
 * CID:server-011 -> cleanupRecord
 *
 * Quick lookup: rg -n "CID:server-" packages/adapter-websocket/src/server.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { publishInternalEvent, type EventBus } from "@platform/event-bus";
import type { Clock, Gateway, YamlValue } from "@platform/gateway-core";
import { authenticateToken } from "./auth.js";
import { subscribeTopics, unsubscribeTopics } from "./fanout.js";
import { invokeFrame } from "./invoke.js";
import { parseClientFrame, type AuthCandidate } from "./protocol.js";
import { clearQueue, enqueueFrame, type QueueOptions } from "./queue.js";
import { ConnectionRegistry } from "./registry.js";
import type { ConnectionRecord, ServerFrame, WebSocketAdapter, WebSocketAdapterConfig } from "./types.js";

const CLOSE_AUTH = 1008;
const CLOSE_TOO_LARGE = 1009;
const CLOSE_HEARTBEAT = 1011;

export function createWebSocketAdapter(
  gateway: Gateway,
  eventBus: EventBus,
  config: WebSocketAdapterConfig,
): WebSocketAdapter {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 7300;
  const clock = config.clock ?? systemClock();
  const maxBufferedBytes = config.maxBufferedBytes ?? 1_048_576;
  const maxFrameBytes = config.maxFrameBytes ?? 1_048_576;
  const statsIntervalMs = config.statsIntervalMs ?? 1000;
  const preAuthTimeoutMs = config.preAuthTimeoutMs ?? 30_000;
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 30_000;
  const heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 10_000;
  const registry = new ConnectionRegistry();
  let server: WebSocketServer | null = null;
  let boundPort: number | null = null;

  async function start(): Promise<void> {
    if (server !== null) return;
    const next = new WebSocketServer({ host, port, path: "/ws", maxPayload: maxFrameBytes });
    next.on("connection", (socket, request) => handleConnection(socket, request));
    await new Promise<void>((resolve, reject) => {
      next.once("listening", resolve);
      next.once("error", reject);
    });
    const address = next.address();
    if (address === null || typeof address === "string") {
      next.close();
      throw new Error("WebSocket adapter did not bind a numeric port");
    }
    server = next;
    boundPort = address.port;
  }

  async function stop(): Promise<void> {
    const current = server;
    if (current === null) return;
    server = null;
    boundPort = null;
    for (const record of registry.clear()) {
      cleanupRecord(record);
      safeClose(record.socket, 1000, "server stop");
    }
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }

  function address(): { readonly host: string; readonly port: number } | null {
    return boundPort === null ? null : { host, port: boundPort };
  }

  function connectionCount(): number {
    return registry.count();
  }

  function handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const origin = normalizeOrigin(request.headers.origin);
    const record = registry.add(socket, origin);
    record.state = "pre-auth";
    record.preAuthTimer = setTimeout(() => {
      if (record.state === "pre-auth") closeRecord(record, CLOSE_AUTH, "auth timeout");
    }, preAuthTimeoutMs);
    socket.on("message", (raw) => handleMessage(record, raw.toString("utf8")));
    socket.on("pong", () => handlePong(record));
    socket.on("close", () => cleanupRecord(record));
    socket.on("error", () => {});
  }

  function handleMessage(record: ConnectionRecord, text: string): void {
    let value: YamlValue;
    try {
      value = JSON.parse(text) as YamlValue;
    } catch {
      if (record.state === "authenticated") sendError(record, "invalid JSON");
      return;
    }
    const frame = parseClientFrame(value);
    if (record.state !== "authenticated") {
      if (frame.type === "auth") processAuth(record, frame);
      return;
    }
    if (frame.type === "auth") {
      processAuth(record, frame);
      return;
    }
    if (frame.type === "invalid") {
      sendError(record, frame.message);
      return;
    }
    if (frame.type === "subscribe") {
      const result = subscribeTopics(record, frame.topics, eventBus, record.claims!, queueOptions(record));
      if (result.ok) enqueueFrame(record, { type: "subscribe.ok", topics: result.topics }, queueOptions(record));
      else enqueueFrame(record, { type: "subscribe.error", code: result.code, message: result.message, topics: result.topics }, queueOptions(record));
      return;
    }
    if (frame.type === "unsubscribe") {
      const topics = unsubscribeTopics(record, frame.topics);
      enqueueFrame(record, { type: "unsubscribe.ok", topics }, queueOptions(record));
      return;
    }
    void invokeFrame(record, frame, gateway, queueOptions(record));
  }

  function processAuth(record: ConnectionRecord, frame: AuthCandidate): void {
    const refreshing = record.state === "authenticated";
    const result = authenticateToken(frame.token, {
      clock,
      tokenSecret: config.tokenSecret,
      origin: record.origin,
      listTenants: gateway.listTenants,
    });
    if (!result.ok) {
      sendAuthFailure(record, result.code);
      return;
    }
    if (record.preAuthTimer !== null) {
      clearTimeout(record.preAuthTimer);
      record.preAuthTimer = null;
    }
    record.token = frame.token ?? null;
    record.claims = result.claims;
    record.state = "authenticated";
    if (!refreshing) armHeartbeat(record);
    enqueueFrame(record, {
      type: "auth.ok",
      connectionId: record.id,
      claims: result.claims,
    }, queueOptions(record));
    if (refreshing) {
      void publishInternalEvent(eventBus, "event.connection.rotated", {
        connectionId: record.id,
        tenantId: result.claims.sub.tenantId,
        callerId: result.claims.sub.callerId,
        rotatedAt: clock.now(),
      });
    }
  }

  function sendAuthFailure(record: ConnectionRecord, code: string): void {
    const frame: ServerFrame = { type: "auth.error", code, message: code };
    record.state = "auth-error-closed";
    try {
      record.socket.send(JSON.stringify(frame), () => closeRecord(record, CLOSE_AUTH, code));
    } catch {
      closeRecord(record, CLOSE_AUTH, code);
    }
  }

  function sendError(record: ConnectionRecord, message: string): void {
    enqueueFrame(record, { type: "error", code: "WS_INVALID_FRAME", message }, queueOptions(record));
  }

  function sendOversized(record: ConnectionRecord): void {
    const frame: ServerFrame = { type: "error", code: "WS_FRAME_TOO_LARGE", message: "outbound frame too large" };
    try {
      record.socket.send(JSON.stringify(frame), () => closeRecord(record, CLOSE_TOO_LARGE, "frame too large"));
    } catch {
      closeRecord(record, CLOSE_TOO_LARGE, "frame too large");
    }
  }

  function queueOptions(record: ConnectionRecord): QueueOptions {
    return {
      maxBufferedBytes,
      maxFrameBytes,
      statsIntervalMs,
      onFrameTooLarge: () => sendOversized(record),
    };
  }

  function armHeartbeat(record: ConnectionRecord): void {
    const tick = (): void => {
      if (record.state !== "authenticated") return;
      if (record.awaitingPong) {
        closeRecord(record, CLOSE_HEARTBEAT, "heartbeat timeout");
        return;
      }
      record.awaitingPong = true;
      try {
        record.socket.ping();
      } catch {
        closeRecord(record, CLOSE_HEARTBEAT, "heartbeat failed");
        return;
      }
      record.pongTimer = setTimeout(() => {
        if (record.awaitingPong) closeRecord(record, CLOSE_HEARTBEAT, "heartbeat timeout");
      }, heartbeatTimeoutMs);
      record.heartbeatTimer = setTimeout(tick, heartbeatIntervalMs);
    };
    record.heartbeatTimer = setTimeout(tick, heartbeatIntervalMs);
  }

  function handlePong(record: ConnectionRecord): void {
    record.awaitingPong = false;
    if (record.pongTimer !== null) {
      clearTimeout(record.pongTimer);
      record.pongTimer = null;
    }
  }

  function closeRecord(record: ConnectionRecord, code: number, reason: string): void {
    record.closeReason = reason;
    cleanupRecord(record);
    safeClose(record.socket, code, reason);
  }

  function cleanupRecord(record: ConnectionRecord): void {
    if (record.preAuthTimer !== null) {
      clearTimeout(record.preAuthTimer);
      record.preAuthTimer = null;
    }
    if (record.heartbeatTimer !== null) {
      clearTimeout(record.heartbeatTimer);
      record.heartbeatTimer = null;
    }
    if (record.pongTimer !== null) {
      clearTimeout(record.pongTimer);
      record.pongTimer = null;
    }
    for (const subscription of record.subs.values()) subscription.unsubscribe();
    record.subs.clear();
    clearQueue(record);
    registry.remove(record.id);
    if (record.state !== "auth-error-closed") record.state = "auth-error-closed";
  }

  return {
    name: "adapter-websocket",
    start,
    stop,
    address,
    connectionCount,
  };
}

function normalizeOrigin(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) socket.close(code, reason);
  } catch {}
}

function systemClock(): Clock {
  return {
    now: () => Date.now(),
    // @ts-expect-error - Node setTimeout returns Timeout; Clock interface declares number.
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  };
}
