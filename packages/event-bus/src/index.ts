/**
 * @platform/event-bus
 *
 * In-process pub/sub event bus for Agentide platform components.
 * Public surface: createEventBus, publish, subscribe, plus the unsubscribe
 * handle returned by subscribe.
 */

/*
 * Code Map: event-bus public surface + internal dispatch helpers
 * - createEventBus: factory that returns an isolated bus instance.
 * - EventBus: interface exposing publish + subscribe.
 * - PlatformEvent: immutable event shape handed to handlers (includes id + publishedAt).
 * - HandlerFailedPayload: payload of the bus-internal event.handler_failed.
 * - EventHandler: type for sync-or-async handler functions.
 * - RESERVED_INTERNAL_PREFIX: constant "event." — bus-internal namespace.
 * - matches: exported wildcard matcher (pattern ↔ event name).
 * - dispatchToSnapshot: private helper owning snapshot/iterate/await mechanics.
 * - dispatchInternal: private publish path used by the bus itself for
 *   event.handler_failed (bypasses the reserved-namespace guard).
 * - emitHandlerFailed: private helper that surfaces a failing handler.
 *
 * CID Index:
 * CID:index-001 -> createEventBus
 * CID:index-002 -> EventBus
 * CID:index-003 -> PlatformEvent
 * CID:index-004 -> HandlerFailedPayload
 * CID:index-005 -> EventHandler
 * CID:index-006 -> RESERVED_INTERNAL_PREFIX
 * CID:index-007 -> matches
 * CID:index-008 -> dispatchToSnapshot
 * CID:index-009 -> dispatchInternal
 * CID:index-010 -> emitHandlerFailed
 *
 * Quick lookup: rg -n "CID:index-" agentide/packages/event-bus/src/index.ts
 */

// CID:index-005 - EventHandler
// Purpose: type for any sync or async handler passed to subscribe().
// Uses: PlatformEvent<TPayload> (must be defined first via type-only forward ref).
// Used by: EventBus.subscribe signatures, all handler invocations in
//   dispatchToSnapshot (index-008).
export type EventHandler<TPayload = unknown> = (
  event: PlatformEvent<TPayload>,
) => unknown;

// CID:index-003 - PlatformEvent
// Purpose: immutable shape handed to every handler; `name`, `payload`,
//   `id`, and `publishedAt` are all `readonly` so TypeScript callers
//   cannot accidentally mutate. Runtime dispatch shallow-freezes the
//   payload before handing it out (PRD AC-12, AC-13).
// Uses: shallowFreeze (private).
// Used by: createEventBus (publish path), matches test surface.
export interface PlatformEvent<TPayload = unknown> {
  readonly name: string;
  readonly payload: Readonly<TPayload>;
  readonly id: string;
  readonly publishedAt: number;
}

// CID:index-004 - HandlerFailedPayload
// Purpose: payload of the bus-internal `event.handler_failed` event so
//   observability tooling can see which subscriber failed and why.
//   Carries the original event name, the subscriber's pattern, and a
//   normalized error (TRD §2.2 — eventName + subscriberPattern +
//   { message, stack? }).
// Uses: none.
// Used by: emitHandlerFailed (index-010) when constructing the failure
//   payload; subscribers on `event.handler_failed` consume it.
export interface HandlerFailedPayload {
  readonly eventName: string;
  readonly subscriberPattern: string;
  readonly error: { message: string; stack?: string };
}

export interface Subscription {
  unsubscribe(): void;
}

// CID:index-002 - EventBus
// Purpose: minimal public contract callers rely on. Exactly two methods
//   so the seam stays tiny: nothing in this package exposes dispatch
//   internals, subscription storage, or middleware hooks.
// Uses: EventHandler (index-005) for the handler signature.
// Used by: every platform component that publishes or subscribes; the
//   only contract surface for tests (createEventBus.phase{1,2,3}.test.ts).
export interface EventBus {
  publish<TPayload>(name: string, payload: TPayload): Promise<void>;
  subscribe(pattern: string, handler: EventHandler): Subscription;
}

/**
 * Reserved namespace for events the Event Bus itself emits (currently
 * `event.handler_failed`). External callers must publish under their own
 * namespaces.
 */
// CID:index-006 - RESERVED_INTERNAL_PREFIX
// Purpose: single source of truth for the "event." namespace boundary
//   (PRD AC-16). Exported so callers can compare against it without
//   re-stringing the prefix in user code.
// Uses: none.
// Used by: publish() guard ("name.startsWith(RESERVED_INTERNAL_PREFIX)")
//   and external callers avoiding string typos.
export const RESERVED_INTERNAL_PREFIX = "event.";

/**
 * Create a new, isolated Event Bus instance.
 *
 * Each instance owns its own subscription list; one bus never sees events
 * published on another. The returned bus has no external dependencies and
 * keeps all state behind one public seam: `publish`, `subscribe`, and the
 * unsubscribe function returned by `subscribe`.
 */
