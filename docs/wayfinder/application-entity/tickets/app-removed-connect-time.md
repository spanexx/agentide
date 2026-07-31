# App-removed connect-time behavior

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** T6

## Resolution

**Permissive default**: accept the connection, immediately close with
`1000 application-removed`. The token's signature is the trust anchor;
the removal is a runtime signal, not an identity check.

- **No cross-check on every connect.** The Application store is the
  source of truth for *active* connections (the registry). Once a
  connection is registered, the runtime protects it (close on
  removal). Pre-registered cross-check is rejected as latency-cost
  with minimal security gain.
- **The error contract**: SDK sees `sdk.auth.error { code:
  APPLICATION_REMOVED }` followed by close. The SDK's error handler
  logs and exits; the operator re-issues a token.

**Rules out:**
- Strict pre-registered cross-check (DB hit per connect; latency cost).
- Silent acceptance (driver would keep stale connections serving).

**Tag:** `delivery: decision-only` — behavior locked.

## Question

When an SDK connects with a token whose `applicationId` references
an Application that has since been removed, does the server accept
the connection (and immediately close with `application-removed`)
or reject the auth handshake outright?

## What I know

- The Grill Q9 locked: *runtime* behavior on removal — close
  connections, reject pending invocations with
  `GATEWAY_APPLICATION_REMOVED`.
- The connect-time path is silent in the Grill. Today, the server
  doesn't consult the Application store at all (because there's no
  Application store). With the Application store in place, the
  server has a choice: trust the token's signature, or cross-check
  the store.
- Two attack surfaces:
  - **Token without store cross-check**: an operator removes an
    Application but an old token still has a valid signature. The
    token is valid until natural expiry. The server can't know it's
    removed without looking at the store.
  - **Token with store cross-check**: every connect requires a DB
    hit. Adds latency. Adds a new failure mode (store flaky).
- This is the architectural mirror of token revocation (audit
  Section 1.5). The Grill didn't address revocation; the audit did.
  This ticket is the minimal resolution: cross-check OR don't?
- The token's `applicationId` is in the JWT signature. If the JWT
  verifies, the id is what the platform issued at issuance time.
  Cross-check is a freshness check, not an identity check.

## What I don't know

- **Latency budget** — a cross-check on every connect is a DB hit.
  Server might process 1000 connections per second. Each cross-check
  is a JSON file read or a Redis lookup.
- **The audit's "no revocation" argument** — the audit notes that
  today's `auth.token.revoke` is a no-op. Does the Application
  deletion implicitly satisfy revocation? Or is it a separate
  concern?
- **The remediation path** — if the cross-check fails, the SDK sees
  `GATEWAY_APPLICATION_REMOVED`. The SDK then re-issues a token
  via `auth.token.issue` (which auto-provisions if the operator
  wants). The flow is: removed → re-token → re-connect.
- **Event ordering** — operator removes at T=0, SDK connection at
  T=1s. The remove event fired at T=0; the SDK's TCP socket is
  still open. The server has to notice the removal. With
  in-memory state, the server runtime check at connect time is
  the only signal.

## Plain-English scenario

Operator Maria deletes an Application at 14:00:00. The server
fires `application.removed`, closes the connected SDK's socket
with `1000 application-removed`. The SDK gets the close, exits.
Twenty minutes later, an automation restart of the SDK process
dials the server with the same token. The server's auth handler
cross-checks the Application store: the id is unknown. The server
rejects with `GATEWAY_APPLICATION_REMOVED`. The SDK logs the
error, exits.

Alternative (permissive): the server accepts the connection,
registers under the unknown id, immediately closes with
`application-removed`. The SDK sees `closed` and exits.

## Skeleton answer (to be grilled)

1. **Permissive default**: accept the connection, immediately close
  with `1000 application-removed`. The token's signature is the trust
  anchor; the removal is a runtime signal, not an identity check.
2. **No cross-check on every connect.** The Application store is the
  source of truth for *active* connections (the registry). Once a
  connection is registered, the runtime protects it (close on
  removal). Pre-registered cross-check is rejected as latency-cost
  with minimal security gain.
3. **The error contract** — SDK sees `sdk.auth.error { code:
  APPLICATION_REMOVED }` followed by close. The SDK's error handler
  logs and exits; the operator re-issues a token.

## What blocks this

T2 (provisioning flow). If the server auto-provisions on connect,
the "unknown id" case collapses — auto-provision takes the
`applicationId` from the token and creates the record.
