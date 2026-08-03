# W4 — Wire message schema: JSON envelopes, error codes, heartbeat

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (2026-08-03 — all six sub-questions locked autonomously under user delegation; see "Sub-Qs 1–6 locked" below)
**Blocked by:** W1, W2, W3, W5 (research), W6 — all closed
**Blocks:** nothing — final ticket in the map

## Question

What is the on-the-wire shape of every message the WS adapter sends or receives,
including errors and heartbeats? Once W1–W3 settle the high-level shape (pull
parity, auth, subscriptions), this ticket is the *concrete schema*: which keys
are required, what the envelope looks like, what error codes map to what.

## What I know

- `adapter-mcp` uses JSON-RPC 2.0 (`packages/adapter-mcp/src/server.ts`); errors
  carry a numeric `code` and a string `message`. Codes -32001..-32006 are the
  Agentide-specific set (`error-map.ts:30-58`).
- `sdk-node`'s wire format is JSON envelopes with a `type` discriminator
  (`packages/sdk-node/src/types.ts`). Examples: `{type:"sdk.auth", token}`,
  `{type:"sdk.invoke", capability, input, requestId}`, `{type:"sdk.invoke.result",
  requestId, output}`.
- WebSocket protocol allows binary or text frames. JSON-as-text is the universal
  default for this kind of API; binary would require a schema registry. Pick
  JSON in v1.
- WebSocket ping/pong (frames 0x9 / 0xA) is the canonical keepalive. `ws` library
  exposes `socket.ping()` and `socket.on('pong', ...)`. A 30s interval is a
  common default.
- T3 Q4 (sdk-browser, locked 2026-07-30) is the platform's locked heartbeat
  precedent: server-initiated protocol-level ping every 30s, 10s pong timeout,
  close 1011. Browsers auto-pong at the protocol layer — page JS never sees
  pings; Node `ws` auto-pongs transparently.
- event-bus `PlatformEvent` shape (phase3 tests): `{name, payload, id,
  publishedAt}` — `id` is a per-publish UUID, `publishedAt` a timestamp.

## Sub-questions

1. **Envelope shape:** does every message have a top-level `type` discriminator
   (sdk-node style), or do we use JSON-RPC envelopes for pull messages and a
   separate `type` discriminator for pushes (mixed), or pure JSON-RPC for all?
   Pick one.
2. **Required keys:** what fields are required on each message type
   (`auth`/`subscribe`/`unsubscribe`/`event`/`pong`/`error`/etc.)?
3. **Error codes:** do we reuse MCP's wire codes (-32001..-32006) or define a
   WS-native set (e.g. `WS_AUTH_FAILED = 4001`)? Reuse is cheaper; native is
   cleaner. Pick.
4. **Heartbeat:** ping/pong at what interval (30s default?)? Does a missed
   pong close the socket, with which code?
5. **Message size cap:** max frame size (default `ws` is 100 MiB; almost
   certainly too high for an event-stream API). Set a sane cap.
6. **Schema versioning:** is there a `version` field on every envelope, or do
   we version the URL/path (`/ws` vs `/ws/v2`)? Suspected: no `version` field
   in v1; URL-versioned when v2 lands (matches the Out-of-scope section).

## Resolution must record

- envelope shape and the canonical `type` values;
- required keys per message type;
- error code set (reused from MCP or new);
- heartbeat interval and missed-pong close code;
- max frame size;
- schema versioning decision.

## Progress

**2026-08-03 — Claimed + closed in one pass (autonomous under user
delegation).** W1, W2, W3, W5, W6 all closed → W4 unblocked, and it is the
final ticket in the map. All six sub-questions locked below.

## Sub-Qs 1–6 (locked)

User granted full decision authority 2026-08-03 (same delegation as W3/W6);
every decision checked against PHILOSOPHY.md + shipped code + the W1/W2/W3/
W5/W6 locks + T3 Q4 before locking.

