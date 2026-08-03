# W3 — Subscription model: topic strings, prefixes, lifecycle?

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (2026-08-03 — all four sub-questions locked autonomously under user delegation; see "Sub-Qs 2–5 locked" below)
**Blocked by:** W1 (scope) — closed; W2 (auth handshake) — closed
**Blocks:** W4 (wire message schema) — resolved

## Question

How does a client express "give me these events," and how does the server honor
that? The shape question — top-level message vs handshake vs separate channel —
was punted from W1; this ticket decides the topic vocabulary and subscription
lifecycle once that's settled.

## What I know

- `event-bus.subscribe(topic, handler)` accepts dot-namespaced topics
  (`browser.page.loaded`, `session.destroyed`, etc.) and prefix wildcards via
  `packages/event-bus/src/match.ts`. The bus has no native "list my
  subscriptions" or "persistent cursor" concept.
- All event publishers in the codebase emit through `event-bus.publish(...)` —
  so the WS adapter's job is to bridge `event-bus` → subscribed sockets without
  becoming a parallel pub/sub.
- Subscription lifecycles:
  - Per-connection: subs live as long as the socket is open.
  - Per-handshake: subs declared in the auth frame; can't be changed.
  - Top-level: client sends `subscribe` / `unsubscribe` messages at any time.
