/*
 * Code Map: WebSocket server lifecycle + auth handshake
 * - createServer: factory that wires ws.Server, ConnectionRegistry, eventBus
 *   into a Server handle with start/stop and address().
 * - handleConnection: per-socket logic — buffer messages, accept on sdk.auth,
 *   close on bad token, publish sdk.connection.{accepted,closed} bus events.
 *
 * Wire protocol (Phase 2 surface):
 *   - First message after open MUST be {type:"sdk.auth", token: string}.
 *   - Any other message before sdk.auth is silently ignored.
 *   - Bad/expired token → socket closed; no accepted event.
 *   - Good token → registered, sdk.connection.accepted emitted.
 *   - SDK closes the socket → sdk.connection.closed {reason:"dropped"}.
 *   - Server replaces an appId's connection → old socket closed (server-initiated).
 *     The old socket's close handler sees the socket is no longer the registered
 *     one (registry was overwritten) and does NOT publish a closed event for it.
 *   - stop() → snapshot+clear the registry, close every socket, publish
 *     sdk.connection.closed {reason:"explicit"} for each appId.
 *
 * CID Index:
 * CID:server-001 -> createServer
 * CID:server-002 -> handleConnection
 * CID:server-003 -> start (server bound + listening)
 * CID:server-004 -> stop (snapshot+close+publish)
 * CID:server-005 -> address (bound host:port)
 */

import { WebSocketServer, type WebSocket as WSWebSocket } from "ws";
import type { CapabilityRecord } from "@platform/capability-registry";
import type { BackendRuntimeConfig, BackendValue, Clock } from "./types.js";
import { ConnectionRegistry } from "./registry.js";
import { InvocationDispatcher } from "./dispatch.js";
import { emitConnectionAccepted, emitConnectionClosed } from "./events.js";
import { verifyToken } from "./verify.js";

export interface ServerHandle {
  start(): Promise<{ readonly port: number; readonly host: string }>;
  stop(): Promise<void>;
  address(): { readonly port: number; readonly host: string } | null;
  connectionCount(): number;
  dispatchInvocation(
    owner: string,
    capabilityName: string,
    input: BackendValue,
    sessionId: string | undefined,
  ): Promise<BackendValue>;
}

/**
 * CID:server-001 - createServer
 * Build a WebSocket server that accepts sdk-node connections, verifies the JWT
 * auth handshake, and publishes sdk.connection.{accepted,closed} bus events.
 *
 * Phase 3 additions:
 * - Per-connection cap accumulator. The SDK sends ONE sdk.capability.register
 *   message per cap (sdk-node/src/index.ts:142-150 — a `for` loop over matched
 *   capabilities). Each call REPLACES the owner's cap set in
 *   capabilityRegistry.register(), so the Backend Runtime accumulates the
 *   per-connection caps and re-registers the full list on every change.
 * - removeByOwner on socket close drops every cap from the disconnected appId.
 *   stop() does the same for every connected appId.
 */
