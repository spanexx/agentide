# @platform/event-bus

In-process pub/sub event bus for Agentide platform components.

Replaces direct cross-component references between Control Plane, Execution
Plane, Runtimes, and Plugins so any one component can be replaced, restarted,
or held back without unblocking the rest. Events are immutable facts; handlers
run in deterministic subscription order; one misbehaving handler never silently
breaks the others.

## Install

This package lives inside the Agentide workspace and is consumed as a workspace
dependency. No external runtime dependencies are added by this package.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";

const bus = createEventBus();

// Subscribe — exact name or prefix wildcard (`a.b.*` matches any depth).
const sub = bus.subscribe("browser.*", (event) => {
  console.log(event.name, event.id, event.publishedAt, event.payload);
});

// Publish — payload is shallowly frozen before dispatch.
await bus.publish("browser.page.loaded", { url: "https://example.com", tabId: 7 });

// Cleanup — caller owns the subscription handle.
sub.unsubscribe();
```

## Contract

- `createEventBus()` returns an isolated bus instance. Two instances never see
  each other's events.
- Subscriptions receive events in registration order. `*` as a final segment
  matches any remaining depth (prefix wildcard). A bare `*` matches every event.
- Handlers may be sync or async. `publish()` resolves only after every invoked
  async handler settles. A throwing or rejecting handler never stops later
  handlers and never rejects the original `publish()`.
- One failing handler emits exactly one internal `event.handler_failed` event
  with `{ eventName, subscriberPattern, error: { message, stack? } }`.
- Calling `subscription.unsubscribe()` removes the subscription from later
  publishes. Unsubscribing from inside a handler does not change the in-flight
  dispatch. Double-unsubscribe is safe (no-op).
- Payloads are shallow-frozen before dispatch. TypeScript declarations mark
  payload properties as `readonly` by convention.
- The `event.*` namespace is reserved for the bus itself; external callers
  attempting to publish into it are rejected.

## Public surface

| Export | Kind |
|---|---|
| `createEventBus` | factory |
| `EventBus` | interface (`publish`, `subscribe`) |
| `PlatformEvent` | interface (immutable event with id + publishedAt) |
| `HandlerFailedPayload` | interface (payload of `event.handler_failed`) |
| `EventHandler` | type (sync or async handler) |
| `Subscription` | interface (unsubscribe handle) |
| `RESERVED_INTERNAL_PREFIX` | constant (`"event."`) |
| `matches` | function (pattern ↔ name wildcard matcher) |

## Design references

- PRD: [docs/features/event-bus-b/PRD-event-bus.md](../../docs/features/event-bus-b/PRD-event-bus.md)
- TRD: [docs/features/event-bus-b/TRD-event-bus.md](../../docs/features/event-bus-b/TRD-event-bus.md)
- FLOW: [docs/features/event-bus-b/FLOW-event-bus.md](../../docs/features/event-bus-b/FLOW-event-bus.md)
- IMPL: [docs/features/event-bus-b/IMPL-event-bus.md](../../docs/features/event-bus-b/IMPL-event-bus.md)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Event / Event Bus*