1. **Envelope shape: flat `{type, ...}` for ALL messages, both directions.**
   Already locked by W1 sub-Q 4 ("WS envelope deliberately differs from MCP…
   flat `{type, ...}` shape keyed by `type`") and W1 REOPEN (invoke family
   joins the same envelope). W4 confirms and enumerates the complete v1 type
   set — 16 types: 4 client→server, 12 server→client:

   Client→server: `auth`, `subscribe`, `unsubscribe`, `invoke`
   Server→client: `auth.ok`, `auth.error`, `subscribe.ok`, `subscribe.error`,
   `unsubscribe.ok`, `event`, `invoke.result`, `invoke.error`, `invoke.partial`,
   `invoke.end`, `stats`, `error`

   No JSON-RPC anywhere; no mixed envelopes; the
   discriminator is `type` on every message. JSON-as-text, UTF-8 (binary
   frames out — no schema registry in v1).

2. **Required keys per message type.** The complete contract, assembled from
   every lock:

   Client→server:
   - `{type:"auth", token}` — token required (string, JWT). [W2 sub-Q 1]
   - `{type:"subscribe", topics: string[]}` — topics required, non-empty;
     each validated against `validatePattern`; duplicates deduped per
     connection. [W3 sub-Q 3/5, W5]
   - `{type:"unsubscribe", topics: string[]}` — topics required;
     idempotent (unknown topics acked anyway). [W3 sub-Q 5]
   - `{type:"invoke", correlationId, name, input?, sessionId?, mode?}` —
     correlationId required (client-generated opaque string, echoed
     verbatim, multiplexes concurrent invokes); name required (capability
     name); input optional (defaults `{}`); sessionId optional (read-only
     discovery allowed without); mode optional, default `"call"`,
     one of `"call" | "stream"`. [W1 REOPEN]

   Server→client:
   - `{type:"auth.ok", connectionId, claims:{sub:{tenantId,callerId},
     scope, expiresAt}}` [W2 sub-Q 1]
   - `{type:"auth.error", code, message}` then close 1008. [W2 sub-Q 1]
   - `{type:"subscribe.ok", topics}` — echo of accepted topics. [W5, W3]
   - `{type:"subscribe.error", code, topics}` — code `WS_INVALID_TOPIC`
     (malformed pattern — no subscription created) | `WS_FORBIDDEN`
     (scope denial); topics = offending topics. [W5, W3 sub-Q 3]
   - `{type:"unsubscribe.ok", topics}` — echo. [W5, W3 sub-Q 5]
   - `{type:"event", topic, id, publishedAt, payload}` — topic = verbatim
     bus event name (W3 sub-Q 2 vocabulary); id + publishedAt = the bus's
     `PlatformEvent` identity (client-side dedup across reconnect/resync);
     payload = the frozen event payload as-is (phase3 contract). [W5, W3,
     event-bus phase3]
   - `{type:"invoke.result", correlationId, output}` [W1 REOPEN]
   - `{type:"invoke.error", correlationId, code, message, details?}` —
     code = the UNDERLYING gateway/capability error code, passed through
     untranslated (nothing-is-special: no third error vocabulary for the
     invoke path; the gateway's codes ARE the invoke error codes).
     [W1 REOPEN, PHILOSOPHY]
   - `{type:"invoke.partial", correlationId, output}` — stream mode only.
     [W1 REOPEN]
   - `{type:"invoke.end", correlationId}` — closes the stream. [W1 REOPEN]
   - `{type:"stats", dropped}` — dropped = cumulative monotonic
     per-connection counter (client diffs; re-pull snapshots when > 0).
     [W6 sub-Q 4]
   - `{type:"error", code, message}` — generic server-side protocol errors:
     unknown `type` / malformed JSON / missing required keys →
     `WS_INVALID_FRAME`; internal processing failure → `WS_INTERNAL`;
     outbound frame over size cap → `WS_FRAME_TOO_LARGE` (then close 1009).

3. **Error codes: WS-native string codes.** MCP's numeric set (-32001..-32006)
   stays MCP's — two doors, two products (W1 sub-Q 4); reusing MCP codes would
   forge a false equivalence between surfaces that deliberately differ. Three
   vocabularies, each where it belongs:
   - Protocol errors (`subscribe.error`, `error`): `WS_*` uppercase strings —
     `WS_INVALID_TOPIC` [W5], `WS_FORBIDDEN` [W3], `WS_INVALID_FRAME`,
     `WS_INTERNAL`, `WS_FRAME_TOO_LARGE`. Self-documenting on the wire; no
     shared code registry across doors.
   - Auth errors (`auth.error`): lowercase phrase strings — `token expired`,
     `token invalid`, `token missing`, `origin mismatch`, `tenant suspended`.
     [W2 sub-Q 1, locked — keep]
   - Invoke errors (`invoke.error`): gateway/capability code passthrough
     (sub-Q 2). No WS-native invoke set.
   - Close codes: 1008 (auth failure — W2), 1011 (heartbeat timeout — T3 Q4),
     1009 (frame too large — RFC 6455).

4. **Heartbeat: protocol-level only, server-initiated, mirroring T3 Q4
   verbatim.** Server sends a protocol-level ping every 30s per socket; 10s
   without a pong → close 1011 ("heartbeat timeout"). Browsers auto-pong at
   the protocol layer (page JS never sees pings — T3 Q4); Node `ws`
   auto-pongs transparently. **REVISION: NO app-level `pong` (or `ping`) frame
   type in the v1 contract.** W1 sub-Q 4's illustrative type list included
   `pong`; W4 owns the concrete schema and finalizes: there is no client that
   cannot auto-pong at the protocol layer, so an app-level pong is dead
   weight — a frame type with zero clients that need it. One heartbeat model
   on the platform, not two. (future.md's non-negotiables list revised to
   match — see that file.)

5. **Message size cap: 1 MiB default, configurable (`maxFrameBytes`),
   enforced at the protocol level for inbound via `ws` `maxPayload` → close
   1009** (RFC 6455's standard "message too big" code; ws rejects the frame
   before app code sees it — zero adapter code for the inbound path).
   Rationale: ws's 100 MiB default is a DoS-size buffer for an event-stream
   API; the largest known v1 payload is `browser.screenshot` (~341 KiB
   base64 for 256 KiB raw) → 1 MiB is ~3× headroom. Outbound: the adapter
   never constructs a frame over the cap by construction (known payloads fit);
   if one ever exceeds it (future capability returns something huge), the
   adapter sends `{type:"error", code:"WS_FRAME_TOO_LARGE"}` then closes 1009
   — a hole in the event stream is worse than a clean close + reconnect with
   a raised cap (observable + reversible).

6. **Schema versioning: NO `version` field in v1; URL-path versioning when a
   breaking v2 ships** (`/ws` → `/ws/v2`, v1 door stays until consumers
   migrate). Matches the ticket's suspicion, the map's out-of-scope section,
   and future.md section 3 ("path-version or query-version move is a separate
   ticket"). A version field on every frame is noise; the door is the
   versioned thing (interfaces-forever: evolve the door, keep the contract).

Cross-ticket closeout — `connection.rotated` audit event (W2 sub-Q 3 forward
to W4): published on the bus as an INTERNAL audit event under
`event.connection.rotated` with payload `{connectionId, tenantId, callerId,
rotatedAt}`. NOT relayed to clients: `event.*` is the reserved internal
namespace (W5), and dashboard-side observability of WS adapter internals is
deferred (W5: no `ws.connection.closed` in v1 — same decision class).
Consumers: the gateway audit trail / future observability packs.

Source: user delegation 2026-08-03; W1 sub-Q 4 + W1 REOPEN; W2 sub-Q 1/3;
W3 sub-Q 2/3/5; W5 resolution; W6 sub-Q 4; T3 Q4 (sdk-browser, heartbeat
precedent); event-bus phase3 `PlatformEvent` shape; PHILOSOPHY.md
(nothing-is-special, delay-complexity, observability-mandatory).