// CID:index-001 - createEventBus
// Purpose: factory + closure scope that owns the subscription list, the
//   registration counter, the public subscribe/publish handles, and the
//   internal helpers (dispatchInternal, emitHandlerFailed, dispatchToSnapshot).
//   Everything per-instance is hidden behind this closure so no external
//   module can reach in and mutate dispatch state.
// Uses: validatePattern (private), shallowFreeze (private), matches
//   (index-007), dispatchToSnapshot (index-008), dispatchInternal
//   (index-009), emitHandlerFailed (index-010).
// Used by: every platform component that needs its own bus instance
//   (Session Manager, Capability Registry, etc.); the entire test suite.
export function createEventBus(): EventBus {
  const subscriptions: RegisteredSubscription[] = [];
  let nextOrder = 0;

  const subscribe = (pattern: string, handler: EventHandler): Subscription => {
    validatePattern(pattern);
    if (typeof handler !== "function") {
      throw new Error("subscribe: handler must be a function.");
    }
    const order = nextOrder++;
    const sub: RegisteredSubscription = { pattern, handler, order };
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
  // CID:index-009 - dispatchInternal
  // Purpose: bypass path used by emitHandlerFailed (index-010) so the
  //   bus can emit `event.handler_failed` without the public guard in
  //   publish() rejecting its own internal events.
  // Uses: validateEventName (private), shallowFreeze (private), matches
  //   (index-007), dispatchToSnapshot (index-008).
  // Used by: emitHandlerFailed (index-010); never called by external code.
  const dispatchInternal = async <TPayload>(
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
      onSyncError: async () => {
        /* swallow */
      },
      onAsyncError: async () => {
        /* swallow */
      },
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

  // CID:index-010 - emitHandlerFailed
  // Purpose: surface a single handler failure as exactly one internal
  //   `event.handler_failed` event (PRD AC-11). Called from both the
  //   sync and async error paths inside dispatchToSnapshot (index-008).
  // Uses: dispatchInternal (index-009) to bypass the reserved-namespace
  //   guard and reach the failure subscribers.
  // Used by: dispatchToSnapshot (index-008) via the onSyncError /
  //   onAsyncError callbacks supplied by publish() and dispatchInternal().
  const emitHandlerFailed = async (
    eventName: string,
    subscriberPattern: string,
    error: unknown,
  ): Promise<void> => {
    const normalizedError =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error), stack: undefined };
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
  // CID:index-008 - dispatchToSnapshot
  // Purpose: owns snapshot/iterate/await mechanics in one place so
  //   publish() and dispatchInternal() (index-009) differ only in their
  //   error policy. Came out of the improve-codebase-architecture review
  //   — eliminates duplication between the two paths.
  // Uses: matches (index-007) to filter subscriptions, isPromiseLike
  //   (private) to detect async return values.
  // Used by: publish() and dispatchInternal() (index-009).
  async function dispatchToSnapshot(
    event: PlatformEvent<unknown>,
    policy: {
      onSyncError: (pattern: string, error: unknown) => Promise<void>;
      onAsyncError: (pattern: string, error: unknown) => Promise<void>;
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
        if (isPromiseLike(result)) {
          // Async handler: track the promise so we can wait for it AND
          // capture any rejection to surface via `onAsyncError`.
          const tracked = (result as Promise<unknown>).then(
            () => undefined,
            async (err: unknown) => {
              await policy.onAsyncError(sub.pattern, err);
            },
          );
          startedAsyncs.push(tracked);
        }
      } catch (syncError) {
        // Sync handler threw. Route to the caller's policy and continue.
        await policy.onSyncError(sub.pattern, syncError);
      }
    }

    // Caller's publish path resolves only after every async handler settled.
    // `Promise.allSettled` ensures a rejection here can't reject the caller.
    await Promise.allSettled(startedAsyncs);
  }

  return { publish, subscribe };
}

// --- internal helpers ---

interface RegisteredSubscription {
  pattern: string;
  handler: EventHandler;
  order: number;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function validatePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("Invalid subscription pattern: must be non-empty string.");
  }
  const segments = pattern.split(".");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "*") {
      if (i !== segments.length - 1) {
        throw new Error(
          `"*" is only valid as the final segment of a pattern. Got "${pattern}".`,
        );
      }
      continue;
    }
    if (seg.includes("*")) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (* must be its own segment).`,
      );
    }
    if (seg.length === 0) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (empty segment).`,
      );
    }
  }
}

function validateEventName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Invalid event name: must be non-empty string.");
  }
  if (name.includes("..")) {
    throw new Error(`Invalid event name "${name}" (empty segment).`);
  }
}

/**
 * Wildcard matching:
 *   - exact segment match if no wildcard
 *   - `*` as the final segment matches any remaining depth
 *   - bare `*` matches every event name
 */
// CID:index-007 - matches
// Purpose: public wildcard matcher — both the bus itself (via
//   dispatchToSnapshot, index-008) and external callers use it to test
//   whether a subscription pattern would match an event name. Keeping
//   it exported avoids re-implementing the grammar elsewhere.
// Uses: string segment splitting; no other helpers.
// Used by: dispatchToSnapshot (index-008), matches.test.ts (unit
//   coverage of the grammar).
export function matches(pattern: string, name: string): boolean {
  const pSegs = pattern.split(".");
  const nSegs = name.split(".");

  // If last segment is `*`, treat as prefix wildcard
  if (pSegs.length > 0 && pSegs[pSegs.length - 1] === "*") {
    const prefix = pSegs.slice(0, -1);
    if (prefix.length > nSegs.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== nSegs[i]) return false;
    }
    return true;
  }

  // Exact match
  if (pSegs.length !== nSegs.length) return false;
  for (let i = 0; i < pSegs.length; i++) {
    if (pSegs[i] !== nSegs[i]) return false;
  }
  return true;
}

function shallowFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value as Readonly<T>;
}