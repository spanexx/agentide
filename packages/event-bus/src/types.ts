/*
 * Code Map: event-bus public types
 * - EventHandler: type for sync-or-async handler functions
 * - PlatformEvent: immutable event shape handed to handlers
 * - HandlerFailedPayload: payload of the bus-internal event.handler_failed
 * - Subscription: unsubscribe handle returned by subscribe()
 * - EventBus: public interface with publish + subscribe
 * - RESERVED_INTERNAL_PREFIX: constant "event." — bus-internal namespace
 *
 * CID Index:
 * CID:types-001 -> EventHandler
 * CID:types-002 -> PlatformEvent
 * CID:types-003 -> HandlerFailedPayload
 * CID:types-004 -> Subscription
 * CID:types-005 -> EventBus
 * CID:types-006 -> RESERVED_INTERNAL_PREFIX
 *
 * Quick lookup: rg -n "CID:types-" agentide/packages/event-bus/src/types.ts
 */

// CID:types-001 - EventHandler
// Purpose: type for any sync or async handler passed to subscribe().
//   Return type is `void | Promise<void>` because we never inspect handler
//   return values — we only await promise settlement.
// Uses: PlatformEvent<TPayload>.
// Used by: EventBus.subscribe signatures, dispatchToSnapshot handler invocations.
export type EventHandler<TPayload> = (
  event: PlatformEvent<TPayload>,
) => void | Promise<void>;

// CID:types-002 - PlatformEvent
// Purpose: immutable shape handed to every handler; `name`, `payload`,
//   `id`, and `publishedAt` are all `readonly` so TypeScript callers
//   cannot accidentally mutate. Runtime dispatch shallow-freezes the
//   payload before handing it out (PRD AC-12, AC-13).
// Uses: none.
// Used by: EventHandler, createEventBus (publish path), emitHandlerFailed.
export interface PlatformEvent<TPayload> {
  readonly name: string;
  readonly payload: Readonly<TPayload>;
  readonly id: string;
  readonly publishedAt: number;
}

// CID:types-003 - HandlerFailedPayload
// Purpose: payload of the bus-internal `event.handler_failed` event so
//   observability tooling can see which subscriber failed and why.
//   Carries the original event name, the subscriber's pattern, and a
//   normalized error (TRD §2.2).
// Uses: none.
// Used by: emitHandlerFailed when constructing the failure payload;
//   subscribers on `event.handler_failed` consume it.
export interface HandlerFailedPayload {
  readonly eventName: string;
  readonly subscriberPattern: string;
  readonly error: { message: string; stack?: string };
}

// CID:types-004 - Subscription
// Purpose: handle returned by subscribe() so callers can cancel future
//   deliveries. Idempotent — calling unsubscribe() twice is a no-op.
// Uses: none.
// Used by: EventBus.subscribe return type, every component that subscribes.
export interface Subscription {
  unsubscribe(): void;
}

// CID:types-005 - EventBus
// Purpose: minimal public contract callers rely on. Exactly two methods
//   so the seam stays tiny: nothing in this package exposes dispatch
//   internals, subscription storage, or middleware hooks.
// Uses: EventHandler, Subscription.
// Used by: every platform component that publishes or subscribes; the
//   entire test suite.
export interface EventBus {
  publish<TPayload extends object>(name: string, payload: TPayload): Promise<void>;
  subscribe<TPayload extends object>(pattern: string, handler: EventHandler<TPayload>): Subscription;
}

/**
 * Reserved namespace for events the Event Bus itself emits (currently
 * `event.handler_failed`). External callers must publish under their own
 * namespaces.
 */
// CID:types-006 - RESERVED_INTERNAL_PREFIX
// Purpose: single source of truth for the "event." namespace boundary
//   (PRD AC-16). Exported so callers can compare against it without
//   re-stringing the prefix in user code.
// Uses: none.
// Used by: publish() guard ("name.startsWith(RESERVED_INTERNAL_PREFIX)")
//   and external callers avoiding string typos.
export const RESERVED_INTERNAL_PREFIX = "event.";
