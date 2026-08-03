# W2 — Auth handshake: reuse MCP's bearer-token-in-first-message model?

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (2026-08-03 — all four sub-questions locked; see "## W2 — Closed" below)
**Blocked by:** W1 (scope) — closed 2026-08-03
**Blocks:** W3 (subscription model)

## Question

How does a WebSocket client authenticate, and where does the bearer token travel?
The browser constraint (no custom HTTP headers on `WebSocket`) plus the existing
pattern (sdk-node sends token in first message after `onopen`) make this not
quite the same as MCP's `Authorization` header. Need a single canonical approach
that fits both server-side clients (operators, CLI) and browser-side clients.

## What I know

- `adapter-mcp` reads the bearer from the HTTP `Authorization` header on each
  request (set into `AsyncLocalStorage` by `startMcpHttpServer` in
  `packages/adapter-mcp/src/server.ts`; per-request context in
  `packages/adapter-mcp/src/types.ts:39`).
- `sdk-node` opens an outbound WebSocket to `backend-runtime`, then sends a
  `sdk.auth` frame as the first message after `onopen` (per `WebSocketLike`
  contract in `packages/backend-runtime/src/types.ts:89`, used by sdk-node's
  `WsClient`).
- `sdk-browser` does the same as sdk-node — first message after `onopen`. The
  browser doesn't allow custom HTTP headers on WebSocket, so this is the only
  option that works in both Node and browser without transport branching
  (`docs/wayfinder/sdk-browser/tickets/websocket-transport-details.md` T5 closed
  this for sdk-browser).
- `Sec-WebSocket-Protocol` (browser-supported) is a third option — the token is
  negotiated during the HTTP upgrade handshake, server picks one. Avoids the
  "first message after onopen" race entirely, but servers often log subprotocol
  headers in access logs.

## Sub-questions

1. **Canonical transport:** JWT-in-first-message-after-onopen (sdk-node/sdks model),
   `Sec-WebSocket-Protocol` (upgrade-header model), or `?token=` query parameter
   (logged-in-proxies risk). Pick one canonical approach for the WS adapter.
2. **First-message timing race:** between `onopen` and the first message, is the
   server's view of the connection "anonymous"? sdk-node's pattern is yes. If a
   client sends a `subscribe` or `tools/call` *before* auth completes, what
   happens? (Suspected: server queues the auth, rejects all other messages until
   auth completes — but lock it.)
3. **Token refresh:** sdk-node supports token rotation via the `sdk.auth` re-send
   pattern (see sdk-node lifecycle tests). Does the WS adapter need the same, or
   is "reconnect with a new token" sufficient for v1?
4. **Origin allowlist:** browsers send an `Origin` header on the upgrade; Node
   clients usually don't. Does the WS adapter enforce an Origin allowlist by
   default? (Cross-ticket with `sdk-browser`'s T5 Q2 — same question, same answer
   needed.)

## Resolution must record

- the chosen auth transport (sub-Q 1);
- server-side behavior on pre-auth messages (sub-Q 2);
- whether token refresh-in-place is supported (sub-Q 3);
- Origin allowlist default behavior (sub-Q 4), with a pointer to the matching
  sdk-browser decision.

## Progress

**2026-08-03 — Claimed + pre-grill review (this session).** Re-read
`packages/backend-runtime/src/server.ts:108-150` (the auth handshake for
backend-runtime), `packages/backend-runtime/src/verify.ts` (token verify),
`packages/adapter-mcp/src/server.ts` (per-request header auth via
AsyncLocalStorage), and CONTEXT.md entry `sdk-browser T5 Q2` (Origin binding).

What's grounded for the WS adapter:
- **Browser cannot set custom headers on `WebSocket`** (WHATWG WebSocket Living
  Standard). Same constraint that drove sdk-browser T5 Q1's lock to
  JWT-in-first-message. The WS adapter will face the same constraint from any
  browser client.
- **Origin header is auto-attached by browsers** on the WS upgrade (WHATWG
  Fetch). For browser WS clients, the upgrade `Origin` is available *before*
  any message arrives — the server can read it during the HTTP upgrade.
- **sdk-browser T5 Q2 lock** (CONTEXT.md 2026-07-30 entry): every browser SDK
  token MUST carry `expectedOrigins` JWT claim; server closes socket 1008 if
  `Origin` doesn't match. Permanent origin binding. **The WS adapter SHOULD
  mirror this lock** — same browser threat model.