export function createServer(config: BackendRuntimeConfig): ServerHandle {
  const clock: Clock = config.clock ?? defaultClock();
  const registry = new ConnectionRegistry();
  // Per-connection cap accumulator (Phase 3). Keyed by appId so each appId's
  // current cap list can be re-registered atomically. The value is the *current*
  // list for that appId — overwritten on every register, fully cleared on close.
  const capsByAppId = new Map<string, CapabilityRecord[]>();
  // Set of sockets that have been server-initiated-replaced; their close
  // handlers must NOT publish a sdk.connection.closed event (the new owner
  // already won). Keyed by socket identity via a WeakMap so we don't leak.
  const replacedSockets = new WeakSet<object>();
  // Dispatcher is hoisted to the closure scope so dispatchInvocation() (also
  // in the closure) can see it after start() assigns. Initialized in start().
  let dispatcher: InvocationDispatcher | null = null;
  let wss: WebSocketServer | null = null;
  let boundAddress: { port: number; host: string } | null = null;

  /**
   * CID:server-002 - handleConnection
   * Per-socket state machine:
   *   1. open: socket just connected. Buffer messages; expect sdk.auth.
   *   2. accepted: sdk.auth verified. Pass through subsequent messages (Phase 3
   *      handles sdk.capability.register; Phase 4 handles sdk.invoke round-trip).
   *   3. closed: socket closed. If this socket is still the registered one for
   *      its appId, publish sdk.connection.closed {reason:"dropped"}. If a
   *      replacement happened, the registry was already overwritten — no event.
   */
  function handleConnection(socket: WSWebSocket, dispatcher: InvocationDispatcher): void {
    const openedAt = clock.now();
    let authedAppId: string | null = null;

    socket.on("message", (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf-8");
      let parsed: BackendValue;
      try {
        parsed = JSON.parse(text) as BackendValue;
      } catch {
        // Phase 2 closed bad-json sockets; Phase 3 keeps the socket open and
        // drops the frame — the SDK sends well-formed JSON.
        return;
      }
      // All wire messages are objects (record shape). Anything else is dropped.
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      const msg = parsed as { readonly [key: string]: BackendValue };

      // Pre-auth: only sdk.auth is accepted. Everything else is silently ignored.
      if (authedAppId === null) {
        if (!isAuthMessage(msg)) return;
        const result = verifyToken(msg.token, clock, config.tokenSecret);
        if (!result.ok) {
          safeClose(socket, 1000, "auth-failed");
          return;
        }
        const appId = result.claims.sub.callerId;
        const acceptedAt = clock.now();
        const latencyMs = acceptedAt - openedAt;
        const previous = registry.accept(appId, socket, clock);
        authedAppId = appId;
        if (previous) {
          // Mark the previous (about-to-be-closed) socket as replaced so its
          // close handler doesn't publish sdk.connection.closed for the prior
          // registration. The new owner already won; the prior socket's close
          // is server-initiated and emits nothing.
          replacedSockets.add(previous.socket as object);
          // Drop the prior owner's caps and accumulator — the SDK whose
          // connection was just replaced is logically gone from the registry
          // too. Phase 4 dispatch would have already failed for the prior
          // connection anyway.
          capsByAppId.delete(previous.appId);
          void config.capabilityRegistry.removeByOwner(`backend-sdk-${previous.appId}`);
        }
        void emitConnectionAccepted(config.eventBus, {
          appId,
          gatewayUrl: `ws://${boundAddress?.host ?? "127.0.0.1"}:${boundAddress?.port ?? config.port}`,
          latencyMs,
        });
        return;
      }

      // Post-auth: Phase 4 wires sdk.invoke / sdk.invoke.result /
      // sdk.invoke.error to the InvocationDispatcher. Phase 3 handles
      // sdk.capability.register (below).
      if (isInvokeResultMessage(msg)) {
        dispatcher.handleResult(msg.callId, msg.payload);
        return;
      }
      if (isInvokeErrorMessage(msg)) {
        dispatcher.handleError(msg.callId, msg.code, msg.message);
        return;
      }
      if (isCapabilityRegisterMessage(msg)) {
        const owner = `backend-sdk-${authedAppId}`;
        // Business caps (the type SDKs register) MUST have tier=null per BI[7]
        // (capability-registry validateRecord rejects any non-null tier). The
        // SDK may send a non-empty tier string in the wire frame (its handler
        // chose one), but the registry doesn't care about business-cap tiers
        // — they're each a single named action. Force null here so a buggy SDK
        // can't crash the registration path.
        const record: CapabilityRecord = {
          name: msg.name,
          version: msg.version,
          type: "business",
          description: msg.description,
          permissions: splitPermissions(msg.permissions),
          owner,
          tier: null,
        };
        // Append to the per-connection accumulator, then re-register the FULL
        // list atomically. The registry's replace semantics mean each
        // register() call must contain every cap currently held by this appId.
        // Sending just the new cap would wipe the previously-registered ones.
        const current = capsByAppId.get(authedAppId) ?? [];
        const next = [...current.filter((c) => c.name !== record.name), record];
        capsByAppId.set(authedAppId, next);
        void config.capabilityRegistry
          .register(owner, { owner, capabilities: next })
          .catch((err: unknown) => {
            // Validation errors (e.g. invalid name) — close the socket so the
            // SDK knows its registration was rejected. capability.clash errors
            // are also surfaced here.
            safeClose(socket, 1000, "register-failed");
            void err;
          });
        return;
      }
      if (isCapabilityRegisterErrorMessage(msg)) {
        // Gateway-side async rejection of a previously-sent register request.
        // The SDK owns surfacing this on its own bus (sdk.capability.rejected);
        // we log it and move on.
        return;
      }
      // Unknown post-auth message types: drop silently. Phase 4 owns sdk.invoke.
    });

    socket.on("close", () => {
      if (authedAppId === null) return; // never accepted; no event
      if (replacedSockets.has(socket as object)) return; // server-initiated replacement; caller already handled
      const current = registry.get(authedAppId);
      if (!current || current.socket !== socket) return; // registry no longer holds us
      // Reject every in-flight invocation owned by this appId — the connection
      // is gone and the SDK can no longer respond. Phase 4 dispatch path.
      dispatcher.rejectAllPending(authedAppId, "socket closed");
      registry.remove(authedAppId);
      capsByAppId.delete(authedAppId); // also clear the per-connection accumulator
      void config.capabilityRegistry.removeByOwner(`backend-sdk-${authedAppId}`);
      void emitConnectionClosed(config.eventBus, {
        appId: authedAppId,
        reason: "dropped",
      });
    });

    socket.on("error", () => {
      // ws fires 'error' before 'close' on most transport failures. Swallow —
      // the close handler runs and decides whether to publish dropped.
    });
  }

  /**
   * CID:server-003 - start
   * Bind ws.Server on config.port (use 0 for OS-assigned), wait for the
   * 'listening' event, and return the bound address.
   */
  async function start(): Promise<{ readonly port: number; readonly host: string }> {
    if (wss !== null) throw new Error("server already started");
    if (dispatcher !== null) throw new Error("dispatcher already initialized");
    // Construct the dispatcher once; every per-connection handler shares it
    // so that pending invocations are tracked centrally across the server.
    dispatcher = new InvocationDispatcher(registry, config.handlerTimeoutMs ?? 30_000, clock);
    wss = new WebSocketServer({ port: config.port, host: "127.0.0.1" });
    wss.on("connection", (socket) => handleConnection(socket, dispatcher as InvocationDispatcher));
    await new Promise<void>((resolve, reject) => {
      wss!.once("listening", () => resolve());
      wss!.once("error", (err) => reject(err));
    });
    const addr = wss.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("server did not bind to a numeric port");
    }
    boundAddress = { port: addr.port, host: addr.address };
    return boundAddress;
  }

  /**
   * CID:server-004 - stop
   * Snapshot the current connections, clear the registry (so close handlers
   * don't fire sdk.connection.closed for replaced sockets), remove every
   * appId's caps from the capability registry, publish sdk.connection.closed
   * {reason:"explicit"} for each, then close every socket and the ws.Server.
   */
  async function stop(): Promise<void> {
    if (wss === null) return;
    const snapshot = registry.clear();
    for (const conn of snapshot) {
      capsByAppId.delete(conn.appId); // also clear the per-connection accumulator
      await config.capabilityRegistry.removeByOwner(`backend-sdk-${conn.appId}`);
      await emitConnectionClosed(config.eventBus, {
        appId: conn.appId,
        reason: "explicit",
      });
      safeClose(conn.socket as WSWebSocket, 1000, "server-stop");
    }
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve());
    });
    wss = null;
    boundAddress = null;
  }

  /** CID:server-005 - address */
  function address(): { readonly port: number; readonly host: string } | null {
    return boundAddress;
  }

  function connectionCount(): number {
    return registry.count();
  }

  function dispatchInvocation(
    owner: string,
    capabilityName: string,
    input: BackendValue,
    sessionId: string | undefined,
  ): Promise<BackendValue> {
    if (dispatcher === null) throw new Error("dispatcher not initialized; call start() first");
    return dispatcher.dispatchInvocation(owner, capabilityName, input, sessionId);
  }

  return { start, stop, address, connectionCount, dispatchInvocation };
}

