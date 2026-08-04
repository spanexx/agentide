/*
 * Code Map: Backend Runtime public types
 * - Clock: minimal timer abstraction (matches per-package pattern in this codebase)
 * - BackendRuntimeConfig: factory configuration
 * - BackendRuntime: public API with start/stop/dispatchInvocation/connectionCount
 * - BackendConnection: in-memory state for one connected SDK app
 * - RegisteredCapability: one capability registered by a connected SDK
 * - Connection{Accepted,Closed}Payload: event bus payloads
 * - BackendValue: recursive value type (avoids `any`/`unknown`)
 *
 * CID Index:
 * CID:clock-001 -> Clock
 * CID:types-001 -> BackendRuntimeConfig
 * CID:types-002 -> BackendRuntime
 * CID:types-003 -> BackendConnection
 * CID:types-004 -> RegisteredCapability
 * CID:types-005 -> ConnectionAcceptedPayload
 * CID:types-006 -> ConnectionClosedPayload
 * CID:types-007 -> BackendValue
 *
 * Quick lookup: rg -n "CID:types-\|CID:clock-" packages/backend-runtime/src/types.ts
 */

import type { EventBus } from "@spanexx/event-bus";
import type { CapabilityRecord, CapabilityRegistry, CapabilityTier } from "@spanexx/capability-registry";

export type { CapabilityRecord };

// CID:clock-001 - Clock
// Purpose: minimal timer abstraction (matches the per-package Clock pattern
//   used by @platform/gateway-core, @platform/session-manager, @platform/plugin-manager).
//   Default delegates to global setTimeout/Date.now. Tests inject a fake clock.
// Used by: BackendRuntimeConfig (latencyMs, handler timeouts)
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

// CID:types-001 - BackendRuntimeConfig
// Purpose: factory config — port, token secret (same HS256 as gateway),
//   event bus, capability registry, optional timeout override, optional clock
// Used by: createBackendRuntime (index.ts)
export interface BackendRuntimeConfig {
  readonly port: number;
  readonly tokenSecret: Uint8Array;
  readonly eventBus: EventBus;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly handlerTimeoutMs?: number;
  readonly clock?: Clock;
}

// CID:types-002 - BackendRuntime
// Purpose: public API — start/stop the WebSocket server, dispatch an
//   invocation to a connected SDK, query connection count, and read the
//   bound address (useful when port 0 is used and the OS assigns a port)
// Used by: gateway-core dispatch (Phase 5), agentide composition (Phase 6), tests
export interface BackendRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatchInvocation(
    owner: string,
    capability: CapabilityRecord,
    input: BackendValue,
    sessionId: string | undefined,
  ): Promise<BackendValue>;
  connectionCount(): number;
  address(): { readonly port: number; readonly host: string } | null;
}

// CID:types-003 - BackendConnection
// Purpose: in-memory state for one connected SDK app (one per appId:tabId
//   connection key — drift D-43)
// Used by: registry.ts (Phase 2)
//   Note: `socket` is the ws.WebSocket. We type it via the structural minimum
//   the registry needs (close method) instead of importing ws.WebSocket and
//   hard-coupling backend-runtime to the third-party transport.
export interface BackendConnection {
  readonly appId: string;
  /** Page-instance id from the auth frame; null for non-browser SDKs (sdk-node). */
  readonly tabId: string | null;
  readonly connectedAt: number;
  readonly capabilities: RegisteredCapability[];
  socket: WebSocketLike;
}

// CID:socket-001 - WebSocketLike
// Purpose: structural minimum of ws.WebSocket the Backend Runtime uses.
//   Lets types.ts avoid importing ws (and leaking the transport into the
//   public type surface). server.ts casts real ws.WebSocket instances into
//   this structural type at the assignment boundary.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
}

// CID:types-004 - RegisteredCapability
// Purpose: one capability registered by a connected SDK app. Mirrors
//   CapabilityRecord fields the Backend Runtime needs to register with
//   the Capability Registry (type: "business" literal is required by the
//   registry's validateRecord).
// Used by: BackendConnection, registry.ts (Phase 3)
export interface RegisteredCapability {
  readonly name: string;
  readonly version: string;
  readonly type: "business";
  readonly description: string;
  readonly permissions: readonly string[];
  readonly tier: CapabilityTier | null;
}

// CID:types-005 - ConnectionAcceptedPayload
// Purpose: event payload for sdk.connection.accepted
// Used by: events.ts (Phase 2)
export interface ConnectionAcceptedPayload {
  readonly appId: string;
  /** Set when the SDK sent a tabId in the auth frame (drift D-43). */
  readonly tabId: string | null;
  readonly gatewayUrl: string;
  readonly latencyMs: number;
}

// CID:types-006 - ConnectionClosedPayload
// Purpose: event payload for sdk.connection.closed
// Used by: events.ts (Phase 2)
export interface ConnectionClosedPayload {
  readonly appId: string;
  /** Set when the SDK sent a tabId in the auth frame (drift D-43). */
  readonly tabId: string | null;
  readonly reason: "explicit" | "dropped";
}

// CID:types-007 - BackendValue
// Purpose: recursive value type covering all shapes passed over the
//   SDK wire protocol — replaces `any`/`unknown` to satisfy the
//   project's banned-types check (scripts/check-banned-types.sh)
// Used by: BackendRuntime.dispatchInvocation, WireInvoke payload
export type BackendValue =
  | string
  | number
  | boolean
  | null
  | readonly BackendValue[]
  | { readonly [key: string]: BackendValue };