- **sdk-node sends `sdk.auth` first message after `onopen`**, verified at
  `packages/backend-runtime/src/server.ts:108-150`. Pre-auth frames are
  silently dropped. Server-side state machine: `open → buffering →
  accepted | auth-error-closed`.
- **Token refresh pattern:** sdk-node re-sends `sdk.auth` mid-connection to
  rotate tokens (verified in lifecycle tests). The pattern is generic enough
  for the WS adapter to copy.

W2's four sub-questions all have an obvious recommended answer from the
pre-grill review — but they're each a real lock, not just an obvious one, so
grilling them anyway.

**2026-08-03 — W1 sub-Q 1 REOPEN updates the auth surface.** W2 now gates
`auth → { subscribe, unsubscribe, event, invoke }` instead of `auth → { subscribe,
unsubscribe, event }`. The auth handshake itself does not change shape (the
first message after `onopen` is still the auth frame), but the post-auth
state machine is wider. The auth frame MUST carry sufficient claims for the
adapter to authorize every message type that follows: `subscribe` (claim per
topic or topic prefix), `invoke` (claim per capability name + version), and
the `sessionId` field on `invoke` (claim `sessionId` belongs to the
authenticated tenant). The dashboard's read-only token (per
`dashboard-core` GRILL Q2) is a concrete v1 token type that must reach the
WS adapter and pass authorization for everything it asks for. Flag for W2
sub-Q 1: the auth frame payload may need to advertise the token's scope
beyond "validated" (e.g. the server may want to know up-front whether this
token is `platform.*.read` vs `platform.*.act` so it can map it to the
right adapter-side permission policy). Locking that decision is part of W2
sub-Q 1, not a separate sub-question.

Starting grilling below.

**2026-08-03 — Sub-Q 1 locked: JWT-in-first-message-after-onopen (sdk-node / sdk-browser pattern).**

WS adapter canonical auth transport is the **first message after `onopen`**
(per sdk-node's `sdk.auth` frame, verified at `packages/backend-runtime/src/server.ts:108-150`,
and sdk-browser T5 Q1 lock — `docs/wayfinder/sdk-browser/tickets/websocket-transport-details.md`).

Wire shape:
- request: `{type: "auth", token}` (single field, `token` = signed JWT)
- reply: `{type: "auth.ok", connectionId, claims: { sub: { tenantId, callerId }, scope, expiresAt }}`
- reply (failure): `{type: "auth.error", code, message}` then server closes the socket
  (close code 1008 per WHATWG — "policy violation"; npm `ws` constant 1008).

JWT payload (inherited from MCP / sdk-node contract, no re-grilling):
- `sub`: `{ tenantId, callerId }` — verified by `Gateway.handleInvocation`'s
  audit-log path (`packages/gateway-core/src/audit.ts`).
- `scope`: array of `platform.*` / `*.read` / `*.act` permissions — same
  `checkAuthz` model as MCP (`packages/gateway-core/src/authz.ts:56`).
- `expectedOrigins`: array of `Origin` strings, REQUIRED for browser clients
  (mirrors sdk-browser T5 Q2 lock); server validates `Origin` header on the
  upgrade against this claim; mismatch → 1008 before the auth frame is even
  read.
- `expiresAt`: standard JWT exp claim; server rejects expired tokens with
  `auth.error.code: "token expired"`.

**Why JWT-in-first-message-after-onopen, not the alternatives:**
- `Sec-WebSocket-Protocol` (upgrade-header model): browser-supported, but the
  server's HTTP upgrade handshake is *front-line* for proxies / access logs /
  APM. Tokens in upgrade headers appear in plain-text in those logs. The
  WS adapter is the third surface already pinning "browser constraint" for
  auth (same constraint sdk-browser T5 Q1 hit); adding a second auth shape
  for the same constraint is gratuitous.
- `?token=` query parameter: lands in browser history, server access logs,
  the `Referer` header on every cross-origin request (CSRF vector), and any
  proxy the client traverses. `Sec-WebSocket-Protocol` is at least upgrade-
  scoped; `?token=` is forever. Hard no.
- JWT-in-first-message-after-onopen: token stays inside the encrypted WS
  tunnel after the upgrade. Token never appears in HTTP-layer logs. One
  code path for Node + browser clients (no transport branching). Matches
  the existing sdk-node / sdk-browser pattern verbatim — the WS adapter
  is the third consumer, the pattern is already battle-tested.

