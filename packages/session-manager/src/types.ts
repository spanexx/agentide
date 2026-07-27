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

export interface ResourceRecord {
  readonly id: string;
  readonly type: string;
  readonly runtimeId: string;
  readonly attachedAt: number;
}

export interface SessionManagerConfig {
  readonly defaultIdleTimeoutMs?: number;
  readonly defaultSuspendedTtlMs?: number;
  readonly archiveTtlMs?: number;
  readonly timerResolutionMs?: number;
  readonly clock?: Clock;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface CreateSessionParams {
  readonly ownerId: string;
  readonly adapterType: "mcp" | "cli" | "rest" | "ws";
  readonly metadata?: Readonly<Record<string, string>>;
}

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

export class SessionNotFoundError extends Error {}
export class SessionArchivedError extends Error {}
export class SessionAlreadyActiveError extends Error {}
export class SessionNotActiveError extends Error {}
export class DuplicateResourceError extends Error {}
export class ValidationError extends Error {}

export type SessionEventBus = EventBus;
