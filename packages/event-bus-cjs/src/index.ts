/**
 * @platform/event-bus
 *
 * In-process pub/sub event bus for Agentide platform components.
 * Public surface: createEventBus, publish, subscribe, plus the
 * Subscription handle returned by subscribe.
 */

/*
 * Code Map: event-bus factory + dispatch internals
 * - createEventBus: factory that returns an isolated bus instance
 * - dispatchToSnapshot: private helper owning snapshot/iterate/await mechanics
 * - dispatchInternal: private publish path bypassing the reserved-namespace guard
 * - emitHandlerFailed: private helper that surfaces a failing handler
 *
 * CID Index:
 * CID:index-001 -> createEventBus
 * CID:index-002 -> dispatchInternal
 * CID:index-003 -> emitHandlerFailed
 * CID:index-004 -> dispatchToSnapshot
 *
 * Quick lookup: rg -n "CID:index-" agentide/packages/event-bus/src/index.ts
 */

import { matches, validatePattern, validateEventName } from "./match";
import {
  type EventBus,
  type EventHandler,
  type HandlerFailedPayload,
  type PlatformEvent,
  type Subscription,
  RESERVED_INTERNAL_PREFIX,
} from "./types";

// AnyEventHandler is used for internal storage where the payload type
// is not known until publish time. object is the concrete top type
// — all payloads are objects (shallow-frozen at publish) so this
// carries no type escape hatch.
type AnyEventHandler = EventHandler<object>;
type InternalPublisher = <TPayload extends object>(name: string, payload: TPayload) => Promise<void>;

const internalPublishers = new WeakMap<EventBus, InternalPublisher>();

export function publishInternalEvent<TPayload extends object>(
  eventBus: EventBus,
  name: string,
  payload: TPayload,
): Promise<void> {
  const publisher = internalPublishers.get(eventBus);
  if (!publisher) throw new Error("Event Bus does not expose internal publishing");
  return publisher(name, payload);
}

export {
  type EventHandler,
  type EventBus,
  type PlatformEvent,
  type HandlerFailedPayload,
  type Subscription,
  RESERVED_INTERNAL_PREFIX,
} from "./types";

export { matches, validatePattern } from "./match";

