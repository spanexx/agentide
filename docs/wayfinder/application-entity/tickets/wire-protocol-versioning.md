# Wire protocol versioning at this refactor

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** T6, T7

## Resolution

**Add a `protocolVersion` field to the wire messages.** Default `1`
for the current protocol. The new server's `sdk.auth.ack` message
carries `protocolVersion: 1`. The SDK reads and forwards to the
platform.

- **Backward-compat is implicit, not negotiated.** Old SDKs that
  don't send a version get the v1 protocol (backward compatible).
  Old servers that don't expect a version accept the request.
- **Forward-compat is a future pack.** When the v2 protocol lands,
  the SDKs and gateways negotiate then.
- The cost is one field per message. The benefit is future versions
  can fail loudly instead of silently dropping.

**Rules out:**
- No version field (audit Section 3.5's concern).
- Mandatory version handshake (breaks the implicit backward-compat
  story; forces a coordinated rollout).
- Separate version message (one field in the existing payload is
  cheaper than a message).

**Tag:** `delivery: decision-only` — versioning locked.

## Question

The audit (Section 3.5) flagged absent wire protocol versioning as
a HIGH design concern. Does this map's refactor — which adds
`sdk.auth.ack`, `sdk.auth.error`, and a new `applicationId` token
claim — also introduce a wire protocol version field, or do we
defer that to a separate pack?

## What I know

- The audit Section 3.5 describes the issue: SDKs and Gateway
  communicate via JSON messages, but no version negotiation. A
  v2.0 SDK connecting to a v1.0 Gateway would send unrecognized
  messages and silently fail.
- The Grill Q4 locked: wire protocol unchanged on the SDK wire
  side (the SDK still sends `{type: "sdk.auth", token}`). The server
  *adds* a new message (`sdk.auth.ack`). The SDK must understand
  the new message; the old SDK doesn't.
- The Grill Q5 locked: capability owner format changes from
  `backend-sdk-${appId}` to `backend-sdk-${tenantId}:${applicationId}`,
  server-side. The SDK doesn't see the owner string.
- The Grill did NOT address wire versioning explicitly.
- The trade-off: adding a version field is a wire-protocol change
  in itself. It doesn't help backward compatibility (the v1 SDK
  doesn't know to send a version). It only helps FUTURE versions
  negotiate.

## What I don't know

- **Whether the version field is worth the wire cost** — a 1-byte
  version field is cheap. The complexity is the SDK's expected
  behavior on version mismatch.
- **The protocol version is the wire-protocol version, not the
  package version.** A v1.0 backend-runtime and a v1.2 sdk-node
  might have the same wire protocol. The package version is in
  the npm metadata; the wire version is in the protocol.
- **Semver for the wire protocol** — does a non-breaking addition
  (new optional message) bump the wire version, or only breaking
  changes? Conventions vary.
- **The audit's framing** — Section 3.5 imagines "Sarah upgrades
  her SDK to v2.0, which sends a new message format. The Gateway
  v1.0 expects v1.0 format. The Gateway silently drops the message."
  This is the BACKWARD-COMPAT case (new SDK, old gateway). The
  refactor we're doing is the FORWARD-COMPAT case (new gateway
  extension, new SDK).

## Plain-English scenario

Operator Maria upgrades her agentide to 1.0 (the new Application
entity). The wire protocol adds `sdk.auth.ack`. Her SDKs are
also upgraded to 1.0 (per the feature pipeline's downstream
chore). No version field is needed because both ends are
coordinated.

Six months later, a v2 SDK is released. It sends a new wire
message. The v1 gateway doesn't know about it. The v1 gateway
silently drops the new message. The v2 SDK's features don't work
on the v1 gateway.

A version field would have prevented this — the v2 SDK would
have sent `protocolVersion: 2`, the v1 gateway would have
rejected with `PROTOCOL_VERSION_MISMATCH`, and the SDK would
have shown a clear error.

## Skeleton answer (to be grilled)

1. **Add a `protocolVersion` field to the wire messages.** Default
  `1` for the current protocol. The new server's `sdk.auth.ack`
  message carries `protocolVersion: 1`. The SDK reads and forwards
  to the platform.
2. **Backward-compat is implicit, not negotiated.** Old SDKs that
  don't send a version get the v1 protocol (backward compatible).
  Old servers that don't expect a version accept the request.
3. **Forward-compat is a future pack.** When the v2 protocol lands,
  the SDKs and gateways negotiate then.
4. **The cost is one field per message.** The benefit is future
  versions can fail loudly instead of silently dropping.

## What blocks this

None. This is a small, isolated decision.
