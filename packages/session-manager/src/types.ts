/*
 * Code Map: session-manager public contracts
 * - SessionRecord: lifecycle metadata retained by manager
 * - ResourceRecord: opaque runtime-owned resource registration
 * - SessionManager: public lifecycle and resource API
 * - Event payloads: lifecycle event contracts
 * - Error classes: operation failure boundaries
 *
 * CID Index:
 * CID:types-001 -> SessionRecord
 * CID:types-002 -> ResourceRecord
 * CID:types-003 -> SessionManager
 * CID:types-004 -> EventPayloads
 * CID:types-005 -> Error classes
 *
 * Quick lookup: rg -n "CID:types-" packages/session-manager/src/types.ts
 */

import type { EventBus } from "@platform/event-bus";

export type SessionStatus = "active" | "suspended" | "archived";
export type DestroyReason = "expired" | "explicit";

// CID:types-001 - SessionRecord
// Purpose: lifecycle metadata for one execution context. The Session Manager
//   stores these in an in-memory map keyed by `id`. `status` transitions
//   through Active/Suspended/Archived; `lastActivityAt` powers idle suspension;
//   `destroyedAt` is set on archive and later removed by the archive purge.
// Uses: none.
// Used by: createSessionManager (store, timers, event payloads), tests.
export interface SessionRecord {
  readonly id: string;
  readonly status: SessionStatus;
  readonly ownerId: string;
  readonly adapterType: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly idleTimeoutMs: number;
  readonly suspendedTtlMs: number;
  readonly destroyedAt: number | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

// CID:types-002 - ResourceRecord
// Purpose: opaque registration of a runtime-owned resource against a
//   session. Session Manager does not interpret `type` — the runtime that
//   attached the resource owns its cleanup semantics.
// Uses: none.
// Used by: ResourceTracker, attachResource/detachResource/listResources on
//   the public SessionManager API.
export interface ResourceRecord {
  readonly id: string;
  readonly type: string;
  readonly runtimeId: string;
  readonly attachedAt: number;
}

// CID:types-003 - SessionManagerConfig
// Purpose: optional factory configuration. `defaultIdleTimeoutMs` and
//   `defaultSuspendedTtlMs` are fallback values when per-session metadata
//   does not override them. `archiveTtlMs` controls how long archived
//   records linger before purge. `clock` lets tests inject virtual time.
// Uses: Clock (below).
// Used by: createSessionManager factory.
export interface SessionManagerConfig {
  readonly defaultIdleTimeoutMs?: number;
  readonly defaultSuspendedTtlMs?: number;
  readonly archiveTtlMs?: number;
  readonly clock?: Clock;
}

// CID:types-004 - Clock
// Purpose: minimal timer abstraction. The default implementation delegates
//   to global setTimeout/clearTimeout; tests substitute a virtual clock to
//   advance time deterministically without real waits.
// Uses: none.
// Used by: SessionManagerConfig.clock; createSessionManager wires the clock
//   into idle and suspended TTL timers.
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

// CID:types-005 - CreateSessionParams
// Purpose: parameters accepted by SessionManager.create. `metadata` may
//   carry `idleTimeoutMs` and `suspendedTtlMs` overrides that take
//   precedence over the factory defaults for this session only.
// Uses: SessionRecord.
// Used by: SessionManager.create.
export interface CreateSessionParams {
  readonly ownerId: string;
  readonly adapterType: "mcp" | "cli" | "rest" | "ws";
  readonly metadata?: Readonly<Record<string, string>>;
}

// CID:types-006 - Event payloads
// Purpose: payload contracts for the five session.* events. Each payload
//   carries only the fields consumers need and matches TRD §2.2 verbatim.
// Uses: SessionRecord, DestroyReason.
// Used by: EventPublisher (events.ts); subscribers on the Event Bus.
export interface SessionCreatedPayload {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly adapterType: string;
  readonly createdAt: number;
}

export interface SessionSuspendedPayload {
  readonly sessionId: string;
  readonly lastActivityAt: number;
  readonly suspendedAt: number;
}

export interface SessionResumedPayload {
  readonly sessionId: string;
  readonly resumedAt: number;
}

export interface SessionDestroyedPayload {
  readonly sessionId: string;
  readonly reason: DestroyReason;
  readonly destroyedAt: number;
  readonly duration: number;
}

export interface CleanupResourcesPayload {
  readonly sessionId: string;
}

// CID:types-007 - SessionManager
// Purpose: the public lifecycle and resource API exposed by
//   createSessionManager. Synchronous in-process calls; the only async
//   operation is fire-and-forget event publishing on the Event Bus.
// Uses: SessionRecord, ResourceRecord, SessionStatus, DestroyReason.
// Used by: Gateway (sole caller); test suite.
export interface SessionManager {
  create(params: CreateSessionParams): SessionRecord;
  resume(sessionId: string): SessionRecord;
  touch(sessionId: string): SessionRecord;
  destroy(sessionId: string, reason?: DestroyReason): SessionRecord;
  getStatus(sessionId: string): SessionStatus;
  attachResource(sessionId: string, resource: ResourceRecord): void;
  detachResource(sessionId: string, resourceId: string): void;
  listResources(sessionId: string): ResourceRecord[];
}

// CID:types-008 - Error classes
// Purpose: typed failure boundaries the Gateway can switch on.
//   - SessionNotFoundError: id that is not registered with the manager
//   - SessionArchivedError: cannot resume an archived session
//   - SessionAlreadyActiveError: resume on an active session
//   - SessionNotActiveError: attach resource on missing/archived session
//   - DuplicateResourceError: resource id already registered for the session
//   - ValidationError: invalid inputs at create time
// Uses: none.
// Used by: createSessionManager, ResourceTracker; the test suite asserts
//   these classes directly.
export class SessionNotFoundError extends Error {}
export class SessionArchivedError extends Error {}
export class SessionAlreadyActiveError extends Error {}
export class SessionNotActiveError extends Error {}
export class DuplicateResourceError extends Error {}
export class ValidationError extends Error {}

export type SessionEventBus = EventBus;
