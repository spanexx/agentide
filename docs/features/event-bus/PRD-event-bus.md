# PRD: Event Bus

## Status

- Type: Product requirements document
- Audience: Platform engineering, QA
- Scope: In-process pub/sub event bus that all platform components use to communicate without direct dependencies.
- Status: Approved 2026-07-26. Implemented as `@platform/event-bus` (see [packages/event-bus/](../../../packages/event-bus/) and [IMPL-event-bus.md § Phase Plan](./IMPL-event-bus.md#3-phase-plan) for the implementation record). All 17 acceptance criteria covered; 29 behaviour tests pass.

## Summary

The Event Bus is a small, custom in-process pub/sub mechanism that every platform
component publishes to and subscribes from. It replaces direct cross-component
references between Control Plane, Execution Plane, Runtimes, and Plugins, so
that any one component can be replaced, restarted, or held back without
unblocking the rest. Events are immutable facts; handlers run in deterministic
subscription order; one misbehaving handler never silently breaks the others.

## Problem

The platform has many components — Gateway, Session Manager, Capability
Registry, Plugin Manager, Runtimes, Plugins — that all need to react to things
happening elsewhere in the system (a session ends, a capability is registered,
a browser tab navigates). If each component subscribes to the others
directly, every replacement or restart becomes a coupled change, plugins
acquire forbidden knowledge of each other, and ordering of side effects
becomes non-deterministic.

The cost of leaving this unsolved: no safe way for a Browser Runtime plugin
to tell an Analytics plugin "a page just loaded" without one knowing the other
exists; no way for Session Manager to know which subscribers to clean up
when a session ends; no way for a single broken handler to be quarantined
without taking down the whole pipeline.

## Product Goals

1. Allow any platform component to publish a typed, named event without
   knowing its subscribers.
2. Allow any component to subscribe to a specific event or to a wildcard
   topic like `browser.*` in a single call.
3. Guarantee synchronous dispatch in subscription order so that observers
   see a deterministic event sequence.
4. Allow handlers to be synchronous or `async`; `publish()` resolves only
   after every handler settles, so callers can rely on "this event finished
   being handled" before continuing.
5. Isolate handler failures — a throw or rejection in one handler must not
   stop the others from running and must not reject `publish()`.
6. Make every published event immutable at the type level (TypeScript
   `readonly`) and at runtime (`Object.freeze`, shallow) so handlers can't
   corrupt history.
7. Allow handlers to be unsubscribed so Session Manager can clean up a
   session's subscriptions when it ends.

## Non-Goals

- **Cross-process or cross-network delivery.** The bus is in-process only;
  a runtime that wants cross-process events must publish via its own
  transport and have a local subscriber forward.
- **Event replay, persistence, or a queryable history.** Events are facts
  that happened; late subscribers do not see past events.
- **Listener-count caps, backpressure, or rate limiting.** A v1 platform
  has bounded components; a runaway listener is a bug to fix, not a
  resource to throttle.
- **A general-purpose distributed event broker** (Kafka, NATS, Redis
  Pub/Sub, etc.). That is a separate future feature if ever needed.
- **Built-in serialization.** Handlers run in the same process as the
  publisher; payload types are plain TypeScript values.

## Canonical Product Language

All terms already live in `CONTEXT.md`. This feature does not introduce new
terms. It binds the following glossary entries to concrete behaviour:

- **Event / Event Bus** — as defined in `CONTEXT.md`: immutable fact +
  pub/sub delivery mechanism. The custom not-EventEmitter semantics,
  synchronous dispatch, async handlers via `Promise.allSettled`, dot
  wildcards, `Object.freeze` shallow immutability, unsubscribe, and
  `event.handler_failed` failure surfacing all live in this PRD.
- **Capability** — uses the `<domain>.<action>` naming so wildcard
  subscriptions like `browser.*` and `capability.*` line up naturally.
- **Session** — owns resources and is destroyed; the bus is the mechanism
  by which a session's resources (its subscriptions) are cleaned up.

## Product Scope

### Core flow — publish and subscribe

A component announces that something happened by publishing an event
under a dotted name (for example, `browser.page.loaded`) and a payload
describing the fact (the URL, the tab id). The bus freezes the payload,
finds every subscriber whose pattern matches that name, and dispatches
to them synchronously, in the order they subscribed.

A component subscribes either to a single specific event name or to a
wildcard topic such as `browser.*` in one call. A handler may be
synchronous or asynchronous; the bus accepts either. The subscription
returns an unsubscribe handle; calling that handle removes the
subscription from the bus.

When at least one handler is asynchronous, the publish call returns a
promise that resolves only after every handler has settled.

### Failure surfacing

When a handler throws or rejects, the bus emits a single internal
`event.handler_failed` event so that the failure is observable rather
than silent. The publish call itself does not reject, and the remaining
handlers still run to completion.

### Subscription lifecycle

The bus holds a subscription until the unsubscribe handle is called.
It does not own subscriptions or tie them to any other lifecycle; the
caller (typically Session Manager) is responsible for keeping the
unsubscribe handle and invoking it when the relevant scope ends.

## User Stories

1. As a **Browser Runtime**, I want to publish `browser.page.loaded`
   with the URL and tab id, so that any number of plugins (analytics,
   logger, debugger) can observe it without me importing them.
2. As an **Analytics Plugin**, I want to subscribe to `browser.*` in a
   single call, so that I automatically receive every browser-related
   event without the bus having to know me in advance.
3. As a **Debugger Plugin**, I want to subscribe to a single specific
   event like `session.created`, so that I only pay for what I use.
4. As a **Capability Registry**, I want to publish `capability.registered`
   after writing to the store, so that downstream listeners can react,
   and I want the publish call to wait until they finish so my next
   read sees a consistent world.
5. As a **Session Manager**, I want each subscription to hand me an
   unsubscribe handle, so that when a session ends I can clean up every
   subscription that session made without iterating internal state of
   the bus.
6. As a **plugin author**, I want one broken handler in another plugin
   to not stop my plugin from running, so that a noisy neighbour can't
   take down my observation pipeline.
7. As a **platform operator**, I want events to be immutable, so that a
   handler can't mutate the payload after the fact and silently corrupt
   downstream observers.
8. As a **future Gateway author**, I want to subscribe to every event in
   the system in one call, so that I can log everything for debugging
   without registering for each event name.

## Acceptance Criteria

- [ ] Publishing an event with a given name reaches every handler whose
      subscription pattern matches that name.
- [ ] A subscription on `*` receives events of the form
      `<prefix>.<single-segment>` and not deeper paths.
- [ ] A subscription on `**` receives every event name at any depth,
      including all events in the system.
- [ ] Subscriptions are delivered in the order they were registered, and
      that order is observable and stable across publishes.
- [ ] Handlers are invoked in registration order even when sync and async
      handlers are mixed; asynchronous completion order is not guaranteed.
- [ ] An asynchronous handler causes the publish call to return a
      promise that resolves only after every handler (sync or async)
      has settled.
- [ ] A handler that throws does not stop subsequent handlers in the
      same dispatch.
- [ ] A handler that returns a rejected promise does not stop subsequent
      handlers in the same dispatch.
- [ ] A handler that throws or rejects does not cause the publish call
      itself to reject.
- [ ] When at least one handler is asynchronous, the publish call
      returns a promise that resolves successfully even if some handlers
      reject.
- [ ] The bus emits exactly one `event.handler_failed` event per failing
      handler with the original event, the failing handler index, and
      the error.
- [ ] Published event payloads are shallowly frozen before dispatch; a
      mutation attempt on a frozen payload either throws (strict mode)
      or is a silent no-op (sloppy mode), but never succeeds in
      changing the value seen by other handlers.
- [ ] Event payload types declared in TypeScript carry `readonly`
      modifiers on their properties by convention.
- [ ] Calling the unsubscribe handle removes the subscription so that
      subsequent publishes do not deliver to the removed handler.
- [ ] Calling unsubscribe from inside a handler does not affect the
      remaining handlers of the in-flight dispatch.
- [ ] Only the Event Bus itself may publish `event.*` events; other
      components must publish under their own namespaces.
- [ ] The bus has no observable global state outside its own instance;
      two independent bus instances do not see each other's events.

## Rollout and Risk

- **Migration risk**: none — no consumers exist yet. This is the first
  feature in Tier 1, so nothing has to be rewritten.
- **Compatibility risk**: low. The bus is additive. Future components
  must adopt it; nothing in the existing repo depends on cross-component
  coupling today (the repo has no commits yet).
- **Rollout strategy**: ship as a single npm workspace package
  `@platform/event-bus` inside `agentide/packages/`. Land it behind no
  flag — it has no behaviour until something subscribes. Consumers
  (Session Manager, Capability Registry, Plugin Manager) are the next
  Tier 1 features and will pull it in as a normal workspace dependency.

## Out of Scope

| Item | Reason deferred |
|---|---|
| Persistent event log / replay | Out of scope for v1; persistence is a storage decision, not a bus decision. Late subscribers do not get past events. |
| Cross-process delivery | Sync dispatch in subscription order cannot be honoured across processes. Revisit if multi-process gateway ever becomes a real requirement. |
| Listener-count cap or backpressure | Premature for an internal bus with bounded components; add only if a real runaway is observed. |
| Schema validation of payloads | Each publisher owns its payload type via TypeScript; runtime validation would be a separate cross-cutting concern. |
| Auto-cleanup of subscriptions tied to session lifetime | Useful, but the bus should not know about sessions. Session Manager tracks the unsubscribe handles returned at subscribe time and invokes them when the session ends. |

## Further Notes

### Resolved design decisions

- **Wildcard syntax.** `*` matches exactly one dotted segment.
  `**` matches any depth, including "all events in the system."
- **`event.handler_failed` payload shape.** Emit the original event,
  the failing handler index, and the error. This gives operators enough
  detail to debug without inventing stable subscription ids in v1.
- **Mixed sync/async dispatch.** Invoke handlers in registration order.
  Sync handlers complete inline; async handlers start when reached; the
  publish call waits for all started async handlers to settle.
- **Internal namespace boundary.** `event.*` is reserved for Event Bus
  internal events only. Normal platform features publish under their
  own namespaces such as `session.*`, `capability.*`, or `browser.*`.

### Standing notes

- The `event.handler_failed` event uses the `event.*` namespace that
  `CONTEXT.md` reserves for bus-internal events.
- The exact list of publishable events is not fixed by this PRD; later
  features (Session Manager, Capability Registry, etc.) introduce their
  own event names under their own namespaces (`session.*`,
  `capability.*`, etc.). The bus itself is namespace-agnostic.
- Stability signals for this PRD come from `CONTEXT.md` and
  `docs/architecture/Terminology.md → Event Bus`,
  `docs/architecture/Agentide.md → §13 Event Bus`. Source docs already
  pin every behavior in Product Goals 1–7.
