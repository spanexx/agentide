# PRD: Event Bus

## Status

- Type: Product requirements document
- Audience: Product, engineering, QA
- Scope: In-process, typed publish/subscribe event delivery mechanism for the platform's
  Control Plane and Execution Plane components — no consumers required yet.

## Summary

The Event Bus is the platform's internal nervous system — the mechanism every other Control
Plane and Execution Plane component uses to broadcast "something happened" (a session was
created, a browser closed, a capability executed) without knowing who, if anyone, is
listening. This PRD covers building that mechanism itself: publish, subscribe (including
namespace wildcards), and failure-isolated delivery. It does not cover any specific component
actually publishing or subscribing yet — that arrives with each component's own feature.

## Problem

Today, nothing in the platform can react to "something happened" elsewhere without being
directly wired to that specific producer. A browser starting, a session being created, a
capability executing — every consumer who cares (Logger, Debugger, Analytics, the future
Dashboard) would need a hard-coded dependency on every producer, and every producer would
need to know about every consumer in advance. Without a way to decouple "something happened"
from "who cares," the platform can't add a new observability feature — like a Dashboard event
timeline — without modifying the code of everything it wants to observe.

## Product Goals

1. Any Control Plane or Execution Plane component can publish a named event carrying a
   payload, without knowing who (if anyone) is subscribed.
2. Any component can subscribe to an exact event name (`session.created`) or a namespace
   wildcard (`browser.*`), and receive every matching event from the moment it subscribes
   onward.
3. One subscriber's handler failing (throwing or rejecting) never prevents other subscribers
   from receiving the same event.
4. A handler failure is observable — surfaced as a system event (`event.handler_failed`) —
   rather than silently swallowed.
5. Published event payloads cannot be mutated by a subscriber in a way that affects other
   subscribers or the publisher.
6. A subscriber can unsubscribe, and a session's subscriptions are fully removed when that
   session ends.

## Non-Goals

- Cross-process or distributed event delivery (e.g. Redis pub/sub, a message queue). This is
  in-process only; a distributed backend is a future runtime/plugin concern, not part of this
  feature.
- Event persistence, replay, or event sourcing. Events are fire-and-forget; nothing is stored
  for later reconstruction.
- Automatic retry of failed handlers. A failure is reported once via `event.handler_failed`;
  there is no redelivery.
- Guaranteed delivery ordering across different event names. Ordering is only guaranteed
  among handlers registered for the same event name (or the same matching wildcard) — not
  globally across the whole bus.
- Any specific platform component actually publishing or subscribing to real events (Session
  Manager emitting `session.created`, etc.) — that arrives with each of those components' own
  features, built on top of this one.

## Canonical Product Language

- **Event**: An immutable fact that something happened inside the platform.
- **Event Bus**: The pub/sub delivery mechanism between components.
- **Control Plane**: Gateway + Session Manager + Capability Registry + Plugin Manager —
  coordinates, doesn't execute. The Event Bus is a Control Plane component.
- **Execution Plane**: All Runtimes — executes, doesn't coordinate. Execution Plane
  components also publish/subscribe through this same bus.

## Product Scope

### Publishing

A component calls `publish` with an event name and a payload. The event bus determines which
subscribers match (exact name or wildcard) and calls each of their handlers. The publisher
does not know or care who is subscribed, or how many subscribers there are.

### Subscribing

A component subscribes with either an exact event name (`session.created`) or a namespace
wildcard (`browser.*`, meaning "everything under browser"). Multiple subscribers can listen
to the same event; each receives its own independent call.

### Delivery and failure isolation

When an event is published, every matching subscriber's handler is called. If one handler
throws or its returned promise rejects, the remaining subscribers still receive the event
normally — one broken listener never silences the others. The failure itself is reported via
a dedicated `event.handler_failed` event, which goes through the same bus, so anything
already subscribed to it (e.g. a future Logger) finds out.

### Unsubscribing

A subscription can be cancelled explicitly. This matters most for session-scoped resources:
per the platform's session model, anything a session subscribes to on its own behalf must be
cleaned up automatically when that session ends.

## User Stories

1. As a platform component (e.g. the future Session Manager), I want to publish an event
   without knowing who's listening, so that I don't need a direct dependency on every
   possible consumer.
2. As a platform component (e.g. the future Dashboard), I want to subscribe to a specific
   event name, so that I can react only to what I care about.
3. As a platform component (e.g. a future Analytics plugin), I want to subscribe to a whole
   namespace of events (`browser.*`) in one call, so that I don't have to enumerate every
   individual event name up front.
4. As a platform operator, I want one broken subscriber to never silently prevent other
   subscribers from getting notified, so that a bug in one plugin doesn't quietly break
   observability for every other plugin.
5. As a platform operator, I want to be told when a subscriber's handler fails, so that a
   broken listener doesn't go unnoticed indefinitely.
6. As a session, I want my subscriptions automatically removed when I end, so that ended
   sessions don't leave dangling listeners consuming events forever.

## Acceptance Criteria

- [x] A component can publish a named event with a payload; `publish()` resolves once all
      matching handlers have settled (success or failure).
- [x] A component can subscribe to an exact event name and receive every event published
      under that exact name from the point of subscription onward.
- [x] A component can subscribe to a dot-delimited wildcard (`browser.*`) and receive every
      event whose name falls under that namespace.
- [x] If a subscriber's handler throws synchronously or returns a rejected promise, all other
      matching subscribers for that same event still receive it.
- [x] A handler failure triggers a follow-up `event.handler_failed` event carrying the
      original event name, the failing subscriber's identity, and the error.
- [x] Published event payloads are not mutable by subscribers in a way that leaks back to the
      publisher or to other subscribers (readonly typing + shallow freeze at publish time).
- [x] A subscription can be explicitly cancelled via an unsubscribe call.
- [x] No consumer/producer component is required to exist yet — the bus is fully testable in
      isolation with synthetic publish/subscribe calls.

## Rollout and Risk

- **Migration risk**: None — this is a brand-new package (`packages/event-bus`) with nothing
  existing to migrate.
- **Compatibility risk**: None yet, since no other component currently depends on it. Risk
  grows once Session Manager, Capability Registry, and Plugin Manager (all listed in the
  Feature Backlog as depending on `event-bus`) start consuming it — a breaking change to the
  bus's public API after that point would ripple across all three.
- **Rollout strategy**: Ship as a standalone workspace package (`packages/event-bus`), fully
  tested in isolation, before any dependent feature starts consuming it — matching the
  Feature Backlog's Tier 1 ordering.

## Out of Scope

| Item | Reason deferred |
|---|---|
| Cross-process / distributed delivery | Not needed until a multi-process or multi-Gateway deployment model exists; premature to design now |
| Event persistence / replay / event sourcing | No current feature needs historical event replay; add only if a real consumer needs it |
| Automatic retry of failed handlers | Adds real complexity (backoff, idempotency concerns) for a need nobody has stated yet |
| Global cross-event-name ordering guarantees | Not required by any known consumer; only same-event-name ordering is guaranteed |

## Further Notes

- Full grilling record and the one ADR it produced live in `docs/adr/0001-custom-event-bus.md`
  — custom bus instead of Node's built-in `EventEmitter`, for handler isolation and wildcard
  support.
- `docs/CONTEXT.md` already defines Event / Event Bus at the glossary level; no changes were
  needed there during grilling — the terms were already precise going in.
- Per `docs/Feature_Backlog.md` Tier 1, this feature has no dependencies and is first in the
  build order; `capability-registry`, `session-manager`, and `plugin-manager` all depend on
  it.
