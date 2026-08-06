/*
 * Code Map: session-manager public contracts
 * - SessionStatus / DestroyReason: lifecycle state union + destroy reason
 * - SessionRecord: lifecycle metadata retained by manager
 * - ResourceRecord: opaque runtime-owned resource registration
 * - SessionManagerConfig / Clock: factory configuration + injectable time
 * - CreateSessionParams: create() input
 * - Event payloads: lifecycle event contracts (one per event)
 * - SessionManager: public lifecycle and resource API
 * - Error classes: operation failure boundaries
 *
 * CID Index:
 * CID:types-001 -> SessionStatus
 * CID:types-002 -> DestroyReason
 * CID:types-003 -> SessionRecord
 * CID:types-004 -> ResourceRecord
 * CID:types-005 -> SessionManagerConfig
 * CID:types-006 -> Clock
 * CID:types-007 -> CreateSessionParams
 * CID:types-008 -> SessionCreatedPayload
 * CID:types-009 -> SessionSuspendedPayload
 * CID:types-010 -> SessionResumedPayload
 * CID:types-011 -> SessionDestroyedPayload
 * CID:types-012 -> CleanupResourcesPayload
 * CID:types-013 -> SessionManager
 * CID:types-014 -> SessionNotFoundError
 * CID:types-015 -> SessionArchivedError
 * CID:types-016 -> SessionAlreadyActiveError
 * CID:types-017 -> SessionNotActiveError
 * CID:types-018 -> DuplicateResourceError
 * CID:types-019 -> ValidationError
 *
 * Quick lookup: rg -n "CID:types-" packages/session-manager/src/types.ts
 */

import type { EventBus } from "@spanexx/event-bus";

// CID:types-001 - SessionStatus
export type SessionStatus = "active" | "suspended" | "archived";

// CID:types-002 - DestroyReason
export type DestroyReason = "expired" | "explicit";

// CID:types-003 - SessionRecord
// Purpose: lifecycle metadata for one execution context
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

// CID:types-004 - ResourceRecord
// Purpose: opaque registration of a runtime-owned resource against a session
export interface ResourceRecord {
  readonly id: string;
  readonly type: string;
  readonly runtimeId: string;
  readonly attachedAt: number;
}

// CID:types-005 - SessionManagerConfig
// Purpose: optional factory configuration (defaults, archive TTL, injectable clock)
export interface SessionManagerConfig {
  readonly defaultIdleTimeoutMs?: number;
  readonly defaultSuspendedTtlMs?: number;
  readonly archiveTtlMs?: number;
  readonly clock?: Clock;
}

// CID:types-006 - Clock
// Purpose: minimal timer abstraction; default delegates to global setTimeout
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

// CID:types-007 - CreateSessionParams
// Purpose: input for create() — owner, adapter, optional per-session overrides
export interface CreateSessionParams {
  readonly ownerId: string;
  readonly adapterType: "mcp" | "cli" | "rest" | "ws";
  readonly metadata?: Readonly<Record<string, string>>;
}

// CID:types-008 - SessionCreatedPayload
// Purpose: event payload for session.created
export interface SessionCreatedPayload {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly adapterType: string;
  readonly createdAt: number;
}

// CID:types-009 - SessionSuspendedPayload
// Purpose: event payload for session.suspended
export interface SessionSuspendedPayload {
  readonly sessionId: string;
  readonly lastActivityAt: number;
  readonly suspendedAt: number;
}

// CID:types-010 - SessionResumedPayload
// Purpose: event payload for session.resumed
export interface SessionResumedPayload {
  readonly sessionId: string;
  readonly resumedAt: number;
}

// CID:types-011 - SessionDestroyedPayload
// Purpose: event payload for session.destroyed — carries reason + duration
export interface SessionDestroyedPayload {
  readonly sessionId: string;
  readonly reason: DestroyReason;
  readonly destroyedAt: number;
  readonly duration: number;
}

// CID:types-012 - CleanupResourcesPayload
// Purpose: event payload for session.cleanup_resources
export interface CleanupResourcesPayload {
  readonly sessionId: string;
}

// CID:types-013 - SessionManager
// Purpose: public lifecycle + resource API (9 methods; _internalTimerCount is a test/diagnostic helper)
export interface SessionManager {
  create(params: CreateSessionParams): SessionRecord;
  resume(sessionId: string): SessionRecord;
  touch(sessionId: string): SessionRecord;
  destroy(sessionId: string, reason?: DestroyReason): SessionRecord;
  getStatus(sessionId: string): SessionStatus;
  /** Snapshot source for session.list (D-45 closeout): every record in the
   *  store, active and archived, in insertion order. Archived records drop
   *  out after the archive TTL. */
  list(): SessionRecord[];
  attachResource(sessionId: string, resource: ResourceRecord): void;
  detachResource(sessionId: string, resourceId: string): void;
  listResources(sessionId: string): ResourceRecord[];
  _internalTimerCount(): number;
}

// CID:types-014 - SessionNotFoundError
// Purpose: id is not registered with the manager
export class SessionNotFoundError extends Error {}

// CID:types-015 - SessionArchivedError
// Purpose: operation requires a non-archived session
export class SessionArchivedError extends Error {}

// CID:types-016 - SessionAlreadyActiveError
// Purpose: resume() called on an already-active session
export class SessionAlreadyActiveError extends Error {}

// CID:types-017 - SessionNotActiveError
// Purpose: operation requires a session in active or suspended state
export class SessionNotActiveError extends Error {}

// CID:types-018 - DuplicateResourceError
// Purpose: resource id already registered for the session
export class DuplicateResourceError extends Error {}

// CID:types-019 - ValidationError
// Purpose: invalid input at create() time
export class ValidationError extends Error {}

export type SessionEventBus = EventBus;
