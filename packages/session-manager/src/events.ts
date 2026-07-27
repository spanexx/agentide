/*
 * Code Map: lifecycle event publisher
 * - EventPublisher: maps session state changes to Event Bus payloads
 *   - created:        session.created
 *   - suspended:      session.suspended
 *   - resumed:        session.resumed
 *   - cleanupResources: session.cleanup_resources
 *   - destroyed:      session.destroyed
 *
 * CID Index:
 * CID:events-001 -> EventPublisher
 * CID:events-002 -> EventPublisher.created
 * CID:events-003 -> EventPublisher.suspended
 * CID:events-004 -> EventPublisher.resumed
 * CID:events-005 -> EventPublisher.cleanupResources
 * CID:events-006 -> EventPublisher.destroyed
 *
 * Quick lookup: rg -n "CID:events-" packages/session-manager/src/events.ts
 */

import type { EventBus } from "@platform/event-bus";
import type {
  CleanupResourcesPayload,
  SessionCreatedPayload,
  SessionDestroyedPayload,
  SessionRecord,
  SessionResumedPayload,
  SessionSuspendedPayload,
} from "./types.js";

// CID:events-001 - EventPublisher
// Purpose: maps session state changes to Event Bus payloads (fire-and-forget)
// Uses: EventBus, payload interfaces from types.ts
// Used by: createSessionManager (state transition call sites)
export class EventPublisher {
  constructor(private readonly eventBus: EventBus) {}

  // CID:events-002 - created
  created(record: SessionRecord): void {
    void this.eventBus.publish<SessionCreatedPayload>("session.created", {
      sessionId: record.id,
      ownerId: record.ownerId,
      adapterType: record.adapterType,
      createdAt: record.createdAt,
    });
  }

  // CID:events-003 - suspended
  suspended(record: SessionRecord, suspendedAt: number): void {
    void this.eventBus.publish<SessionSuspendedPayload>("session.suspended", {
      sessionId: record.id,
      lastActivityAt: record.lastActivityAt,
      suspendedAt,
    });
  }

  // CID:events-004 - resumed
  resumed(record: SessionRecord, resumedAt: number): void {
    void this.eventBus.publish<SessionResumedPayload>("session.resumed", {
      sessionId: record.id,
      resumedAt,
    });
  }

  // CID:events-005 - cleanupResources
  cleanupResources(sessionId: string): void {
    void this.eventBus.publish<CleanupResourcesPayload>("session.cleanup_resources", { sessionId });
  }

  // CID:events-006 - destroyed
  destroyed(record: SessionRecord, reason: SessionDestroyedPayload["reason"]): void {
    void this.eventBus.publish<SessionDestroyedPayload>("session.destroyed", {
      sessionId: record.id,
      reason,
      destroyedAt: record.destroyedAt ?? record.createdAt,
      duration: (record.destroyedAt ?? record.createdAt) - record.createdAt,
    });
  }
}