**Pre-auth window, briefly (locked forward to sub-Q 2):** between TCP `open`
and the auth frame, the server's view of the connection is "anonymous". Any
non-auth frame in that window is silently dropped (server queues no-frame-
mirror, just discards). The auth frame itself is always processed. The
post-auth state machine is `open → buffering → accepted | auth-error-closed`.
Detail in sub-Q 2.

**Browser origin binding (sub-Q 4 cross-reference):** every browser WS
client upgrade MUST carry an `Origin` header that matches a JWT
`expectedOrigins` claim — same model as sdk-browser T5 Q2. Server reads
the upgrade `Origin` *before* processing the first message; mismatch → 1008
before the auth frame is read. Node clients don't send `Origin`; the
`expectedOrigins` enforcement is conditional on the upgrade carrying it
(no-Origin = Node client, no check). Sub-Q 4 will lock the exact
allowlist-default behavior; this sub-Q inherits the same mechanism from
sdk-browser's lock.

**Cross-ticket impact:**
- W4 (wire schema): must lock the `auth` / `auth.ok` / `auth.error` envelope
  variants + `code` field on `auth.error` (codes: `token expired`,
  `token invalid`, `token missing`, `origin mismatch`, `tenant suspended`).
- W3 (subscription model): topic authorization per `subscribe` is checked
  against the auth frame's `scope` claim — same model as MCP's
  `checkAuthz(callerScope, requiredPermissions)`.
- W6 (backpressure): the auth frame is NOT subject to backpressure (small
  single frame, processed first). Post-auth frames follow the standard
  per-connection outbound queue.

---

## Locked so far

**2026-08-03 — Sub-Q 2 locked: server holds the connection in a pre-auth state; only the `auth` frame is processed; all other frames are dropped silently until `auth.ok` is sent.**

State machine (per-connection):
- `open` → `pre-auth` (connection accepted at the TCP layer, no frames
  dispatched to the adapter's message handlers)
- `auth` frame arrives in `pre-auth` → server validates JWT (signature,
  `exp`, origin-binding per sub-Q 1), applies permission claims, transition
  to `authenticated`
- any **non-`auth` frame in `pre-auth`** → silently dropped; server logs at
  debug level (ops visibility, never warn — clients shouldn't pre-send by
  accident)
- `auth.ok` sent → server transitions to `authenticated`; subsequent frames
  dispatch normally
- `auth.error` → server sends `auth.error` then closes socket with code
  1008 (WHATWG policy violation) immediately — no further state

Bounded pre-auth window:
- Server enforces a hard timeout on the `pre-auth` state — close 1008 if
  no `auth` frame arrives within **30 seconds** (config knob, default 30s;
  mirrors sdk-node's 30s backoff-with-jitter window as a symmetric
  timeout). This sub-Q locks the *behavior* (drop non-auth, auth-only
  during pre-auth, 1008 on timeout); the timeout duration is the server
  config knob. W4's wire schema does not need to encode the timeout.

W1 REOPEN ripple: post-auth state machine now includes `invoke` alongside
`subscribe` / `event`. Pre-auth rule is the same: only `auth` is processed.
A client sending `invoke` before auth sees the frame silently dropped;
contract is "clients MUST wait for `auth.ok` before sending any non-auth
frame" — documented client-side rule.

Why exactly drop-non-auth, not queue-or-error:
- Mirrors `backend-runtime`'s proven pattern (`packages/backend-runtime/src/server.ts:108-150`):
  same `open → pre-auth → accepted | auth-error-closed` state. One bug
  class (pre-auth buffer overflow, sticky pre-auth) amortised across two
  adapters.
- "Queue everything" alternative is bad: a malicious or buggy client could
  spam non-auth frames indefinitely. Any cap is denial-of-service clamping
  anyway; drop and move on is simpler.
- "Reject pre-auth with an error" just moves the same loss to "client
  retries after `auth.ok`" — same outcome, more protocol noise. Silent
  drop is the conventional behavior.
- Server DOES NOT close the socket on a non-auth frame in `pre-auth`.
  Client may have an out-of-order or misordered script; drop, don't punish.

Token refresh cross-cut (forward to sub-Q 3): the `auth` frame is allowed
at any time in `authenticated` state for token rotation. The transition
back to `pre-auth` is a no-op — the new token's claims replace the old
claims in place; no state machine reset, no re-handshake. Server sends
`auth.ok` after the rotated token validates. Detail in sub-Q 3.

Source: W2 ticket sub-Q 2; sdk-node auth path in
`packages/backend-runtime/src/server.ts:108-150`; backend-runtime
pre-auth timeout pattern. User wording "agreed".

**2026-08-03 — Sub-Q 3 locked: mid-connection token refresh is supported; the `auth` frame is allowed at any time in `authenticated` state.**

Wire (same shape as initial auth):
- request: `{type: "auth", token}` (new JWT)
- reply (success): `{type: "auth.ok", connectionId, claims: <new claims>}`
- reply (failure): `{type: "auth.error", code, message}` then close 1008

What the server does on success:
- Validates the new token: signature, `exp`, `expectedOrigins` re-checked
  against the upgrade `Origin` (upgrade `Origin` is fixed for the
  connection lifetime; refresh cannot escape origin binding).
- Atomically replaces the per-connection claims (`tenantId`, `callerId`,
  `scope`, `expectedOrigins`) in place.
- Sends `auth.ok` with the new claims. No re-handshake, no reconnection,
  no state reset.

What carries across refresh vs. what resets:
- **Carries across:** the connection itself, all active subscriptions, the
  `sessionId`s on in-flight `invoke` calls, the per-connection outbound
  queue, the `connectionId` field.
- **Resets atomically with new claims:** the `scope` (subsequent
  `subscribe` / `invoke` checks use the new permissions; an `invoke`
  already in-flight when the refresh arrives uses the old `scope` —
  captured at `handleInvocation` dispatch time, which is correct: the
  audit log records the scope at dispatch, not at completion).
- **Does NOT reset:** in-flight `invoke` calls do NOT abort on token
  refresh. Server doesn't tear down the connection, doesn't cancel
  inflight work.

What triggers a refresh (client-side policy, NOT server-enforced):
- Token about to expire (client tracks `expiresAt` from `auth.ok.claims`).
- Server-initiated rotation (operator pushes a new key/role to a
  long-running client).
- Token compromise (immediate rotation).
- Permission scope expansion (rare; re-mint with new JWT claims).

The adapter's contract is "auth frame allowed at any time in
`authenticated` state"; no client-side refresh policy is locked here.

Race condition: refresh-arrives-during-another-refresh is serialized
(one-at-a-time per connection via the per-connection state machine
event loop). No concurrent claims-swap races.

Disconnect-on-failure: if the new token fails validation, server closes
the connection with 1008. Client MUST reconnect with a valid token to
continue. There is no "fall back to old token" — once a refresh fails,
the server doesn't trust the old claims anymore (refresh is one
motivation for revocation). Atomic swap, not soft transition.