function isAuthMessage(value: { readonly [key: string]: BackendValue }): value is { type: "sdk.auth"; token: string } {
  return value["type"] === "sdk.auth" && typeof value["token"] === "string";
}

interface CapabilityRegisterMessage {
  type: "sdk.capability.register";
  name: string;
  description: string;
  version: string;
  permissions: string;       // SDK sends comma-joined; we split on receive
  tier: string;              // "" if unset; one of "read"|"act"|"destructive"|"write" otherwise
  // Index signature makes this assignable from the { [key: string]: BackendValue }
  // shape produced by JSON.parse; without it the type predicate's parameter
  // and its narrowed result don't unify.
  readonly [key: string]: import("./types.js").BackendValue | string;
}

function isCapabilityRegisterMessage(value: { readonly [key: string]: BackendValue }): value is CapabilityRegisterMessage {
  return (
    value["type"] === "sdk.capability.register" &&
    typeof value["name"] === "string" &&
    typeof value["description"] === "string" &&
    typeof value["version"] === "string" &&
    typeof value["permissions"] === "string" &&
    typeof value["tier"] === "string"
  );
}

function isCapabilityRegisterErrorMessage(value: { readonly [key: string]: BackendValue }): value is { type: "sdk.capability.register.error"; name: string; reason: string } {
  return (
    value["type"] === "sdk.capability.register.error" &&
    typeof value["name"] === "string" &&
    typeof value["reason"] === "string"
  );
}

