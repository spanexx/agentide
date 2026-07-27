/*
 * Code Map: lifecycle event publisher
 * - EventPublisher: maps session state changes to Event Bus payloads
 *
 * CID Index:
 * CID:events-001 -> EventPublisher
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

export class EventPublisher {
  // CID:events-001 - EventPublisher
  // Purpose: maps SessionRecord state changes to Event Bus payloads. Each
  //   method is fire-and-forget (publish returns a Promise that the caller
  //   discards) so state transitions never block on slow subscribers.
  // discovery/issues: All payloads are plain objects so the Event Bus
  //   shallow-freezes them on publish (event-bus v2).
  // Uses: EventBus, payload interfaces from types.ts.
  // Used by: createSessionManager (state transition call sites).
  constructor(private readonly eventBus: EventBus) {}

  created(record: SessionRecord): void {
    void this.eventBus.publish<SessionCreatedPayload>("session.created", {
      sessionId: record.id,
      ownerId: record.ownerId,
      adapterType: record.adapterType,
      createdAt: record.createdAt,
    });
  }

  suspended(record: SessionRecord, suspendedAt: number): void {
    void this.eventBus.publish<SessionSuspendedPayload>("session.suspended", {
      sessionId: record.id,
      lastActivityAt: record.lastActivityAt,
      suspendedAt,
    });
  }

  resumed(record: SessionRecord, resumedAt: number): void {
    void this.eventBus.publish<SessionResumedPayload>("session.resumed", {
      sessionId: record.id,
      resumedAt,
    });
  }

  cleanupResources(sessionId: string): void {
    void this.eventBus.publish<CleanupResourcesPayload>("session.cleanup_resources", { sessionId });
  }

  destroyed(record: SessionRecord, reason: SessionDestroyedPayload["reason"]): void {
    void this.eventBus.publish<SessionDestroyedPayload>("session.destroyed", {
      sessionId: record.id,
      reason,
      destroyedAt: record.destroyedAt ?? record.createdAt,
      duration: (record.destroyedAt ?? record.createdAt) - record.createdAt,
    });
  }
}
