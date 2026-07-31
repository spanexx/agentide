# SDK auth.ack timing

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** T5, T6

## Resolution

**Synchronous ack.** Server sends `sdk.auth.ack` in the same message
loop tick as the auth verification. No new state machine step on
the SDK side beyond what already exists.

- SDK's `state().applicationId` is `null` only during the connecting
  window (before the ack arrives). After ack, it's the server's id.
- **No retransmission.** The ack is synchronous; if the socket is
  alive enough to receive the auth, it's alive enough to receive
  the ack.

**Rules out:**
- Async ack with retransmission (over-engineered; the socket is
  alive on the same message loop).
- Fire-and-forget ack (the SDK's `state()` would be inconsistent).

**Tag:** `delivery: decision-only` — timing locked.

## Question

Is the server's `sdk.auth.ack` message synchronous with the auth
handshake (sent immediately after `sdk.auth` verification), or is
there a separate ready/acknowledge step the SDK must await?

## What I know

- The Grill locked: server sends `sdk.auth.ack { applicationId,
  applicationName }` after a successful auth handshake.
- The Grill did NOT lock the timing. Today's `sdk.auth` flow is:
  SDK sends auth, server validates, server registers, server
  (currently) sends nothing back. The first server-side event the
  SDK learns about is `sdk.connection.accepted` (an event-bus event,
  surfaced via the wire per the Phase 7 work).
- The state machine on the SDK side is `connecting → connected →
  ready`. Today `connected` and `ready` collapse (the SDK is
  immediately ready after auth).
- An `auth.ack` adds at minimum one new state: `connected → ack →
  ready`. Possibly more elaborate.
- Latency: synchronous ack is < 1ms (same event loop tick). Async
  ack requires setup-teardown semantics.

## What I don't know

- **Whether the SDK's `invoke()` should block until ack** — this is
  the user-visible behavior. If ack is async, the SDK must
  queue or reject invocations during the ack window.
- **Whether the ack can be lost** — packets can drop. Resilient
  protocols retransmit. The Grill doesn't address retransmission.
- **Re-auth flow** — when the SDK reconnects (after a disconnect),
  the same auth dance happens. Does the ack come every time? Yes
  (no state on the server side that would skip it).
- **Connection timeout** — what if the server never sends the ack?
  The SDK's connection timeout (default 30s) handles it. The
  Grill doesn't need to address this.

## Plain-English scenario

SDK Felix opens a WebSocket. WebSocket's `onopen` fires. Felix
sends `sdk.auth`. The server verifies, registers the connection,
sends `sdk.auth.ack { applicationId: "app_01K2X8T6ZP4...",
applicationName: "analytics-prod" }`. Felix's connection state
transitions to `auth-acked`. Felix's `state()` returns
`{ connected: true, applicationId: "app_01K2X8T6ZP4...",
applicationName: "analytics-prod" }`. Felix's `invoke()` is now
safe to call.

## Skeleton answer (to be grilled)

1. **Synchronous ack.** Server sends `sdk.auth.ack` in the same
  message loop tick as the auth verification. No new state machine
  step on the SDK side beyond what already exists.
2. **SDK's `state().applicationId` is `null` only during the
  connecting window** (before the ack arrives). After ack, it's
  the server's id.
3. **No retransmission.** The ack is synchronous; if the socket
  is alive enough to receive the auth, it's alive enough to receive
  the ack.

## What blocks this

Nothing. This is a small, isolated decision.