interface InvokeResultMessage {
  type: "sdk.invoke.result";
  callId: string;
  payload: BackendValue;
  // Index signature for compatibility with the { [key: string]: BackendValue }
  // shape produced by JSON.parse; without it the type predicate's parameter
  // and its narrowed result don't unify.
  readonly [key: string]: import("./types.js").BackendValue | BackendValue;
}
function isInvokeResultMessage(value: { readonly [key: string]: BackendValue }): value is InvokeResultMessage {
  // callId: required string. payload: required (any BackendValue, including
  // null). We don't reject null payloads — a handler can legitimately return null.
  return (
    value["type"] === "sdk.invoke.result" &&
    typeof value["callId"] === "string" &&
    "payload" in value
  );
}

interface InvokeErrorMessage {
  type: "sdk.invoke.error";
  callId: string;
  code: string;
  message: string;
  readonly [key: string]: import("./types.js").BackendValue;
}
function isInvokeErrorMessage(value: { readonly [key: string]: BackendValue }): value is InvokeErrorMessage {
  return (
    value["type"] === "sdk.invoke.error" &&
    typeof value["callId"] === "string" &&
    typeof value["code"] === "string" &&
    typeof value["message"] === "string"
  );
}

function splitPermissions(joined: string): string[] {
  // sdk-node/src/index.ts:148 sends permissions as a comma-joined string.
  // Empty string yields empty array. No trimming — sdk-node authors choose the strings.
  if (joined === "") return [];
  return joined.split(",");
}

function safeClose(socket: WSWebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Defensive: ignore double-close.
  }
}

function defaultClock(): Clock {
  // Adapter from Node's setTimeout/clearTimeout to the per-package Clock
  // interface. The interface declares setTimeout's return as number (a handle)
  // — Node's Timeout is object-shaped. Suppress the structural mismatch at
  // this single boundary, mirroring packages/session-manager/src/index.ts.
  return {
    now: () => Date.now(),
    // @ts-expect-error - Node's setTimeout returns Timeout; Clock interface declares number
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
}
