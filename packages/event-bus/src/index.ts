/**
 * @platform/event-bus
 *
 * In-process pub/sub event bus for Agentide platform components.
 * Public surface: createEventBus, publish, subscribe, plus the unsubscribe
 * handle returned by subscribe.
 */

export type EventHandler<TPayload = unknown> = (
  event: PublishedEvent<TPayload>,
) => unknown;

export interface PublishedEvent<TPayload = unknown> {
  readonly name: string;
  readonly payload: Readonly<TPayload>;
}

export interface HandlerFailurePayload<TPayload = unknown> {
  readonly event: PublishedEvent<TPayload>;
  readonly handlerIndex: number;
  readonly error: unknown;
}

export interface EventBus {
  publish<TPayload>(name: string, payload: TPayload): Promise<void>;
  subscribe(pattern: string, handler: EventHandler): () => void;
}

/**
 * Reserved namespace for events the Event Bus itself emits (currently
 * `event.handler_failed`). External callers must publish under their own
 * namespaces.
 */
export const RESERVED_INTERNAL_PREFIX = "event.";

/**
 * Create a new, isolated Event Bus instance.
 *
 * Each instance owns its own subscription list; one bus never sees events
 * published on another. The returned bus has no external dependencies and
 * keeps all state behind one public seam: `publish`, `subscribe`, and the
 * unsubscribe function returned by `subscribe`.
 */
export function createEventBus(): EventBus {
  const subscriptions: Subscription[] = [];
  let nextOrder = 0;

  const subscribe = (pattern: string, handler: EventHandler): (() => void) => {
    validatePattern(pattern);
    if (typeof handler !== "function") {
      throw new Error("subscribe: handler must be a function.");
    }
    const order = nextOrder++;
    const subscription: Subscription = { pattern, handler, order };
    subscriptions.push(subscription);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const index = subscriptions.indexOf(subscription);
      if (index !== -1) {
        subscriptions.splice(index, 1);
      }
    };
  };

  // Internal-only publish that bypasses the reserved-namespace guard. Used
  // by the bus itself to emit `event.handler_failed` and any other internal
  // events. This is NOT exposed on the public EventBus interface.
  const dispatchInternal = async <TPayload>(
    name: string,
    payload: TPayload,
  ): Promise<void> => {
    validateEventName(name);
    const event: PublishedEvent<TPayload> = Object.freeze({
      name,
      payload: shallowFreeze(payload) as Readonly<TPayload>,
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

    const event: PublishedEvent<TPayload> = Object.freeze({
      name,
      payload: shallowFreeze(payload) as Readonly<TPayload>,
    });

    // Public dispatch surfaces every handler failure as `event.handler_failed`
    // but never lets a failing handler reject `publish()`.
    await dispatchToSnapshot(event, {
      onSyncError: (i, err) => emitHandlerFailed(event, i, err),
      onAsyncError: (i, err) => emitHandlerFailed(event, i, err),
    });
  };

  const emitHandlerFailed = async <TPayload>(
    originalEvent: PublishedEvent<TPayload>,
    handlerIndex: number,
    error: unknown,
  ): Promise<void> => {
    const failurePayload: HandlerFailurePayload<TPayload> = Object.freeze({
      event: originalEvent,
      handlerIndex,
      error,
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
  async function dispatchToSnapshot(
    event: PublishedEvent<unknown>,
    policy: {
      onSyncError: (handlerIndex: number, error: unknown) => Promise<void>;
      onAsyncError: (handlerIndex: number, error: unknown) => Promise<void>;
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
              await policy.onAsyncError(i, err);
            },
          );
          startedAsyncs.push(tracked);
        }
      } catch (syncError) {
        // Sync handler threw. Route to the caller's policy and continue.
        await policy.onSyncError(i, syncError);
      }
    }

    // Caller's publish path resolves only after every async handler settled.
    // `Promise.allSettled` ensures a rejection here can't reject the caller.
    await Promise.allSettled(startedAsyncs);
  }

  return { publish, subscribe };
}

// --- internal helpers ---

interface Subscription {
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
    if (seg === "**") {
      if (i !== segments.length - 1) {
        throw new Error(
          `"**" is only valid as the final segment of a pattern. Got "${pattern}".`,
        );
      }
      continue;
    }
    if (seg === "*") continue;
    if (seg.length === 0) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (empty segment).`,
      );
    }
    if (seg.includes("*")) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (* must be its own segment).`,
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
 *   - exact segment match otherwise
 *   - `*` matches exactly one segment
 *   - `**` as the final segment matches any remaining depth
 */
export function matches(pattern: string, name: string): boolean {
  const pSegs = pattern.split(".");
  const nSegs = name.split(".");
  let pi = 0;
  let ni = 0;
  while (pi < pSegs.length && ni < nSegs.length) {
    const p = pSegs[pi];
    if (p === "**") {
      return true;
    }
    if (p === "*") {
      pi++;
      ni++;
      continue;
    }
    if (p !== nSegs[ni]) return false;
    pi++;
    ni++;
  }
  return pi === pSegs.length && ni === nSegs.length;
}

function shallowFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value as Readonly<T>;
}