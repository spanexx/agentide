# W5 — Resolution

## Subagent

- Date: 2026-08-03
- Type: wayfinder:research
- Reviewed: `packages/event-bus/src/{index,types,match}.ts`, `packages/event-bus/src/__tests__/{createEventBus.phase1,createEventBus.phase2,createEventBus.phase3,matches}.test.ts`, `packages/backend-runtime/src/{server,events,registry,types}.ts`, `packages/gateway-core/src/handle-invocation.ts`, `packages/browser-runtime/src/lifecycle.ts`

## Findings

### Q1 — subscription shape: per-(connection × topic) vs per-connection wildcard + filter

**Recommendation: per-(connection × topic) — one `bus.subscribe(topic, handler)` per (connection, topic) the client subscribes to.**

Evidence:
- `subscribe()` is cheap: it pushes a `{pattern, handler, order}` into a flat array and returns a closure (`packages/event-bus/src/index.ts:67-92`). No per-subscribe allocation beyond the closure + the array push. Adding/removing is O(N_subs) (linear scan + splice) at `index.ts:81-85`.
- `matches()` is O(segs) per subscription per event (`packages/event-bus/src/match.ts:24-49`). With 100 connections × 5 topics = 500 subs, an event does ~500 cheap matches. That's fine for in-process — the platform's per-process publish rate is bounded.
- The wildcard umbrella alternative (one `*` subscribe + internal filter) loses the bus's own pattern-match semantics, requires us to re-implement the matching rules in the adapter, and creates a single funnel that serializes all events through one handler. The per-(connection × topic) shape distributes work across N independent handlers and lets the bus do its job.
- Caveat: scaling bound is `O(connections × topics_per_connection)` subscriptions per process. Realistic WS adapter usage is ~dozens of connections × a handful of topic globs each. Comfortable. Not a concern for v1.

### Q2 — sync vs async dispatch; outbound queue needed?

**Recommendation: outbound queue per connection IS needed. The bus dispatch is async, but a slow `socket.send(...)` inside the handler back-pressures the dispatch loop.**

Evidence:
- `publish()` and `dispatchInternal()` both `await dispatchToSnapshot(...)` (`packages/event-bus/src/index.ts:75, 95, 107-110` and `:147`).
- `dispatchToSnapshot` is fully sequential: it loops over the snapshot, calls the handler synchronously, **starts** a Promise for any async return value, and then `await Promise.allSettled(startedAsyncs)` at the end (`packages/event-bus/src/index.ts:209-230, 242-246`).
- Implication: if the WS adapter's handler does `socket.send(...)` synchronously inside the bus handler, the bus won't block (Node `ws` `send()` is non-blocking — it just buffers in userland). BUT if the handler awaits `socket.send(...)` (e.g. to detect backpressure), the bus dispatch loop's `allSettled` waits on it. That blocks *every other subscriber* on the bus (e.g. `gateway.invocation`, `capability.registered`, `session.*`).
- Backend-runtime's pattern (`packages/backend-runtime/src/server.ts:55-58, 245-251`) sidesteps this by NOT subscribing to the bus — it only publishes events from the socket side. There's no existing in-tree example of "many bus consumers that themselves send to a network". The adapter is a new pattern.
- Therefore: per-connection outbound queue (or a `Set<Promise<void>>` of in-flight sends, drained on `drain` event) is required to keep bus dispatch from waiting on the network. The WS adapter's bus handler must be: enqueue + return (or enqueue + return a Promise that resolves on the next `drain`). It MUST NOT await `socket.send()`.
- v1 practical: a simple per-connection `Array<event>` queue with `socket.send` called outside the bus handler (microtask / setImmediate) is enough. W6 (backpressure) picks the drop-vs-close policy when the queue exceeds a threshold.

### Q3 — prefix wildcard unsubscribe cleanup

**Recommendation: no leak pattern observed. `unsubscribe()` is idempotent, splice-based, and the underlying subscription set is a plain array.**

