import type { EventBus } from "@platform/event-bus";
import { EventPublisher } from "./events.js";
import { ResourceTracker } from "./resources.js";
import {
  SessionAlreadyActiveError,
  SessionArchivedError,
  SessionNotActiveError,
  SessionNotFoundError,
  ValidationError,
  type Clock,
  type CreateSessionParams,
  type DestroyReason,
  type SessionManager,
  type SessionManagerConfig,
  type SessionRecord,
  type SessionStatus,
} from "./types.js";

/*
 * Code Map: session-manager lifecycle factory
 * - createSessionManager: composes store, timers, resources, and events
 *
 * CID Index:
 * CID:index-001 -> createSessionManager
 *
 * Quick lookup: rg -n "CID:index-" packages/session-manager/src/index.ts
 */

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_SUSPENDED_TTL_MS = 1_800_000;
const DEFAULT_ARCHIVE_TTL_MS = 604_800_000;

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function createId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// CID:index-001 - createSessionManager
// Purpose: factory — composes a session store, per-session timers, a ResourceTracker, and an EventPublisher
// Uses: EventBus, EventPublisher, ResourceTracker, Clock, SessionManager
// Used by: Gateway (sole caller); test suite
export function createSessionManager(
  eventBus: EventBus,
  config: SessionManagerConfig = {},
): SessionManager {
  const clock = config.clock ?? systemClock;
  const sessions = new Map<string, SessionRecord>();
  const timers = new Map<string, { idle?: number; suspended?: number; archive?: number }>();
  const resources = new ResourceTracker();
  const events = new EventPublisher(eventBus);

  const get = (sessionId: string): SessionRecord => {
    const record = sessions.get(sessionId);
    if (!record) throw new SessionNotFoundError(sessionId);
    return record;
  };

  const save = (record: SessionRecord): SessionRecord => {
    sessions.set(record.id, record);
    return record;
  };

  const cancel = (sessionId: string): void => {
    const handles = timers.get(sessionId);
    if (!handles) return;
    if (handles.idle !== undefined) clock.clearTimeout(handles.idle);
    if (handles.suspended !== undefined) clock.clearTimeout(handles.suspended);
    if (handles.archive !== undefined) clock.clearTimeout(handles.archive);
    timers.delete(sessionId);
  };

  const startIdle = (sessionId: string): void => {
    const record = get(sessionId);
    const handles = timers.get(sessionId) ?? {};
    if (handles.idle !== undefined) clock.clearTimeout(handles.idle);
    handles.idle = clock.setTimeout(() => {
      const current = sessions.get(sessionId);
      if (!current || current.status !== "active") return;
      const suspendedAt = clock.now();
      const suspended = save({ ...current, status: "suspended" });
      events.suspended(suspended, suspendedAt);
      const next = timers.get(sessionId) ?? {};
      next.idle = undefined;
      next.suspended = clock.setTimeout(() => {
        if (sessions.get(sessionId)?.status === "suspended") destroy(sessionId, "expired");
      }, suspended.suspendedTtlMs);
      timers.set(sessionId, next);
    }, record.idleTimeoutMs);
    timers.set(sessionId, handles);
  };

  const create = (params: CreateSessionParams): SessionRecord => {
    if (!params.ownerId.trim()) throw new ValidationError("ownerId is required");
    if (!["mcp", "cli", "rest", "ws"].includes(params.adapterType)) throw new ValidationError("adapterType is invalid");
    const now = clock.now();
    const metadata = params.metadata ? { ...params.metadata } : undefined;
    const idleTimeoutMs = Number(metadata?.idleTimeoutMs ?? config.defaultIdleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    const suspendedTtlMs = Number(metadata?.suspendedTtlMs ?? config.defaultSuspendedTtlMs ?? DEFAULT_SUSPENDED_TTL_MS);
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1) throw new ValidationError("idleTimeoutMs must be positive");
    if (!Number.isFinite(suspendedTtlMs) || suspendedTtlMs < 1) throw new ValidationError("suspendedTtlMs must be positive");
    const record: SessionRecord = {
      id: createId(), status: "active", ownerId: params.ownerId, adapterType: params.adapterType,
      createdAt: now, lastActivityAt: now, idleTimeoutMs, suspendedTtlMs, destroyedAt: null, metadata,
    };
    save(record);
    startIdle(record.id);
    events.created(record);
    return record;
  };

  const resume = (sessionId: string): SessionRecord => {
    const current = get(sessionId);
    if (current.status === "archived") throw new SessionArchivedError(sessionId);
    if (current.status === "active") throw new SessionAlreadyActiveError(sessionId);
    const resumed = save({ ...current, status: "active", lastActivityAt: clock.now() });
    cancel(sessionId);
    startIdle(sessionId);
    events.resumed(resumed, resumed.lastActivityAt);
    return resumed;
  };

  const touch = (sessionId: string): SessionRecord => {
    const current = get(sessionId);
    if (current.status !== "active") throw new SessionNotActiveError(sessionId);
    const touched = save({ ...current, lastActivityAt: clock.now() });
    startIdle(sessionId);
    return touched;
  };

  function destroy(sessionId: string, reason: DestroyReason = "explicit"): SessionRecord {
    const current = get(sessionId);
    if (current.status === "archived") return current;
    cancel(sessionId);
    const destroyed = save({ ...current, status: "archived", destroyedAt: clock.now() });
    events.cleanupResources(sessionId);
    resources.clear(sessionId);
    events.destroyed(destroyed, reason);
    const archive = clock.setTimeout(() => sessions.delete(sessionId), config.archiveTtlMs ?? DEFAULT_ARCHIVE_TTL_MS);
    timers.set(sessionId, { archive });
    return destroyed;
  }

  return {
    create,
    resume,
    touch,
    destroy,
    getStatus: (sessionId): SessionStatus => get(sessionId).status,
    attachResource: (sessionId, resource) => resources.attach(sessionId, resource, sessions.get(sessionId)?.status),
    detachResource: (sessionId, resourceId) => {
      if (!sessions.has(sessionId)) throw new SessionNotFoundError(sessionId);
      resources.detach(sessionId, resourceId);
    },
    listResources: (sessionId) => resources.list(sessionId, sessions.has(sessionId)),
  };
}

export * from "./types.js";