Why exactly mid-connection refresh, not "reconnect with new token":
- sdk-node already supports mid-connection `sdk.auth` re-send (verified
  by lifecycle tests; same shape as the adapter's `auth` frame). The
  pattern is generic enough for the WS adapter to inherit — one mental
  model, one test surface, one implementation.
- Token refresh without reconnect preserves: active subscriptions
  (otherwise client must re-send every topic after reconnect, racing
  with server processing), in-flight `invoke` calls (a long `mode:
  "stream"` invoke loses its partial stream on reconnect — client must
  retry from scratch), and the per-connection outbound queue /
  back-pressure context.
- Mid-connection refresh keeps audit-trail continuous — no
  `connection.disconnect → connection.connect` pair in the log.
  Audit emits `connection.rotated` event on each successful refresh
  (cross-cuts W4 wire schema for the `audit.rotated` event shape).

Cross-ticket impact:
- W4 (wire schema): must lock the `auth` / `auth.ok` envelope
  reusability for refresh (same envelope, server branches by state
  machine context — initial vs. refresh); adds `audit.rotated` event
  shape.
- W3 (subscription model): per-`subscribe` authorization checks
  current `scope` — refresh that adds permissions instantly broadens
  topic authorization; refresh that removes permissions instantly
  narrows it (subsequent `subscribe` calls). Existing subscriptions
  are NOT torn down on a narrowing refresh — operator's call to
  decide whether to `unsubscribe` (forward to W3).
- W6 (backpressure): refresh `auth` frame is small + processed
  first, like the initial auth frame.

Source: W2 ticket sub-Q 3; sdk-node lifecycle tests; W1 REOPEN
(post-auth state machine widens to include `invoke`, but the refresh
contract is identical for all three post-auth message types). User
wording "agreed with your recommendation".

**2026-08-03 — Sub-Q 4 locked: Origin allowlist enforced by default — per-token `expectedOrigins` JWT claim, exact match only; browsers checked, Node clients (no `Origin`) bypass; mismatch → `auth.error {code: "origin mismatch"}` then close 1008.**

Mechanics (precise — resolves the sub-Q 1 shorthand "1008 before the
auth frame is read"):
- Server reads the HTTP upgrade `Origin` header at upgrade time and
  **captures it for the connection lifetime**. The browser cannot change
  it after the upgrade — that is the point of origin binding.
- The `expectedOrigins` claim travels in the JWT, so the *comparison*
  runs when the `auth` frame is processed (always the first frame, per
  sub-Q 2). The server cannot reject at the upgrade layer alone — it
  doesn't know the claim until the JWT arrives. Same end result: a token
  stolen from origin X is useless from origin Y.
- `Origin` present (browser client) → check `Origin` against JWT
  `expectedOrigins`:
  - **Exact string match only.** No prefix, suffix, scheme-wildcard, or
    regex matching. `https://dashboard.example.com` must NOT match
    `https://dashboard.example.com.evil.com` (typo-squatting,
    subdomain-confusion surface).
  - `expectedOrigins` is **REQUIRED for browser tokens**. Missing or
    empty claim on a token facing an `Origin`-carrying upgrade → treated
    as an empty allowlist → every `Origin` mismatches → 1008.
    Deny-by-default.
  - Mismatch → server sends `auth.error {code: "origin mismatch"}` then
    closes 1008 (same reply-then-close pattern as sub-Q 2's
    `auth.error`; `origin mismatch` is already in W4's locked code list
    from sub-Q 1). No separate `origin.error` frame.
- `Origin` absent (Node client) → **no origin check.** The
  `expectedOrigins` claim is ignored. Node service clients, CLIs, curl —
  unaffected.
- Node client that *does* send `Origin` explicitly (some HTTP stacks do)
  → **opts into browser-style origin binding**: the token must carry a
  matching `expectedOrigins`, else 1008. Recommended Node pattern: no
  `Origin` header, no `expectedOrigins` claim.

Per-token allowlist, NOT server-global:
- The allowlist lives in the JWT at mint time (operator sets
  `expectedOrigins` when minting the dashboard token). The server just
  verifies signature + `exp` and compares the captured upgrade `Origin`
  to the claim.
- Server-global "trusted origins" config is rejected: it couples the
  adapter to a specific deployment URL and breaks token portability
  (ship the dashboard to a new URL → re-mint everything or edit server
  config). The token is self-describing — one mental model, one test
  surface.

Multi-origin tokens:
- `expectedOrigins` is an array — one token can be valid for multiple
  origins (e.g. dev token with `["http://localhost:3000",
  "https://staging.example.com"]`). Server matches whichever `Origin`
  the client actually sends.

Why this exactly:
- *No allowlist:* a stolen JWT replays from any origin — origin binding
  from sub-Q 1 would be decorative. Zero defense against token theft at
  the transport boundary.
- *Server-global allowlist:* breaks token portability, couples adapter
  to deployment URL. Rejected above.
- *Force `Origin` on Node clients:* breaks every existing Node client
  for a browser-only threat. Not worth it.
- *Wildcard/regex matching (loose):* a prefix-based `*.` match allows
  `evil.example.com` for `*.example.com`. The locked grammar is the
  single-label `*.` wildcard — exactly one label, right-anchored — which
  preserves the typo-squatting property (see REVISED note above; T5 Q2
  alignment). Regex / multi-label / prefix matching remains rejected.
- Mirrors **sdk-browser T5 Q2 verbatim** — this ticket is the WS
  adapter's *server-side* enforcement of the same lock; T5 Q2 is the
  client-side contract that depends on it. One mental model across both.

Scenario: dashboard token minted with
`expectedOrigins: ["https://dashboard.example.com"]`. Dashboard
connects — upgrade `Origin: https://dashboard.example.com`, captured.
Auth frame arrives, JWT signature ok, `exp` future, `expectedOrigins`
contains the captured `Origin` → `auth.ok`, authenticated. A phishing
page at `https://dashboard.example.com.evil.com` steals the token and
connects — upgrade `Origin` captured as the phishing origin; auth frame
arrives, JWT signature ok, but `expectedOrigins` does NOT contain the
phishing `Origin` → `auth.error {code: "origin mismatch"}` + 1008.
Stolen token is useless from any non-allowlisted origin.

**REVISED 2026-08-03 (map close-out, autonomous reconciliation under
user delegation — FLAGGED FOR USER REVIEW):**

- Conflict found: this lock says "exact string match only — no
  wildcard", but sdk-browser T5 Q2 (user-approved 2026-07-30 — the lock
  this one claims to mirror verbatim) explicitly supports `*.subdomain`
  wildcard entries (`expectedOrigins` "with `*.subdomain` wildcard
  support"). Two user-approved locks in conflict; the user's delegation
  mandate ("align it with what we already had so we don't run into
  confliction") forces a reconciliation, and T5 Q2 is the earlier,
  platform-level lock — the adapter's server-side enforcement must not
  be stricter than the client contract it mirrors.
- **Revised grammar: exact match OR single-label `*.` wildcard.**
  `*.` replaces exactly ONE label: `https://*.acme.com` matches
  `https://app.acme.com`; does NOT match `https://acme.com` (the
  wildcard requires one label — zero-label match denied); does NOT
  match `https://a.b.acme.com` (wildcard replaces one label only); does
  NOT match `https://acme.com.evil.com` (the literal suffix must match
  through the end of the string — match from the RIGHT, never prefix).
- Security property preserved: the typo-squatting case this lock was
  written against — `https://dashboard.example.com.evil.com` against
  entry `https://*.example.com` — still never matches, because the
  wildcard is exactly one label and the remaining suffix is literal.
  Same grammar as TLS wildcard certificates (RFC 6125 §6.4.3).
- Implementation warning: sdk-browser's sim fixture implements the
  wildcard as a PREFIX check (`origin.startsWith(o.replace('*.', ''))`
  at `simulate-pre.html:590`) — that is LOOSE and would accept
  `https://acme.com.evil.com` for `https://*.acme.com`. It is sim code
  (D-50: nothing shipped), but the adapter implementation MUST use
  right-anchored single-label matching, NOT the sim's prefix check.
- One shared primitive: `backend-runtime` (T5 Q2 enforcement) and
  `adapter-websocket` (this lock) use the same origin-matching grammar —
  one implementation, both doors.
- Everything else in this lock is unchanged: deny-by-default for
  browser tokens, Node bypass, upgrade-time capture, `auth.error
  {code: "origin mismatch"}` + 1008, per-token (not server-global)
  allowlist, array entries.

Cross-ticket impact:
- W4 (wire schema): `auth.error.code` value `origin mismatch` (already
  in the sub-Q 1 locked list) confirmed as the reply path — no separate
  `origin.error` frame, no new envelope variant.
- W3 (subscription model): no impact — `subscribe` authorization is
  per-`scope`, not per-origin.
- W6 (backpressure): no impact — one header capture at upgrade + one
  string compare at auth processing; neither is a queue concern.
- sdk-browser T5 Q2: client-side counterpart; both locks recorded
  separately for traceability.

Source: W2 ticket sub-Q 4; sdk-browser T5 Q2 lock (CONTEXT.md 2026-07-30
entry); WHATWG Fetch (browser auto-attaches `Origin` on WS upgrade).
User wording "agreed with your recommendation".

## W2 — Closed

**2026-08-03 — W2 closed after all four sub-questions locked.**

Resolution summary:
- **Sub-Q 1:** canonical auth transport = JWT-in-first-message-after-
  onopen (sdk-node / sdk-browser pattern). Wire: `{type:"auth", token}`
  → `{type:"auth.ok", connectionId, claims}` | `{type:"auth.error",
  code, message}` + 1008. JWT inherits the MCP contract: `sub
  {tenantId, callerId}`, `scope`, `expectedOrigins` (required for
  browsers), `expiresAt`.
- **Sub-Q 2:** pre-auth state machine (`open → pre-auth → authenticated
  | auth-error-closed`); only `auth` processed; non-auth frames silently
  dropped (debug-logged, no socket close, "drop, don't punish"); hard
  30s pre-auth timeout → 1008 (config knob).
- **Sub-Q 3:** mid-connection token refresh supported — same wire shape
  as initial auth; atomic claim swap (no re-handshake, no state reset);
  carries connection / active subscriptions / in-flight `invoke`
  `sessionId`s / outbound queue / `connectionId`; does NOT abort
  in-flight invokes; refresh failure → 1008, no fallback to old token;
  audit emits `connection.rotated`.
- **Sub-Q 4:** Origin allowlist enforced by default — per-token
  `expectedOrigins` (exact match OR single-label `*.` wildcard per the
  REVISED note above; REQUIRED for browser tokens, deny-by-default);
  Node clients (no `Origin`) bypass; per-token not server-global;
  mirrors sdk-browser T5 Q2 (this ticket = server-side enforcement,
  T5 Q2 = client-side contract).

Auth handshake contract complete. Next: W3 (subscription model) —
unblocked by W2 close.