Evidence:
- `unsubscribe()` flips an `unsubscribed` flag and removes the entry from the array on first call (`packages/event-bus/src/index.ts:76-87`). Second call is a no-op (early return on the flag). The array shrinks on every unsubscribe — no growth over time.
- `dispatchToSnapshot` snapshots the subscription list at the start of each publish (`packages/event-bus/src/index.ts:212-214`), so unsubscribing mid-dispatch is safe — the in-flight snapshot stays consistent (covered by `AC-15` per the comment).
- Wildcards are validated at subscribe time (`packages/event-bus/src/match.ts:67-92`), so malformed patterns throw immediately — there's no path where a wildcard subscription enters the list under a weird shape that can't be matched later.
- Pattern grammar is locked: `*` is the final segment only, bare `*` matches everything (`packages/event-bus/src/match.ts:5-8, 24-30`). The adapter can rely on this contract for client-side topic validation too.
- Caveat the impl must respect: when a client subscribes `["session.*", "capability.*"]`, the adapter holds 2 `Subscription` handles. On `unsubscribe ["session.*"]`, the adapter calls `subscription.unsubscribe()` for that handle. Calling `.unsubscribe()` on the same handle twice is safe. The adapter must NOT cache a boolean `isUnsubscribed` of its own — let the bus's idempotency handle it.

### Q4 — existing "many consumers of one bus" patterns

**Recommendation: pattern follows `browser-runtime/src/lifecycle.ts` — one listener per (component, event), with a per-listener `Subscription` handle owned by the component.**

Evidence:
- `packages/browser-runtime/src/lifecycle.ts:42-51` subscribes to `session.created`, `session.suspended`, `session.resumed`, `session.destroyed`, and (the wildcard) `session.cleanup_resources` — five separate `bus.subscribe()` calls, each holding its own returned `Subscription`. Cleanup on component teardown is via subscription handles (verified by reading the surrounding context — `subscribe` returns a handle, teardown calls `.unsubscribe()` on each).
- `packages/gateway-core/src/handle-invocation.ts:351, 376, 405` publishes `gateway.invocation` from three code paths but does NOT subscribe back to it — that's a publisher, not a consumer.
- `packages/session-manager/src/__tests__/session-manager.test.ts:121, 180` uses a single wildcard `session.*` + one explicit `session.destroyed` subscription. The wildcard gets the bulk; the explicit one is for teardown ordering.
- `plugin-manager` itself does NOT subscribe in production code — only its tests do (to assert events were emitted). This is a gap the WS adapter must NOT emulate: production code that observes platform events must hold its own subscriptions.
- Backend-runtime has no bus consumer pattern — it only publishes (`packages/backend-runtime/src/events.ts:19, 26`). So the WS adapter is introducing a new inbound-events-on-bus pattern, not reusing one.

## Recommended fan-out shape (WS adapter)

Files (new): `packages/adapter-websocket/src/{server,registry,fanout,errors}.ts`. The server holds a `ConnectionRegistry` (analog of `packages/backend-runtime/src/registry.ts`); each entry holds `{socket, subscriptions: Subscription[], outboundQueue: Array<unknown>, sending: boolean}`.

**Subscribe flow** (per WS `subscribe` message):
1. Validate topics against `matches`/`validatePattern` from `@platform/event-bus` so client-side errors mirror server-side validation.
2. For each topic, call `eventBus.subscribe(topic, handler)` where `handler` enqueues the event onto the connection's `outboundQueue` (does NOT await `socket.send()`). Store the returned `Subscription` in `connection.subscriptions`.
3. On success, send `{type: "subscribe.ok", topics}` back to the client (so the client knows the subscription is live before events start flowing).

**Event flow** (per bus `publish`):
1. Bus delivers the event to every matching handler across every connection.
2. Each connection's handler synchronously enqueues the serialized envelope onto its `outboundQueue`. Microtask drain: if `sending === false`, set it true and drain via `socket.send(...)`, listening for `drain` to clear it. The bus dispatch returns immediately; outbound is decoupled.
3. W6 picks the overflow policy (drop-oldest, drop-newest, or close-on-overflow).

