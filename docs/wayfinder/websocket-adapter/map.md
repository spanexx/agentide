# websocket-adapter — Wayfinder map

> **Map title:** websocket-adapter — finding the way to a shipped `@platform/adapter-websocket`.
>
> **Status:** charting COMPLETE (2026-08-03). All seven tickets (W1–W6 + W5 research) closed;
> the full wire contract is locked. Next step: feature-pipeline delivery run
> (GRILL → PRD-TRD → IMPL → implement → post-impl sim), per the T7 (sdk-browser) precedent.
> Live tracker: this map + the closed tickets under `tickets/`.

## Destination

`@platform/adapter-websocket` shipped as the Agentide platform's **push** entry point.
A long-lived WebSocket connection on which:

- A subscribed client can **invoke** platform capabilities (mirroring `tools/call` for MCP)
- The platform can **push events** to the subscribed client, sourced from `event-bus`

That second half is what MCP can't do. The adapter is the seat of `delivery: small-change` if
the surface is narrow, `delivery: feature-pipeline` otherwise — tagged at ticket-resolution time,
not guessed up front.

## Notes

- **Domain:** AI agent platform. Today, an MCP-compatible agent (e.g. OpenCode) reaches the
  platform via `@platform/adapter-mcp` (`tools/call`, port 7100, request/response). The WebSocket
  adapter is the *push* sibling — same kernel, different transport.
- **Kernel surface reused (no work needed there):** `Gateway.handleInvocation()` is the canonical
  entry; `Adapter` interface in `packages/gateway-core/src/types.ts:168` (`name` + `start()` + `stop()`)
  is what the new adapter conforms to. `event-bus` (`@platform/event-bus`, shipped) is what feeds
  server-pushed messages; `Subscription` handles already exist (`packages/event-bus/src/types.ts`).
- **Sister packages (treat as reference, not source-of-truth-for-unimplemented):**
  - `@platform/adapter-mcp` — Streamable HTTP transport; the IMPL is the model for Phase
    layout (factory + start + stop + per-request auth via AsyncLocalStorage + error-map).
  - `@platform/backend-runtime` — already runs a Node `ws` server on `backendRuntimePort`,
    used by SDKs *outbound* to register handlers + receive invocations. The websocket-adapter
    is the *inverse* direction: client connects *inbound*, gateway streams events.
  - `@platform/sdk-node` / `@platform/sdk-browser` — both WebSocket *clients* outbound.
    Inverted shape from what we need here, but auth-handshake pattern (`sdk.auth` first message
    after `onopen`) is reusable as a model.
- **What the docs already say:** `Agentide.md` § 8 lists WebSocket Adapter under
  "Useful for streaming" — that's intent, not spec. PHI-Backlog Tier 3 says "CLI and
  WebSocket adapters slot in here too, same dependency — order between the four is mostly a
  priority call, not a technical blocker." So scope is open; we're locking it here.
