# W5 — Server-side fan-out: bridge `event-bus` → subscribed sockets

**Type:** `wayfinder:research` (AFK)
**Status:** **closed** (resolution written 2026-08-03 — see `W5-resolution.md`)
**Resolved by:** `/research` subagent
**Parallel with:** W6 (backpressure); feeds W4 (wire schema)

## Question

What is the canonical shape of the bridge from `event-bus.subscribe(...)` to
WebSocket sends, and where does it live in the package layout? The bridge needs
to:

- subscribe to all relevant topics on behalf of a connected client;
- apply session scoping (per W3);
- serialize events to the wire envelope (per W4);
- respect backpressure (per W6);
- cleanly unsubscribe on socket close.

## What I know

- `@platform/event-bus` ships as `@platform/event-bus` (PHI-Backlog #1, shipped).
  `subscribe(topic, handler)` returns a `Subscription` handle; `unsubscribe()`
  cleans up.
- The adapter will hold N connections, each with its own `Subscription` set
  (one per topic the client subscribed to). A connection's `Subscription`s must
  all be released on socket close — otherwise the bus retains the handler and
  the GC can't free the connection state.
- Backend-runtime already fans out events to SDK connections per their owner
  (`backend-sdk-<key>`) — see `packages/backend-runtime/src/server.ts` and the
  `capsByConnection` map. That pattern is inbound-routing, not outbound-stream,
  but the *partition by key* idea is reusable.

## What the subagent should research

1. Whether `event-bus.subscribe(...)` returns handles that are cheap enough to
   hold per-(connection × topic) — i.e. can we have N connections × M topics =
   N×M live subscriptions, or do we need a single "all matching topics" subscription
   per connection with internal filtering?
2. Whether the bus dispatches synchronously or async — affects whether a slow
   socket's send() can block other consumers' deliveries. If sync, the WS adapter
   needs its own outbound queue per connection.
3. Whether unsubscribing from `prefix.*` cleans up the underlying wildcard match
   cleanly, or whether there's a known leak pattern. (`event-bus` v2 added
   normalized errors; want to make sure the Subscription lifecycle is tight.)
4. Existing patterns in the codebase for "many consumers of one bus" — e.g. how
   `plugin-manager` watches `plugin.*` events.

## Output

A short report with:
- recommended subscription shape (per-connection × per-topic, or per-connection
  wildcard with internal filter);
- whether outbound queueing is needed;
- the canonical `unsubscribe()` ordering on socket close;
- any caveats the implementation must respect.

## Progress

**2026-08-03 — Research resolved (this session).** Wrote `W5-resolution.md`:
- **Subscription shape:** per-(connection × topic). `subscribe()` is cheap
  (closure + array push, `index.ts:67-92`); matches() is O(segs); scaling
  comfortable for v1 realistic load.
- **Outbound queue:** REQUIRED. Bus dispatch awaits `Promise.allSettled`
  (`index.ts:242-246`); handler must never `await socket.send()` or it
  back-pressures the bus. Enqueue + microtask drain.
- **Unsubscribe cleanup:** no leak. `unsubscribe()` is idempotent
  (closure flag + splice), snapshots at publish-start cover AC-15.
- **Consumer pattern:** closest in-tree analogue is `browser-runtime/src/lifecycle.ts:42-51`
  (multiple `bus.subscribe()` per component, one `Subscription` handle each).
  Backend-runtime is publisher-only; plugin-manager is publisher-only.
- **WS adapter file layout (proposed):** `packages/adapter-websocket/src/{server,registry,fanout,errors}.ts`,
  ConnectionRegistry analogue of backend-runtime's, plus per-connection
  `subscriptions[]` + `outboundQueue` + `sending` flag.
- **Caveats:** reserved `event.*` namespace must not be relayed; never await
  socket.send in the bus handler; snapshot-then-unsubscribe on close; re-use
  `validatePattern` so client-side grammar matches server-side.

Source: `W5-resolution.md` (this directory). Feeds W4 wire-message schema.