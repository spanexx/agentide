# TRD: Event Bus

## Status

- Type: Technical requirements document
- Audience: Backend, QA
- Scope: First workspace package that provides in-process event publish/subscribe for platform components.
- Status: Approved 2026-07-26. Implemented as `@platform/event-bus`. See [packages/event-bus/src/index.ts](../../../packages/event-bus/src/index.ts) for the implementation; design shape from § 2.1 matches the shipped `dispatchToSnapshot` helper.
- PRD: [PRD-event-bus.md](./PRD-event-bus.md)

## 1. Current Baseline

What already exists that this feature builds on or must not break.

### 1.1 Data model

- No runtime data model exists yet. The repo contains only root TypeScript
  workspace configuration in `package.json`, `tsconfig.base.json`, and
  `tsconfig.json`.
- `tsconfig.base.json` sets strict TypeScript, declaration output, and
  composite builds. Any new package must fit that build model.
- `tsconfig.json` has no package references yet, which confirms Event Bus
  becomes the first referenced workspace package.

### 1.2 API surface

- There is no current platform API, RPC surface, or package export for event
  publishing or subscription.
- `README.md` states `packages/` is populated feature-by-feature and that
  `event-bus` is the first planned package.

### 1.3 Frontend surface

- No frontend application or UI package exists in this repository.
- No browser-facing code depends on Event Bus behavior yet.

### 1.4 What is missing

- No package under `packages/` implements publish/subscribe.
- No typed event contract exists for platform modules.
- No wildcard matcher exists for dotted event names.
- No unsubscribe lifecycle exists for future Session-owned subscriptions.
- No failure surfacing exists for handler throws or rejected async handlers.

## 2. Target Architecture

Describe the system after this feature is shipped.

### 2.1 Architecture overview

The shipped system adds one small package, `@platform/event-bus`, under
`packages/event-bus`. The package exposes one public Event Bus interface and
keeps pattern matching and failure handling behind that interface so future
platform modules do not need to know how subscription storage works.

```mermaid
flowchart LR
    Publisher[Platform component<br/>Gateway / Runtime / Plugin]
    Bus[@platform/event-bus]
    HandlerA[Specific subscriber]
    HandlerB[Wildcard subscriber]
    Failure[event.handler_failed]

    Publisher -->|publish(name, payload)| Bus
    Bus -->|invoke in subscription order| HandlerA
    Bus -->|invoke in subscription order| HandlerB
    HandlerA -. throw / reject .-> Failure
    Failure -->|internal publish| Bus
```

Design shape:

- One package, no external runtime dependency.
- One public seam: publish, subscribe, unsubscribe.
- One internal matcher for exact names, `*`, and `**`.
- One internal failure path that publishes `event.handler_failed`.
- No persistence, transport, or framework tie-in.

### 2.2 New or changed data models

New package-level models:

- `EventPayload`
  - Type: generic object or primitive payload supplied by publisher
  - Cardinality: one payload per published event
  - Required: yes
  - Index requirements: none
- `PublishedEvent<TPayload>`
  - Fields:
    - `name: string`
    - `payload: Readonly<TPayload>`
  - Cardinality: one per dispatch
  - Required: both fields required
  - Index requirements: none
- `Subscription`
  - Fields:
    - `pattern: string`
    - `handler: EventHandler`
    - `order: number`
  - Cardinality: one bus instance to many subscriptions
  - Required: all fields required
  - Index requirements: preserve insertion order; no external index
- `HandlerFailureEvent`
  - Fields:
    - `event: PublishedEvent<unknown>`
    - `handlerIndex: number`
    - `error: unknown`
  - Cardinality: one emitted event per failed handler
  - Required: all fields required
  - Index requirements: none

### 2.3 API contracts

Public package contract:

- Factory or constructor
  - Function signature: `createEventBus(): EventBus`
  - Request shape: none
  - Response shape: new isolated bus instance
  - Error cases: none expected
  - Auth requirements: none