- **Out of scope this map:** dashboard-core (#13), devtools-extension (#14),
  vscode-extension (#15), plugin-marketplace (#16), additional backend SDKs (#22). The
  adapter *enables* these by giving them a push channel; building them is a separate map.
- **Standing preferences:** Wayfinder default mode (plan, don't do). Self-hosted Gateway
  assumed for v1. JWT bearer auth (mirrors adapter-mcp). No subprotocol versioning in v1
  (path-versioned or query-versioned if needed).
- **Assumed already shipped:** `gateway-core`, `capability-registry`, `event-bus`,
  `session-manager`, `plugin-manager`, `platform-capabilities`, `permission-tiering`,
  `sdk-node`, `backend-runtime`, `gateway-plugin-dispatch`, `adapter-mcp`. Map invalidates
  if any of these reopens a settled question that affects the choice below.
- **Truthfulness:** if a ticket resolution contradicts another open ticket or a decision already
  settled, update *the map and the affected tickets*, not just the answer. Drift logs go in
  `docs/drift.md` per the project standard.
- **Standing grill rule:** every locked Q appends to `docs/CONTEXT.md` Decisions Log +
  posts a progress comment on the ticket.

## Tickets (all closed 2026-08-03)

| # | Ticket | Type | Closed |
|---|---|---|---|
| W1 | Adapter scope vs MCP: same `tools/call` shape, plus subscriptions? | `grilling` (HITL) | ✓ (incl. REOPEN: pull is v1) |
| W2 | Auth handshake: reuse MCP's bearer-token-in-first-message model? | `grilling` (HITL) | ✓ (4 sub-Qs locked) |
| W3 | Subscription model: topic strings, prefixes, lifecycle? | `grilling` (HITL) | ✓ (4 sub-Qs locked) |
| W4 | Wire message schema: JSON envelopes, error codes, heartbeat | `grilling` (HITL) | ✓ (6 sub-Qs locked) |
| W5 | Server-side fan-out: bridge `event-bus` → subscribed sockets | `research` (AFK) | ✓ |
| W6 | Backpressure / slow-consumer policy | `grilling` (HITL) | ✓ (5 sub-Qs locked) |

**Worked sequence:** W1 → W2 → W3 → (W5 parallel) → W6 → W4 → done.

## Decisions so far

- 2026-08-03 — W1 sub-Q 1 (grill) — WS adapter is **push-only in v1**: no
  `tools/call` pull over WS, no JSON-RPC envelope on the socket. MCP stays the pull
  door. Pull over WS is **demanded** for a future run (`future.md` in this dir) with
  un-grilled shape; triggers = WS-only deployment (no MCP) / single-socket
  pull+push clients. Accepted trade-off: v1 clients open two sockets for pull+push.
  **REVISED 2026-08-03 (same session, re-open): pull is now v1 with WS-native
  envelope. See REOPEN entry below.**
- 2026-08-03 — W1 sub-Q 1 REOPEN (grill, same session) — **WS adapter supports
  pull in v1 with a WS-native envelope.** Wire messages:
  `{type:"invoke", correlationId, name, input, sessionId?, mode:"call"|"stream"}` →
  `{type:"invoke.result", correlationId, output}` | `{type:"invoke.error", correlationId, code, message, details?}` |
  `{type:"invoke.partial", correlationId, output}` (stream mode) → `{type:"invoke.end", correlationId}`.
  Universal — every v1 client can use `invoke`, no scoped opt-in. Driver:
  `dashboard-core` BI[13] is a concrete v1 consumer needing `capability.list`/
  `plugin.list`/`session.list`/`system.health`/`gateway.metrics` over one socket.
  Cross-ticket impact: W4 must lock the five `invoke*` envelope variants +
  correlationId; W6 backpressure covers per-connection outbound queueing for both
  `event` and `invoke.partial`; W5 fan-out now also routes per-call partial-progress
  topics. `future.md` rewritten — pull is no longer future; remaining future items:
  kernel-level streaming seam, `invoke.batch`, subprotocol versioning, MCP-shape
  compat. Source: W1 ticket reopen lock; user wording "no i dont want scopped".
- 2026-08-03 — W1 sub-Q 2 (grill) — WS adapter **streams capability-handler progress
  in v1, adapter-level (Reading A)**: kernel `handleInvocation()` stays single-shot
  per gateway-core Q11; the adapter packages progress events into partial frames for
  `mode: "stream"` clients and one frame for `mode: "call"` clients. MCP stays
  single-shot. `future.md` records the kernel-level streaming seam as a future
  promotion path if a future run wants platform-native streaming.
- 2026-08-03 — W1 sub-Q 3 (grill) — **Subscription = top-level message on the
  socket**: `{type: "subscribe", topics: [...]}` / `{type: "unsubscribe", topics:
  [...]}`. Dynamic over the life of one socket (add/drop topics without
  reconnecting). Not inferred from auth handshake (would block dynamic ops); not a
  pre-handshake REST call (two protocols to coordinate, extra round-trip). Wire
  schema (W4) needs a `type` discriminator — already implied.
- 2026-08-03 — W1 sub-Q 4 (grill) — **WS envelope deliberately differs from MCP.**
  MCP = JSON-RPC request/response. WS = `{type, ...}` envelope with a `type`
  discriminator (subscribe, unsubscribe, event, auth, auth.ok, error, pong, ...).
  Different clients, different doors; same platform, two products. This locks W4 to
  NOT carry JSON-RPC — flat `{type, ...}` shape keyed by `type`.
- 2026-08-03 — W1 closed. v1 = push-only + adapter-level streaming + top-level
  subscribe messages + WS-native envelope. Pull demanded (`future.md`). Next: W2
  (auth handshake). **REVISED 2026-08-03 (same session): v1 = push + pull + adapter-level streaming + top-level subscribe + WS-native envelope (including `invoke*` variants). Pull is v1, not future. Next: W2 (auth handshake).**
- 2026-08-03 — W5 closed (research). Fan-out shape: per-(connection × topic)
  `bus.subscribe()`; outbound queue per connection is REQUIRED (bus dispatch
  awaits `Promise.allSettled`, awaiting `socket.send()` would back-pressure
  the bus); unsubscribe is idempotent and safe mid-dispatch (AC-15 snapshot);
  re-use `validatePattern` so client grammar matches server. Proposed layout
  `packages/adapter-websocket/src/{server,registry,fanout,errors}.ts`. Full
  resolution in `tickets/W5-resolution.md`.
- 2026-08-03 — W2 sub-Q 1 (grill) — Canonical auth transport is
  **JWT-in-first-message-after-onopen** (mirrors sdk-node / sdk-browser T5 Q1).
  Wire: `{type:"auth", token}` → `{type:"auth.ok", connectionId, claims}` |
  `{type:"auth.error", code, message}` then 1008 close. JWT payload inherits
  MCP contract (`sub: {tenantId, callerId}`, `scope`, `expectedOrigins` for
  browser, `expiresAt`). Rules out `Sec-WebSocket-Protocol` (token in upgrade
  headers = access logs / APM leak) and `?token=` (browser history, `Referer`
  leak, CSRF). Origin binding inherited from sdk-browser T5 Q2 — server reads
  upgrade `Origin` before auth frame, mismatch → 1008. Sub-Q 4 will lock the
  exact allowlist-default; sub-Q 2 locks the pre-auth buffering window.
- 2026-08-03 — W2 sub-Q 2 (grill) — **Server holds the connection in a
  pre-auth state; only the `auth` frame is processed; all other frames are
  silently dropped until `auth.ok` is sent.** State machine: `open →
  pre-auth → authenticated | auth-error-closed`. Non-`auth` frames in
  `pre-auth` → debug-logged + dropped (no socket close, no error reply —
  "drop, don't punish"). Hard 30s timeout on `pre-auth` → close 1008
  (config knob, mirrors sdk-node's 30s backoff window). `auth.error` →
  send `auth.error` then 1008 close. W1 REOPEN ripple: `invoke` is in the
  post-auth accepted-set alongside `subscribe` / `event`; same pre-auth
  drop rule applies. Token refresh: `auth` allowed at any time in
  `authenticated` state — claims replaced in place, no state machine
  reset, no re-handshake (forward to sub-Q 3).
- 2026-08-03 — W2 sub-Q 3 (grill) — **Mid-connection token refresh is
  supported.** Same wire shape as initial auth (`{type:"auth", token}` →
  `{type:"auth.ok", connectionId, claims}` | `{type:"auth.error", code,
  message}` then 1008). On success, server atomically replaces per-connection
  claims (`tenantId`, `callerId`, `scope`, `expectedOrigins` re-checked
  against the *upgrade* `Origin` which is fixed for the connection
  lifetime). Carries across refresh: connection, active subscriptions,
  in-flight `invoke` `sessionId`s, per-connection outbound queue, `connectionId`.
  Resets atomically: `scope` (subsequent `subscribe` / `invoke` use new
  permissions). Does NOT abort in-flight invokes. Refresh failure →
  close 1008 (atomic swap, no fallback to old token — once refresh
  fails, old claims are untrusted). Audit emits `connection.rotated`
  event per refresh (W4). Cross-cuts W3 (existing subscriptions NOT
  torn down on narrowing refresh — operator's call). Rules out
  "reconnect-with-new-token" because reconnect loses active
  subscriptions, in-flight `invoke` calls, and back-pressure context.
  Mirrors sdk-node lifecycle test pattern.
- 2026-08-03 — W2 sub-Q 4 (grill) — **Origin allowlist enforced by
  default: per-token `expectedOrigins` JWT claim, exact match only.**
  Server captures the upgrade `Origin` at upgrade time (fixed for the
  connection lifetime); the comparison runs when the `auth` frame is
  processed (always first, per sub-Q 2 — resolves the sub-Q 1 shorthand
  "1008 before the auth frame is read"). `Origin` present (browser) →
  claim REQUIRED; missing/empty `expectedOrigins` on a browser token =
  deny-by-default (empty allowlist, every `Origin` mismatches);
  mismatch → `auth.error {code:"origin mismatch"}` then 1008 (code
  already in W4's locked list). Exact string match only — no
  prefix/suffix/regex/wildcard (`https://dashboard.example.com` must
  not match `https://dashboard.example.com.evil.com`). `Origin` absent
  (Node) → no check, claim ignored; a Node client that sends `Origin`
  explicitly opts into browser-style binding (token must match, else
  1008). Per-token allowlist at mint time, NOT server-global config
  (deployment-portable — the token is self-describing). `expectedOrigins`
  is an array — multi-origin tokens supported (dev + staging). Mirrors
  sdk-browser T5 Q2 — this ticket is the server-side enforcement, T5 Q2
  the client-side contract. **REVISED 2026-08-03 (map close-out,
  autonomous reconciliation — FLAGGED FOR USER REVIEW): exact-match
  ONLY contradicted T5 Q2's user-approved `*.subdomain` wildcard
  support (the lock this one mirrors verbatim). Revised grammar: exact
  match OR single-label `*.` wildcard — `*.` replaces exactly ONE
  label, right-anchored: `https://*.acme.com` matches
  `https://app.acme.com`, never `https://acme.com`, never
  `https://a.b.acme.com`, never `https://acme.com.evil.com` (RFC 6125
  §6.4.3 semantics). Typo-squatting property preserved; sim's loose
  prefix-match (`simulate-pre.html:590`) must NOT be copied — one
  shared right-anchored primitive for both doors. See REVISED note in
  auth-handshake.md.**
- 2026-08-03 — W2 closed. All four sub-questions locked: (1)
  JWT-in-first-message-after-onopen (canonical transport), (2) pre-auth
  state machine + 30s timeout + silent drop of non-auth frames, (3)
  mid-connection refresh with atomic claim swap + `connection.rotated`
  audit event, (4) per-token Origin allowlist (exact match,
  deny-by-default for browsers, Node bypass). Auth handshake contract
  complete. Next: W3 (subscription model) — unblocked by W2 close.
- 2026-08-03 — W3 sub-Q 2 (autonomous under user delegation) — **Topic
  vocabulary is VERBATIM event-bus topics.** Clients subscribe to the
  exact dot-namespaced topics the bus publishes (`session.*`,
  `capability.*`, `gateway.invocation`, `sdk.connection.*`, …). No
  curated second vocabulary — a rename table would be a translation
  layer maintained forever (nothing-is-special, interfaces-forever,
  tiny kernel). `validatePattern` reuse (W5) only works with verbatim
  vocabulary. "Curated is safer" is false safety — the gate is the
  per-subscribe scope check, not vocabulary secrecy. `event.*` reserved
  namespace: rejected at subscribe time (`WS_INVALID_TOPIC`) AND
  filtered at fan-out (defense-in-depth for bare-`*` matches).
- 2026-08-03 — W3 sub-Q 3 (autonomous under user delegation) — **Prefix
  wildcards verbatim, event-bus grammar: `*` final-segment only, bare
  `*` matches everything, no embedded `*`/regex.** Client-side
  validation reuses `validatePattern`; malformed → `subscribe.error`
  `WS_INVALID_TOPIC`. Authorization per-PATTERN at subscribe time (NOT
  per-event): required permission derived as `platform.<firstSegment>.
  read` (bare `*` → `platform.*.read` — operator-grade), checked with
  the same `checkAuthz` semantics as capability invocations (W2 sub-Q 1
  cross-ticket). Uniform derived rule = no mapping table = new event
  namespaces work without adapter changes. Wildcards don't widen the
  surface: the checked segment is the first one.
- 2026-08-03 — W3 sub-Q 4 (autonomous under user delegation) — **No
  session scoping in v1; tenant boundary = process boundary.** REVISION
  of the ticket's suspicion ("own session by default"). The auth frame
  has no sessionId claim (W2 sub-Q 1: claims are sub/scope/
  expectedOrigins/expiresAt); session payloads carry no tenantId and
  the session store isn't tenant-keyed — tenant isolation is by
  process, and the in-process bus only sees its own tenant's events.
  The dashboard (v1 consumer) needs ALL sessions' events (tenant-wide
  operator view, matches `session.list` semantics). sdk-browser's
  per-tab isolation is backend-runtime's job (D-43), not the adapter's.
  Client-side filtering by payload sessionId where needed.
- 2026-08-03 — W3 sub-Q 5 (autonomous under user delegation) —
  **Lifecycle: `subscribe` idempotent (dedupe per connection,
  `subscribe.ok` anyway); `unsubscribe` of never-subscribed topic →
  `unsubscribe.ok`, NO error (REVISION of suspected default — bus
  unsubscribe is already idempotent, drop-don't-punish); `socket.close`
  prunes all subs (snapshot-then-unsubscribe, W5) + clears outbound
  queue; refresh does NOT re-authorize/prune existing subs
  (point-in-time authz, W2 sub-Q 3 forward — operator sends explicit
  `unsubscribe` to revoke after narrowing); no subscription-count cap
  in v1.** W4 cross-ticket: adds `subscribe.ok`/`subscribe.error`/
  `unsubscribe.ok` frames; codes `WS_INVALID_TOPIC` (W5) +
  `WS_FORBIDDEN` (proposal, W4 finalizes).
- 2026-08-03 — W3 closed. Subscription contract complete: verbatim
  topics, prefix wildcards (`*` final segment only), derived
  per-pattern authorization (`platform.<first>.read`), no session
  scoping, idempotent lifecycle, prune-on-close. Blocks W4 (wire
  message schema) — resolved. Next: W6 (backpressure) then W4.
- 2026-08-03 — W6 sub-Q 1 (autonomous under user delegation) —
  **Threshold: 1 MiB per connection, configurable** (`maxBufferedBytes`,
  default 1_048_576). Matches `ws` common defaults; ~3 screenshot-size
  frames of headroom. Ship the knob, tune when a need shows up.
- 2026-08-03 — W6 sub-Q 2 (autonomous under user delegation) — **DROP,
  not close.** On threshold breach the adapter drops from the
  per-connection outbound queue (never blocks the bus — W5 lock).
  Rationale: W1 REOPEN locked universal `invoke` pull, so a dropped
  event is recoverable with one resync `invoke` — closing a slow
  consumer turns a transient condition into reconnect + re-auth +
  re-subscribe; "drop, don't punish" (W2 sub-Q 2); close codes mislabel
  slow consumers (1008 = policy violation, 1013 = server-side — neither
  true); block-the-producer impossible (W5: handlers run in publisher's
  call frame).
- 2026-08-03 — W6 sub-Q 3 (autonomous under user delegation) — **Drop
  strategy: FIFO (drop oldest, keep newest).** Lifecycle events are
  facts; a live dashboard needs the NEWEST state, and re-pull heals
  gaps — rate-based sampling keeps stale events and drops fresh ones
  (wrong for snapshot+live views). FIFO = one shift() at queue head.
- 2026-08-03 — W6 sub-Q 4 (autonomous under user delegation) —
  **Recovery signal: periodic `{type:"stats", dropped:N}` control frame,
  rate-limited ~1/s (`statsIntervalMs` default 1000).** Cumulative
  monotonic per-connection counter; client diffs, sees `dropped > 0`,
  re-pulls snapshots via `invoke`. Not per-event tagging (unreliable to
  count), not a close code (sub-Q 2). Rate limit keeps the signal from
  feeding the overflow.
- 2026-08-03 — W6 sub-Q 5 (autonomous under user delegation) —
  **Scope: whole-connection in v1.** One queue, one threshold, one
  counter (W5 architecture). Per-topic isolation = N queues + N counters
  + per-topic stats for zero demonstrated v1 need (dashboard's topics
  are few and slow). "Simple today. Scalable tomorrow." — per-topic is a
  v2 refinement if a firehose topic ever shares a socket with a critical
  one; record in future.md.
- 2026-08-03 — W6 closed. Backpressure policy complete: 1 MiB
  configurable threshold, FIFO drop (oldest first), periodic
  `{type:"stats", dropped:N}` recovery signal (~1/s), whole-connection
  scope. `invoke.partial` (W1 REOPEN) rides the same queue — partials
  drop under the same policy, stream resyncs by re-invoke. W4 (wire
  message schema) unblocked — final ticket.
- 2026-08-03 — W4 sub-Q 1 (autonomous under user delegation) — **Flat
  `{type, ...}` envelope for ALL messages, both directions — 16 types:
  4 client→server (`auth`, `subscribe`, `unsubscribe`, `invoke`), 12
  server→client (`auth.ok`, `auth.error`, `subscribe.ok`,
  `subscribe.error`, `unsubscribe.ok`, `event`, `invoke.result`,
  `invoke.error`, `invoke.partial`, `invoke.end`, `stats`, `error`).**
  Confirms W1 sub-Q 4 (no JSON-RPC, two products) + W1 REOPEN (invoke
  family joins). JSON-as-text, UTF-8.
- 2026-08-03 — W4 sub-Q 2 (autonomous under user delegation) —
  **Required keys per type locked — full contract assembled from every
  lock.** Highlights: `subscribe` topics non-empty + validatePattern +
  dedupe; `invoke` = {correlationId, name, input?, sessionId?, mode?}
  (mode default "call"); `event` = {topic, id, publishedAt, payload}
  (bus PlatformEvent identity — client dedup across resync); `stats` =
  {dropped} cumulative; `error` = {code, message} with `WS_INVALID_FRAME`
  (unknown type/malformed/missing keys), `WS_INTERNAL`,
  `WS_FRAME_TOO_LARGE` (outbound over-cap, then close 1009). `invoke.*`
  echo correlationId verbatim.
- 2026-08-03 — W4 sub-Q 3 (autonomous under user delegation) —
  **Error codes: WS-native string codes — MCP's numeric set stays MCP's
  (two doors, two products, W1 sub-Q 4).** Three vocabularies where they
  belong: protocol `WS_*` (`WS_INVALID_TOPIC` W5, `WS_FORBIDDEN` W3,
  `WS_INVALID_FRAME`, `WS_INTERNAL`, `WS_FRAME_TOO_LARGE`); auth
  lowercase phrases (W2 sub-Q 1, unchanged); invoke = gateway/capability
  code passthrough (no third vocabulary — nothing-is-special). Close
  codes: 1008 auth, 1011 heartbeat, 1009 frame too large.
- 2026-08-03 — W4 sub-Q 4 (autonomous under user delegation) —
  **Heartbeat: protocol-level only, server-initiated, T3 Q4 verbatim —
  30s ping, 10s pong timeout → close 1011. REVISION: NO app-level
  `pong`/`ping` frame type in v1** (W1 sub-Q 4's illustrative list had
  `pong`; W4 finalizes — every client auto-pongs at the protocol layer,
  an app-level pong has zero clients; one heartbeat model on the
  platform). future.md non-negotiables revised to match.
- 2026-08-03 — W4 sub-Q 5 (autonomous under user delegation) —
  **Message size cap: 1 MiB default, configurable (`maxFrameBytes`);
  inbound enforced at protocol level via `ws` `maxPayload` → close 1009
  (RFC 6455 standard code, zero adapter code); outbound over-cap →
  `{type:"error", code:"WS_FRAME_TOO_LARGE"}` then close 1009.** 100 MiB
  ws default is a DoS-size buffer for an event-stream API; screenshot
  (~341 KiB base64) fits 3× over.
- 2026-08-03 — W4 sub-Q 6 (autonomous under user delegation) — **No
  `version` field in v1; URL-path versioning when a breaking v2 ships**
  (`/ws` → `/ws/v2`, v1 door stays until consumers migrate). The door is
  the versioned thing (interfaces-forever), not every frame; matches
  future.md section 3.
- 2026-08-03 — W4 closed. Wire schema complete — the map's final
  ticket. 16-type flat envelope, required keys per type, WS-native
  string error codes (3 vocabularies), T3-Q4-mirrored protocol
  heartbeat (no app-level pong), 1 MiB frame cap (inbound 1009 /
  outbound `WS_FRAME_TOO_LARGE` + 1009), no version field.
  `connection.rotated` audit event (W2 sub-Q 3) → internal bus event
  `event.connection.rotated`, NOT relayed (W5 `event.*` rule).
- 2026-08-03 — **Map complete. All seven tickets closed (W1–W6 +
  W5 research).** The websocket-adapter wire contract is fully locked:
  WS-native envelope family (16 types), auth handshake + refresh +
  origin binding, verbatim-topic subscriptions with derived per-pattern
  authorization, pull parity via `invoke` with streaming, FIFO
  backpressure with stats recovery, 1 MiB frame cap, protocol-level
  heartbeat. Delivery: feature-pipeline run on the map (GRILL → PRD-TRD
  → IMPL → implement → sims), per the T7 (sdk-browser) precedent.
  Known follow-ups tracked elsewhere: D-50 drift (mint-side
  `expectedOrigins` — dashboard D4, already logged); W2 sub-Q 4
  wildcard reconciliation vs sdk-browser T5 Q2 (see auth-handshake.md
  REVISED note).

## Not yet specified

- **Multi-tab per client.** A browser may open more than one tab. Whether a single websocket
  connection covers all tabs or one-per-tab is a question deferred to dashboard-core / devtools-
  extension scoping (out of this map).
- **Capability-invocation compression / batching.** Whether `tools/call` mirrors MCP 1:1 or allows
  batched arrays. Suspected: 1:1 in v1, batched later if dashboard needs it.
- **Reconnect semantics for the adapter itself.** If the server restarts mid-connection, what
  does the client do? sdk-node has a 30s backoff-with-jitter model — likely reusable as the
  default. Defer to a future ticket unless W3 surfaces it.

## Out of scope

- **A REST push channel (SSE / long-poll).** Different transport. If a use case needs it, that's
  a separate map. The WebSocket adapter is the canonical push channel for v1.
- **Subprotocol versioning in v1.** Path version (`/ws/v2`) or query (`?v=2`) — defer until a
  second major version is on the table.
- **A "subscribe to capability results" channel.** Subscriptions are to platform events; cap
  invocation results come back on the request message, not via a separate subscription. (If
  a use case emerges, ticket it.)