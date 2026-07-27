import type { EventBus } from "@platform/event-bus";

/*
 * Code Map: lifecycle event publisher
 * - EventPublisher: maps session state changes to Event Bus payloads
 * CID Index: events-001 EventPublisher
 */
import type {
  CleanupResourcesPayload,
  SessionCreatedPayload,
  SessionDestroyedPayload,
  SessionRecord,
  SessionResumedPayload,
  SessionSuspendedPayload,
} from "./types.js";

export class EventPublisher {
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