- Subscribe
  - Function signature:
    `subscribe(pattern: string, handler: EventHandler): () => void`
  - Request shape:
    - `pattern`: exact name, `<prefix>.*`, or `**`
    - `handler`: sync or async function receiving published event
  - Response shape: unsubscribe function
  - Error cases:
    - invalid wildcard grammar
    - reserved `event.*` publish attempts are handled on publish, not subscribe
  - Auth requirements: none

- Publish
  - Function signature:
    `publish<TPayload>(name: string, payload: TPayload): Promise<void>`
  - Request shape:
    - `name`: dotted event name
    - `payload`: shallow-freezable value
  - Response shape: resolved promise after all handlers settle
  - Error cases:
    - invalid event name grammar
    - attempt to publish into reserved `event.*` namespace by external caller
  - Auth requirements: none

Behavioral contract:

- Exact-name subscribers match exact event names only.
- `*` matches exactly one dotted segment after the prefix.
- `**` matches any event name at any depth.
- Handlers are invoked in registration order.
- Async handlers start when reached in that order; completion order is ignored.
- One failing handler never stops later handlers.
- Failures surface as one internal `event.handler_failed` publish per failure.
- Unsubscribing during a dispatch does not alter the in-flight subscriber list.

### 2.4 Frontend changes

- No frontend changes in this feature.
- No new UI components, service calls, or browser state.
- Future consumers (Dashboard, Browser Runtime, SDK Browser) only depend on the
  package's public interface after this feature ships.

## 3. Dependency Analysis

This feature introduces **no external runtime dependency** and upgrades no
existing package. The implementation uses:

- built-in JavaScript/TypeScript language features
- existing repo dev tooling already pinned at the workspace root

`opensrc` gate was checked for this phase. Result: no package fetch was needed
because Event Bus adds no external runtime dependency, so there is no third-
party package whose source must be inspected before implementation.

**Summary table**:

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| None | n/a | Event Bus uses language/runtime features only | `opensrc` review concluded there is no external package to inspect; built-in language/runtime features are enough for publish/subscribe, wildcard matching, shallow freeze, and promise settling | `eventemitter3`, Node `EventEmitter`, distributed brokers rejected because v1 requires custom semantics and zero external runtime dependency |

## 4. Migration Strategy

How does the system move from the current baseline to the target state safely?

### 4.1 Additive phase

- Create `packages/event-bus` as the first workspace package.
- Add package-local `package.json`, `tsconfig.json`, source files, and tests.
- Add a root TypeScript project reference to the new package.
- Keep all behavior additive: no existing package or API is replaced because
  none exists yet.

### 4.2 Migration / transition phase

- No schema migration.
- No interface replacement.
- No compatibility bridge needed between old and new behavior because Event Bus
  is the first implementation of this capability.

### 4.3 Compatibility rails

- Reserve `event.*` for internal emissions from day one so later packages do not
  build on a namespace we need to reclaim.
- Keep wildcard grammar narrow now (`*`, `**`) so later components rely on one
  stable rule set.

### 4.4 Rollback plan

- Remove the new package and the root project reference.
- Re-run build, lint, and test to confirm the repository returns to the
  "no packages" baseline.
- Because no existing feature depends on Event Bus yet, rollback is deletion
  only and does not require data cleanup.

## 5. Open Questions

- [x] None. PRD grilling resolved wildcard grammar, failure payload shape,
      mixed sync/async dispatch order, and `event.*` namespace ownership.

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| Deep recursive immutability | PRD only requires shallow freeze; deep freeze adds cost and surprising behavior for nested objects | Revisit if a real consumer needs nested mutation protection |
| Subscription identifiers | Current failure payload can use handler index; stable ids are extra surface with no v1 caller | Revisit if observability tooling needs durable subscription references |
| Cross-process forwarding | Explicit PRD non-goal; would change ordering guarantees and transport model | Revisit only if platform architecture becomes multi-process |