- The user's session-id (`sessionId` in MCP's `_meta`) is what scopes which events
  a client is allowed to see — e.g. a session-scoped browser tab shouldn't see
  events from other tabs. (See how `sdk-browser` already filters by tabId in
  its connection key; backend-runtime's event fan-out does the same.)

## Sub-questions

1. **Subscription message shape:** is `subscribe` a single message with a topic
   list, or a per-topic message? Suspected: single message with a topic list
   (`{type:"subscribe", topics:["browser.*", "session.destroyed"]}`), with
   `unsubscribe` mirroring.
2. **Topic vocabulary:** use `event-bus`'s dot-namespaced topics verbatim, or
   expose a smaller, curated vocabulary (e.g. only `session.*` and `browser.*`)?
   Curated is safer; verbatim is more powerful. Pick one.
3. **Wildcards:** do clients get prefix wildcards (`browser.*`) or exact-match
   only? `event-bus` supports prefixes; exposing them to clients widens the
   surface. Pick one.
4. **Session scoping:** when a client subscribes to `browser.*`, do they see
   events from all sessions or only their own session (the one in the auth
   frame)? Suspected: only their own, by default — matches existing session
   isolation in backend-runtime.
5. **Subscription lifecycle:** is `subscribe` idempotent? Does `unsubscribe` of a
   topic never subscribed to error? Does the server prune subs on
   `socket.close`? (Default: yes, yes, yes.)

## Resolution must record

- the subscribe/unsubscribe message shapes;
- topic vocabulary (curated vs verbatim);
- wildcard policy;
- session-scoping default;
- subscription lifecycle guarantees.

## Progress

**2026-08-03 — Claimed + pre-grill review (this session).** W1 (scope) and
W2 (auth handshake) both closed → W3 unblocked. W5 research (fan-out shape)
closed and grounds this ticket.

**Sub-Q 1 resolved by reference — W1 sub-Q 3 already locked the message
shape.** Top-level message with a topic list: `{type:"subscribe",
 topics:[...]}` / `{type:"unsubscribe", topics:[...]}`, dynamic over the
life of one socket (add/drop topics without reconnecting). Per-topic
messages ruled out (W1 sub-Q 3 lock, CONTEXT.md 2026-08-03 entry). No
re-grill.

Real production event vocabulary enumerated 2026-08-03 (grounds sub-Q 2):
- `sdk.connection.accepted`, `sdk.connection.closed` —
  `packages/backend-runtime/src/events.ts:19,26`
- `capability.registered`, `capability.updated`, `capability.removed` —
  `packages/capability-registry/src/index.ts:74-108`
- `gateway.invocation` — `packages/gateway-core/src/handle-invocation.ts:351,376,405`
- `session.created`, `session.suspended`, `session.resumed`,
  `session.destroyed`, `session.cleanup_resources` — canonical session
  lifecycle per CONTEXT.md; consumed by
  `packages/browser-runtime/src/lifecycle.ts:42-54`
- Reserved: `event.*` — event-bus internal namespace, MUST NOT be relayed
  (W5 caveat; `packages/event-bus/src/__tests__/createEventBus.phase2.test.ts:129`)

W5 grounding for the remaining sub-questions:
- event-bus topic grammar: dot-namespaced, `*` final-segment only, bare `*`
  matches everything (`packages/event-bus/src/match.ts:5-8,24-30`)
- `validatePattern` (`packages/event-bus/src/match.ts:67-92`) is reusable
  for client-side topic validation — client-side errors mirror
  server-side grammar
- fan-out shape = per-(connection × topic) `bus.subscribe` + per-connection
  outbound queue (W5 Q1/Q2); unsubscribe idempotent (W5 Q3);
  snapshot-then-unsubscribe on socket close (W5)

**2026-08-03 — Sub-Qs 2–5 locked (autonomous under user delegation).**
User granted full decision authority 2026-08-03 ("I just give you the full
access to make the decisions for the websocket adapter feature ... make sure
that you check it and align it with what we already had so we don't run into
confliction"). All decisions below verified against PHILOSOPHY.md + shipped
code before locking.

## Sub-Q 2 (locked) — Topic vocabulary: VERBATIM event-bus topics. No curated list.

Clients subscribe to the exact dot-namespaced topics the event-bus publishes
(`session.*`, `capability.*`, `gateway.invocation`, `sdk.connection.*`, …).
No second vocabulary, no rename table, no public-vs-internal split.

Why:
- PHILOSOPHY: nothing-is-special, tiny kernel, complexity-at-the-edge,
  interfaces-forever. A curated vocabulary is a translation layer that must
  be maintained forever — every new event requires an adapter update and a
  client contract change. Verbatim = zero maintenance, zero divergence.
- W5 already locked `validatePattern` reuse for client-side topic validation.
  That only works if the client-facing vocabulary IS the bus vocabulary.
- The dashboard (the only v1 consumer) needs `session.*` + `capability.*` +
  `gateway.invocation` — all verbatim topics. No curation need demonstrated.
- "Curated is safer" is false safety: the security gate is the per-subscribe
  scope check (sub-Q 3 lock), not vocabulary secrecy.
- Reserved namespace: `event.*` is NOT subscribable — rejected at subscribe
  time (`subscribe.error` code `WS_INVALID_TOPIC`, W5) AND filtered at the
  fan-out boundary as defense-in-depth (bare-`*` matches would otherwise
  carry internal events).

## Sub-Q 3 (locked) — Wildcards: prefix wildcards verbatim, event-bus grammar.

`*` allowed as the final segment only (`session.*`); bare `*` matches
everything; no embedded `*`, no regex. Client-side validation reuses
`validatePattern` (W5 lock) — malformed patterns rejected with
`subscribe.error {code:"WS_INVALID_TOPIC", topics:[...]}`.

Authorization — per-PATTERN at subscribe time, NOT per-event:
- Required permission is DERIVED, not a table: `platform.<firstSegment>.read`
  (e.g. `session.*` → `platform.session.read`; `capability.*` →
  `platform.capability.read`; `sdk.connection.*` → `platform.sdk.read`).
  Bare `*` → `platform.*.read` (only a `platform.*.read` or `*` token covers
  it — effectively operator-grade, correct default).
- Checked via the same `checkAuthz(granted, required)` semantics as
  capability invocations (W2 sub-Q 1 cross-ticket).
- Uniform rule = no mapping table = new event namespaces work without adapter
  changes (evolution-over-perfection; nothing-is-special).
- Why per-pattern, not per-event: the permission vocabulary is namespace-
  granular (`platform.<domain>.<tier>`) — an event name carries no extra
  permission. Per-event checks would be pure overhead (complexity in the
  kernel; delay-complexity).
- Wildcards do NOT widen the security surface: the pattern's first segment
  is what's checked, so `session.*` can only ever deliver session events.

## Sub-Q 4 (locked) — Session scoping: NONE in v1. Tenant boundary = process boundary.

REVISION of the ticket's suspicion ("only their own session by default").
Locked: the adapter does NOT scope event delivery by session. Any client
whose scope covers the topic pattern receives the events.

Why (checked against code before deciding):
- The auth frame has NO sessionId claim. Claims are `{sub:{tenantId,
  callerId}, scope, expectedOrigins, expiresAt}` (W2 sub-Q 1 lock) — "the
  session in the auth frame" does not exist, so there is nothing to scope to.
- session-manager events carry NO tenantId either (verified payloads:
  `session.created` = {sessionId, ownerId, adapterType, createdAt}, and the
  session store is not tenant-keyed — `create({ownerId, adapterType})` only).
  Tenant isolation is by PROCESS: the bus is in-process, one gateway per
  deployment, so the adapter only ever sees its own tenant's events.
- The dashboard (v1 consumer, `platform.*.read`) needs ALL sessions' events
  — its Sessions view is a tenant-wide operator view (matches `session.list`
  semantics "in the caller's tenant"). Session-scoping would break its
  primary use case.
- sdk-browser's per-tab isolation is backend-runtime's job
  (`capsByConnection` keyed by appId:tabId, D-43), NOT the WS adapter's.
  The adapter is a new door for new clients; no session-scoped consumer
  exists in v1 (delay-complexity).
- Clients needing their own session's events can filter client-side
  (payloads carry `sessionId` where relevant).

## Sub-Q 5 (locked) — Subscription lifecycle: idempotent both ways, prune on close.

1. `subscribe` IS idempotent. Duplicate topics within a frame or across
   frames are deduped per connection (Set semantics at the per-connection
   registry). Re-subscribing an active topic → `subscribe.ok` anyway
   (idempotent success — drop-don't-punish, mirrors W2 sub-Q 2 pre-auth
   drop rule). No double bus.subscribe.
2. `unsubscribe` of a never-subscribed topic → `unsubscribe.ok` anyway,
   NO error. REVISION of the ticket's suspected default ("errors? yes").
   Why: the bus's unsubscribe is already idempotent (W5); erroring punishes
   clients for benign state divergence (reconnect races, client
   bookkeeping); drop-don't-punish.
3. `socket.close` prunes ALL subscriptions for that connection:
   snapshot-then-unsubscribe (W5 lock), clear the per-connection outbound
   queue, remove from the registry. Server does not remember subs across
   reconnect (client re-subscribes; refresh exists precisely to avoid the
   resubscribe race — W2 sub-Q 3).
4. Refresh (forwarded from W2 sub-Q 3 "operator's call — forward to W3"):
   existing subscriptions are NOT re-authorized on refresh and NOT pruned
   by a narrowing scope. Authorization is point-in-time (checked when the
   `subscribe` frame is processed, against the scope at that moment) —
   consistent with W2 sub-Q 3's locked semantics ("subsequent subscribe/
   invoke checks use the new permissions" = new subscriptions only).
   If the operator wants to revoke delivery after a narrowing refresh, they
   send an explicit `unsubscribe` frame. Residual risk (stale subs flowing
   until operator acts) is documented and accepted — the refresh path is
   rare and operator-driven (delay-complexity + reversible: the operator
   can always unsubscribe).
5. No per-connection subscription-count cap in v1. Topics are cheap
   (per-(connection × topic) bus.subscribe is a Map entry); add caps only
   if abuse shows up (delay-complexity).

Cross-ticket notes for W4 (wire schema):
- New frames: `subscribe.ok` / `subscribe.error` / `unsubscribe.ok` (echo
  the affected topics list).
- `subscribe.error` codes: `WS_INVALID_TOPIC` (malformed pattern, W5) +
  `WS_FORBIDDEN` (scope denial — proposal, W4 finalizes the code vocabulary).

Source: user delegation 2026-08-03; W5 resolution; event-bus `match.ts`
grammar + `validatePattern`; authz.ts `checkAuthz`; session-manager
payloads; W2 sub-Q 1/3 locks.