// CID:index-001 - createEventBus
// Purpose: factory + closure scope that owns the subscription list, the
//   registration counter, the public subscribe/publish handles, and the
//   internal helpers (dispatchInternal, emitHandlerFailed, dispatchToSnapshot).
//   Everything per-instance is hidden behind this closure so no external
//   module can reach in and mutate dispatch state.
// Uses: validatePattern (match.ts), shallowFreeze (private), matches
//   (match.ts), dispatchToSnapshot (index-004), dispatchInternal
//   (index-002), emitHandlerFailed (index-003).
// Used by: every platform component that needs its own bus instance
//   (Session Manager, Capability Registry, etc.); the entire test suite.
export function createEventBus(): EventBus {
  const subscriptions: RegisteredSubscription[] = [];
  let nextOrder = 0;

  const subscribe = <TPayload extends object>(
    pattern: string,
    handler: EventHandler<TPayload>,
  ): Subscription => {
    validatePattern(pattern);
    if (typeof handler !== "function") {
      throw new Error("subscribe: handler must be a function.");
    }
    const order = nextOrder++;
    const sub: RegisteredSubscription = {
      pattern,
      handler: handler as AnyEventHandler,
      order,
    };
    subscriptions.push(sub);
    let unsubscribed = false;
    return {
      unsubscribe(): void {
        if (unsubscribed) return;
        unsubscribed = true;
        const idx = subscriptions.indexOf(sub);
        if (idx !== -1) {
          subscriptions.splice(idx, 1);
        }
      },
    };
  };

  // Internal-only publish that bypasses the reserved-namespace guard. Used
  // by the bus itself to emit `event.handler_failed` and any other internal
  // events. This is NOT exposed on the public EventBus interface.
  // CID:index-002 - dispatchInternal
  // Purpose: bypass path used by emitHandlerFailed (index-003) so the bus
  //   can emit `event.handler_failed` without the public guard in publish()
  //   rejecting its own internal events.
  // Uses: validateEventName (match.ts), shallowFreeze (private), matches
  //   (match.ts), dispatchToSnapshot (index-004).
  // Used by: emitHandlerFailed (index-003); never called by external code.
  const dispatchInternal = async <TPayload extends object>(
    name: string,
    payload: TPayload,
  ): Promise<void> => {
    validateEventName(name);
    const event: PlatformEvent<TPayload> = Object.freeze({
      name,
      payload: shallowFreeze(payload) as Readonly<TPayload>,
      id: crypto.randomUUID(),
      publishedAt: Date.now(),
    });
    // Internal dispatch swallows handler failures silently — we are already
    // inside a failure path, so re-surfacing would loop forever.
    await dispatchToSnapshot(event, {
      onSyncError: async () => { /* swallow */ },
      onAsyncError: async () => { /* swallow */ },
    });
  };

  const publish = async <TPayload>(
    name: string,
    payload: TPayload,
  ): Promise<void> => {
    validateEventName(name);
    if (name.startsWith(RESERVED_INTERNAL_PREFIX)) {
      throw new Error(
        `Reserved namespace "${RESERVED_INTERNAL_PREFIX}" — only the Event Bus may publish events with this prefix. Got "${name}".`,
      );
    }

    const event: PlatformEvent<TPayload> = Object.freeze({
      name,
      payload: shallowFreeze(payload) as Readonly<TPayload>,
      id: crypto.randomUUID(),
      publishedAt: Date.now(),
    });

    // Public dispatch surfaces every handler failure as `event.handler_failed`
    // but never lets a failing handler reject `publish()`.
    await dispatchToSnapshot(event, {
      onSyncError: (pattern, err) => emitHandlerFailed(event.name, pattern, err),
      onAsyncError: (pattern, err) => emitHandlerFailed(event.name, pattern, err),
    });
  };

  // CID:index-003 - emitHandlerFailed
  // Purpose: surface a single handler failure as exactly one internal
  //   `event.handler_failed` event (PRD AC-11). Called from both the sync
  //   and async error paths inside dispatchToSnapshot (index-004).
  // Uses: dispatchInternal (index-002) to bypass the reserved-namespace
  //   guard and reach the failure subscribers.
  // Used by: dispatchToSnapshot (index-004) via the onSyncError /
  //   onAsyncError callbacks supplied by publish() and dispatchInternal().
  const emitHandlerFailed = async (
    eventName: string,
    subscriberPattern: string,
    error: Error,
  ): Promise<void> => {
    const normalizedError = {
      message: error.message,
      stack: error.stack,
    };
    const failurePayload: HandlerFailedPayload = Object.freeze({
      eventName,
      subscriberPattern,
      error: normalizedError,
    });
    await dispatchInternal("event.handler_failed", failurePayload);
  };

  /**
   * Shared dispatch helper: snapshot matching subscriptions, invoke each
   * handler in registration order, wait for any async handlers to settle,
   * and route every sync/async failure to the caller's error policy.
   *
   * Behavior differences between `publish` and `dispatchInternal` live in
   * the supplied `onSyncError` / `onAsyncError` callbacks — the dispatch
   * mechanics themselves are identical and live here.
   */
  // CID:index-004 - dispatchToSnapshot
  // Purpose: owns snapshot/iterate/await mechanics in one place so
  //   publish() and dispatchInternal() (index-002) differ only in their
  //   error policy. Came out of the improve-codebase-architecture review.
  // Uses: matches (match.ts) to filter subscriptions, isPromiseLike
  //   (private) to detect async return values.
  // Used by: publish() and dispatchInternal() (index-002).
  async function dispatchToSnapshot(
    event: PlatformEvent<object>,
    policy: {
      onSyncError: (pattern: string, error: Error) => Promise<void>;
      onAsyncError: (pattern: string, error: Error) => Promise<void>;
    },
  ): Promise<void> {
    // Snapshot matching subscriptions in registration order so unsubscribe
    // during dispatch cannot mutate the in-flight list (AC-15).
    const dispatchSnapshot = subscriptions
      .filter((s) => matches(s.pattern, event.name))
      .slice();

    const startedAsyncs: Array<Promise<void>> = [];

    for (let i = 0; i < dispatchSnapshot.length; i++) {
      const sub = dispatchSnapshot[i];
      try {
        const result = sub.handler(event);
        if (
          result !== null &&
          typeof result === "object" &&
          typeof (result as PromiseLike<void>).then === "function"
        ) {
          const tracked = (result as Promise<void>).then(
            () => undefined,
            async (err) => {
              await policy.onAsyncError(
                sub.pattern,
                err instanceof Error ? err : new Error(String(err)),
              );
            },
          );
          startedAsyncs.push(tracked);
        }
      } catch (syncError) {
        await policy.onSyncError(
          sub.pattern,
          syncError instanceof Error ? syncError : new Error(String(syncError)),
        );
      }
    }

    await Promise.allSettled(startedAsyncs);
  }

  const bus: EventBus = { publish, subscribe };
  internalPublishers.set(bus, dispatchInternal);
  return bus;
}

// --- private helpers ---

interface RegisteredSubscription {
  pattern: string;
  handler: AnyEventHandler;
  order: number;
}

function shallowFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
