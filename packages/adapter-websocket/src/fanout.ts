/*
 * Code Map: adapter-websocket subscription fan-out over the Event Bus
 * - subscribeTopics: validate grammar + per-pattern authz, then bus.subscribe per topic
 * - unsubscribeTopics: idempotent unsubscribe of a topic list
 * - pruneSubscriptions: drop every subscription (called on socket close)
 *
 * CID Index:
 * CID:fanout-001 -> derivePermission
 * CID:fanout-002 -> subscribeTopics
 * CID:fanout-003 -> unsubscribeTopics
 * CID:fanout-004 -> pruneSubscriptions
 *
 * Quick lookup: rg -n "CID:fanout-" packages/adapter-websocket/src/fanout.ts
 */

import {
  RESERVED_INTERNAL_PREFIX,
  validatePattern,
  type EventBus,
  type PlatformEvent,
  type Subscription,
} from "@spanexx/event-bus";
import { checkAuthz, type TokenClaims, type YamlValue } from "@spanexx/gateway-core";
import type { ConnectionRecord, EventFrame } from "./types.js";
import { enqueueFrame, type QueueOptions } from "./queue.js";

export type SubscriptionOptions = QueueOptions;

export type SubscriptionResult =
  | { readonly ok: true; readonly topics: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly topics: readonly string[] };

// CID:fanout-001 - derivePermission
// Purpose: derive the per-pattern authz permission from the topic. W3 sub-Q 3
//   locks `*` (bare) → `platform.*.read` and `<first>.…` → `platform.<first>.read`.
//   Uniform rule = no mapping table; new event namespaces work without changes.
export function derivePermission(pattern: string): string {
  const first = pattern === "*" ? "*" : pattern.split(".")[0];
  return `platform.${first}.read`;
}

// CID:fanout-002 - subscribeTopics
// Purpose: validate every topic (grammar + non-reserved + authz) before touching
//   the bus. All-or-nothing: a single bad pattern returns WS_INVALID_TOPIC /
//   WS_FORBIDDEN without subscribing anything. The relay handler enqueues the
//   event frame and returns immediately — never awaits socket.send (bus dispatch
//   uses Promise.allSettled, a slow socket must not back-pressure the bus).
export function subscribeTopics(
  record: ConnectionRecord,
  topics: readonly string[],
  eventBus: EventBus,
  claims: TokenClaims,
  options: SubscriptionOptions,
): SubscriptionResult {
  if (topics.length === 0) {
    return { ok: false, code: "WS_INVALID_FRAME", message: "topics must be non-empty", topics };
  }
  const unique = [...new Set(topics)];
  for (const topic of unique) {
    try {
      validatePattern(topic);
    } catch {
      return { ok: false, code: "WS_INVALID_TOPIC", message: "invalid topic pattern", topics };
    }
    if (topic.startsWith(RESERVED_INTERNAL_PREFIX)) {
      return { ok: false, code: "WS_INVALID_TOPIC", message: "reserved topic", topics };
    }
    if (!checkAuthz(claims.scope, [derivePermission(topic)])) {
      return { ok: false, code: "WS_FORBIDDEN", message: "subscription forbidden", topics };
    }
  }
  const created: Array<[string, Subscription]> = [];
  try {
    for (const topic of unique) {
      if (record.subs.has(topic)) continue;
      const subscription = eventBus.subscribe<Record<string, YamlValue>>(
        topic,
        (event: PlatformEvent<Record<string, YamlValue>>) => {
          if (event.name.startsWith(RESERVED_INTERNAL_PREFIX)) return;
          const frame: EventFrame = {
            type: "event",
            topic: event.name,
            id: event.id,
            publishedAt: event.publishedAt,
            payload: event.payload as YamlValue,
          };
          enqueueFrame(record, frame, options);
        },
      );
      created.push([topic, subscription]);
      record.subs.set(topic, subscription);
    }
  } catch {
    for (const [topic, subscription] of created) {
      subscription.unsubscribe();
      record.subs.delete(topic);
    }
    return { ok: false, code: "WS_INTERNAL", message: "subscription failed", topics };
  }
  return { ok: true, topics };
}

// CID:fanout-003 - unsubscribeTopics
// Purpose: idempotent unsubscribe for an arbitrary topic list (W3 sub-Q 5 —
//   unsubscribing a topic you never subscribed is a no-op, no error frame).
export function unsubscribeTopics(record: ConnectionRecord, topics: readonly string[]): readonly string[] {
  for (const topic of new Set(topics)) {
    const subscription = record.subs.get(topic);
    if (!subscription) continue;
    subscription.unsubscribe();
    record.subs.delete(topic);
  }
  return topics;
}

// CID:fanout-004 - pruneSubscriptions
// Purpose: drop every bus subscription the connection accumulated. Called by
//   server.ts cleanupRecord on socket close so a closed connection doesn't leak
//   listeners on the shared event bus.
export function pruneSubscriptions(record: ConnectionRecord): void {
  for (const subscription of record.subs.values()) subscription.unsubscribe();
  record.subs.clear();
}