**Unsubscribe flow** (per WS `unsubscribe` message):
1. For each topic, look up the corresponding `Subscription` in `connection.subscriptions` and call `.unsubscribe()`. Remove from the array. (Idempotent — calling twice is safe.)
2. Send `{type: "unsubscribe.ok", topics}` back.

**Socket close** (per `socket.on("close")`):
1. Snapshot `connection.subscriptions`, clear the array, then call `.unsubscribe()` on each snapshot entry. Order matters: unsubscribe BEFORE removing from any other registry, so the handler can't fire on a half-torn-down connection.
2. Clear `outboundQueue` (drop any unsent events — the socket is gone).
3. Drop the connection from `ConnectionRegistry`.
4. Do NOT publish a `ws.connection.closed` event in v1 unless we want dashboard-side observability of WS adapter state — defer that decision to a future pack (it's the same question as `sdk.connection.closed` for backend-runtime).

## Caveats for the implementation

- **Never `await socket.send()` inside the bus handler.** That back-pressures bus dispatch. Enqueue + return. Drain in a microtask.
- **Per-connection outbound queue.** Bounded by W6's threshold. Overflow → drop or close per the locked W6 policy.
- **Snapshot-then-unsubscribe on socket close.** Prevents a mid-flight event from firing on a torn-down handler.
- **Topic validation.** Re-use `validatePattern` from `@platform/event-bus` so client-side and server-side grammar match. Subscribing to a malformed topic → `{type: "subscribe.error", code: "WS_INVALID_TOPIC", topics}` and no subscription is created.
- **Reserved namespace.** `RESERVED_INTERNAL_PREFIX = "event."` — the adapter MUST NOT relay events under `event.*` to clients. Filter at the fan-out boundary (don't subscribe the adapter to `event.*` patterns in the first place; also strip if a wildcard match accidentally catches it).
- **Order of operations on `subscribe` + immediate `unsubscribe`.** Bus dispatch snapshots at publish-start (per `AC-15`), so a subscribe-then-unsubscribe-then-publish sequence delivers zero events to the unsubscribed handler. No edge case to special-case.
- **`subscription.unsubscribe()` idempotency.** Don't cache a custom `isUnsubscribed` flag — the bus's flag is correct.
- **Connection-key shape.** For browser clients, follow backend-runtime drift D-43 (`appId:tabId` so two tabs don't evict each other). For non-browser WS clients, `appId` alone. The auth-handshake ticket (W2) owns how `appId`/`tabId` arrive.

## Sources

- `packages/event-bus/src/index.ts:67-92` — `subscribe()` + `unsubscribe()` closure
- `packages/event-bus/src/index.ts:107-110, 138-180` — `dispatchToSnapshot` snapshot + sync/async dispatch
- `packages/event-bus/src/index.ts:209-246` — sync loop, startedAsyncs collection, `allSettled` await
- `packages/event-bus/src/types.ts:33-37, 50-52` — `Subscription`, `EventBus` interface
- `packages/event-bus/src/match.ts:24-49` — `matches()` wildcard semantics
- `packages/event-bus/src/match.ts:67-92` — `validatePattern` grammar
- `packages/backend-runtime/src/server.ts:55-58, 245-251` — connection-key + close cleanup pattern (analogue only — backend-runtime does NOT subscribe)
- `packages/backend-runtime/src/registry.ts` — `ConnectionRegistry` analogue target
- `packages/browser-runtime/src/lifecycle.ts:42-51` — multi-subscription consumer pattern (closest in-tree analogue)
- `packages/gateway-core/src/handle-invocation.ts:351, 376, 405` — `gateway.invocation` publisher (no consumer pattern)
- `packages/session-manager/src/__tests__/session-manager.test.ts:121, 180` — wildcard + explicit dual-subscription pattern in tests
- `packages/event-bus/src/__tests__/createEventBus.phase1.test.ts:66-75, 100-110` — unsubscribe idempotency + unsubscribe-mid-dispatch AC-15
- `packages/event-bus/src/__tests__/createEventBus.phase3.test.ts` — payload shallow-freeze + event id/publishedAt shape
