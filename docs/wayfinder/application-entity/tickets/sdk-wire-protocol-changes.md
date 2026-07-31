# sdk-node + sdk-browser wire-protocol changes

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** (delivery)

## Resolution

**Six concrete SDK changes** (mirrored across `@platform/sdk-node`
and `@platform/sdk-browser`):

1. `connect()` awaits `sdk.auth.ack` before resolving. The ready
   state requires the ack.
2. `state()` adds `applicationId: string | null` and
   `applicationName: string | null` fields (null only during the
   brief connecting window).
3. **No on-disk persistence** of `applicationId` — the token is the
   source of truth, and operators control token rotation.
4. `sdk.auth.error` is terminal for that connection attempt. The
   SDK logs the code and exits (operator must fix the token).
5. **No new EventBus event.** State already reflects the auth result.
6. sdk-browser mirrors all of the above; transport is
   `globalThis.WebSocket`.

**Rules out:**
- Persisting `applicationId` to disk (rotation drift between cache
  and token).
- New lifecycle event (`sdk.authenticated`) — adds noise without
  surfacing new info.
- Retry on `sdk.auth.error` — auth failure is a different layer from
  socket reconnect.

**Tag:** `delivery: feature-pipeline` — the SDK delta is the
  feature-pipeline PRD-TRD input.

## Question

What is the exact change set for `@platform/sdk-node` and
`@platform/sdk-browser` to work with the new server (Application
entity, `sdk.auth.ack`, optional `protocolVersion` field,
`applicationId` in token claims)?

## What I know

- The current sdk-node source is `packages/sdk-node/src/`. The
  PR-then-doc workflow has produced 8 events, `createSdk` factory,
  `connect`/`register`/`invoke`/`disconnect`/`reset`/`state` public
  API.
- The wire protocol is identical to `backend-runtime`'s server: enums
  for `sdk.auth`, `sdk.invoke`, `sdk.invoke.result`, `sdk.invoke.error`,
  `sdk.capability.register`, `sdk.capability.register.error`.
- The sdk-node Wayfinder map exists for the BI[8] work. Closed
  tickets documented the transport and reconnection details.
- The Grill (Q4) locked: the `sdk.auth.ack` message is added; the
  `sdk.auth` request is unchanged.
- T5 (this map) decides whether to add `protocolVersion` to the wire.
- T6 (this map) is the research that surfaces the SDK delta.

## What I don't know

- **Whether the SDK's `connect()` should block until `sdk.auth.ack`
  arrives**, or fire-and-forget. The state machine today is
  `connecting → connected → ready`. The ack might add a
  `ready-acknowledged` step.
- **Whether the SDK should retry the auth on `sdk.auth.error`** or
  treat it as terminal. The library's reconnect logic is for the
  socket; auth failure is a different layer.
- **Persistence** — should the SDK write `applicationId` to a local
  file (e.g., `~/.agentide/<tenantId>/<appId>.json`) so reconnects
  show the same id in logs even when the token is fresh? Or rely
  on the token's claim?
- **EventBus event surfacing** — the SDK already publishes
  `sdk.connected` / `sdk.disconnected`. With the ack, does an
  `sdk.authenticated` event make sense? The state already changes
  on `sdk.connected`; re-emitting on auth adds noise.
- **How the SDK uses the received `applicationId`** — the
  `state()` method exposes it. The `invoke()` doesn't need it
  (the token carries it). The `register()` doesn't need it. So the
  id is informational, not functional.

## Plain-English scenario

User Felix has `@platform/sdk-node` v1.0 running his analytics
service. Each process holds one token, connects, registers one
capability. Today the SDK logs `connected` on auth. Tomorrow the
SDK logs `connected { applicationId: app_01K2X8T6ZP4..., applicationName:
analytics-prod }`. The state becomes richer. His CI uses the SDK's
exit-on-`disconnect` to roll back rolling deploys — no change.

## Skeleton answer (to be grilled)

1. `connect()` awaits `sdk.auth.ack` before resolving. The ready
   state requires the ack.
2. `state()` adds `applicationId: string | null` and
   `applicationName: string | null` fields (null only during the
   brief connecting window).
3. The SDK does NOT persist `applicationId` to disk — the token is
   the source of truth, and operators control token rotation.
4. `sdk.auth.error` is terminal for that connection attempt. The
   SDK logs the code and exits (operator must fix the token).
5. No new EventBus event. State already reflects the auth result.
6. SDK-browser mirrors all of the above.

## What blocks this

T6 (research). T5 (wire version).
