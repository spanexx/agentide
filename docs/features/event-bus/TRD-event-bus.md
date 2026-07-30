# TRD: Event Bus

## Status

- Type: Technical requirements document
- Audience: Backend, frontend, QA
- Scope: In-process, typed publish/subscribe event delivery mechanism for the platform's
  Control Plane and Execution Plane components — no consumers required yet.
- PRD: [PRD-event-bus.md](./PRD-event-bus.md)

## 1. Current Baseline

### 1.1 Data model

None. `packages/` is empty — this is the first package in the monorepo.

### 1.2 API surface

None. No existing publish/subscribe mechanism of any kind exists in the codebase.

### 1.3 Frontend surface

Not applicable. Event Bus is a Node-side Control Plane package with no frontend surface —
Frontend SDK (`@platform/sdk-browser`, a later feature) will eventually communicate with the
platform over the Gateway, not by importing this package directly.

### 1.4 What is missing

Everything: there is currently no way for any two platform components to communicate without
a direct, hard-coded reference to each other. This feature is the first piece of Control
Plane infrastructure.

## 2. Target Architecture

### 2.1 Architecture overview

A single package, `@platform/event-bus`, exporting one concrete `EventBus` implementation
and its supporting types. It has no dependencies on any other platform package (deliberately
— Session Manager, Capability Registry, and Plugin Manager will depend on it, not the other
way around, matching the Feature Backlog's Tier 1 ordering).

```
publisher                     EventBus                      subscriber(s)
    │                             │                                │
    │  publish(name, payload)    │                                │
    ├────────────────────────────►                                │
    │                             │  match name against            │
    │                             │  registered patterns           │
    │                             │  (exact + wildcard)             │
    │                             ├───────────────────────────────►│ handler(event)
    │                             │                                │
    │                             │◄─── handler throws/rejects ────┤
    │                             │  caught, does NOT propagate    │
    │                             │  publishes event.handler_failed │
    │                             ├───────────────────────────────►│ (other subscribers,
    │                             │                                │  unaffected)
    │  publish() resolves after  │                                │
    │◄─── all handlers settled ──┤                                │
```

### 2.2 New or changed data models

**`PlatformEvent<TPayload>`** (1 per publish call)
- `name: string` — dot-delimited event name, e.g. `session.created`
- `payload: TPayload` — the event's data, shallow-frozen before delivery
- `id: string` — UUID, generated at publish time
- `publishedAt: number` — epoch milliseconds, generated at publish time
- All fields `readonly`

**`Subscription`** (1 per subscribe call)
- `unsubscribe(): void` — removes this subscription; idempotent (calling twice is a no-op)

**`EventHandler<TPayload>`** (function type, not a stored model)
- `(event: PlatformEvent<TPayload>) => void | Promise<void>`

**`HandlerFailedPayload`** (payload shape for the `event.handler_failed` system event)
- `eventName: string` — the original event's name
- `subscriberPattern: string` — the pattern the failing subscriber registered with
- `error: { message: string; stack?: string }` — normalized from whatever the handler threw
  or rejected with

No persistence — everything above is in-memory only, per the PRD's non-goals.

### 2.3 API contracts

Module-level contract (this is a library, not a network API — "route" below means exported
function/method signature):

**`EventBus.publish<TPayload>(name: string, payload: TPayload): Promise<void>`**
- Input: event name (any string; no enforced enum, since capability/event names are
  open-ended across the whole platform) and a payload of any shape.
- Behavior: constructs a `PlatformEvent`, shallow-freezes the payload, finds every
  subscription whose pattern matches `name`, and calls each handler. Resolves once every
  matched handler has either completed or had its failure caught and reported.
- Never rejects — per-handler failures are isolated and converted into a follow-up
  `event.handler_failed` publish, not propagated to the original caller.

**`EventBus.subscribe<TPayload>(pattern: string, handler: EventHandler<TPayload>): Subscription`**
- Input: either an exact event name (`session.created`) or a namespace wildcard ending in
  `*` (`browser.*`, `docker.*`).
- Wildcard matching rule: a pattern `a.b.*` matches any event name whose first two
  segments are exactly `a.b`, regardless of how many segments follow — chosen because real
  event names in the platform already go beyond two segments (e.g.
  `docker.container.started`, `browser.navigation.completed`, per Runtime Capabilities'
  examples), so a single-level-only wildcard would under-match. A bare `*` matches every
  event name, as an emergent property of the same rule (zero required prefix segments) —
  useful later for a Dashboard "show everything" debug view, though nothing in this PRD
  requires it.
- Returns a `Subscription` whose `unsubscribe()` removes it.

**Error cases:**
- A handler throwing synchronously, or its returned promise rejecting, is caught internally.
  It never surfaces to the publisher and never blocks other subscribers for the same event.
- A failure while handling `event.handler_failed` itself is caught and dropped (logged
  internally only, not re-published) — a deliberate guard against infinite recursion if a
  `event.handler_failed` subscriber is itself broken.

**Auth requirements:** none at this layer. The Event Bus has no concept of identity or
permissions — per the platform's ownership model, permission enforcement belongs to the
Gateway (Control Plane), not to this internal delivery mechanism. Any future need to restrict
who can publish/subscribe to what would be enforced by whatever calls into this module, not
by the module itself.

### 2.4 Frontend changes

Not applicable — no frontend surface for this feature (see 1.3).

## 3. Dependency Analysis

No new external dependencies are introduced by this feature. The implementation is fully
custom per `docs/adr/0001-custom-event-bus.md` — no pub/sub library (e.g. `eventemitter2`) is
used; wildcard matching is a small amount of in-house string-splitting logic, not worth an
external dependency for.

`opensrc` is therefore not applicable to this feature — there is nothing to inspect.

**Summary table**

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| *(none)* | — | — | — | Node's built-in `EventEmitter` — rejected; see ADR-0001 for the specific behaviors (no handler isolation, no wildcard support) that ruled it out |

## 4. Migration Strategy

### 4.1 Additive phase

Everything about this feature is additive — `packages/event-bus` is a brand-new package with
no existing code to touch.

### 4.2 Migration / transition phase

Not applicable. Nothing existing depends on any prior event mechanism, because none existed.

### 4.3 Compatibility rails

None needed yet, but worth flagging forward: once `capability-registry`, `session-manager`,
and `plugin-manager` (all Tier 1, all listed as depending on `event-bus` in the Feature
Backlog) start consuming this package's public API (`EventBus.publish` /
`EventBus.subscribe` / `Subscription.unsubscribe`), that API becomes a de facto compatibility
contract across all three. A breaking change to it after that point requires updating all
three dependents in the same change, not a rolling migration.

### 4.4 Rollback plan

Trivial at this stage: the package is stateless (in-memory only, nothing persisted), so
rollback is simply removing or reverting the package. No data migration risk exists because
nothing depends on it yet.

## 5. Open Questions

None. Every design question surfaced during grilling was resolved before this TRD was
written (see `docs/adr/0001-custom-event-bus.md` for the one decision that crossed the ADR
bar; the rest are captured directly in the PRD's Product Goals and this TRD's Section 2).

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| Cross-process / distributed delivery | No multi-process or multi-Gateway deployment model exists yet | When a distributed deployment model is designed |
| Event persistence / replay / event sourcing | No current feature needs historical event replay | When a feature needs event sourcing or audit replay (e.g. Dashboard event timeline with history) |
| Automatic retry of failed handlers | Adds real complexity (backoff, idempotency) for a need nobody has stated | If a real reliability requirement emerges — e.g. a subscriber that must never miss an event |
| Global cross-event-name ordering guarantees | Not required by any known consumer | If a future feature needs strict ordering across different event types, not just within one |
