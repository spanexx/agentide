# SDK behavior change (sdk-node + sdk-browser)

**Type:** `wayfinder:research` (AFK)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** T7

## Resolution

**Artifact:** `docs/wayfinder/application-entity/research/sdk-behavior-change.md`
(produced during feature-pipeline). The skeleton in this ticket
already enumerates the seven research questions — the artifact
fills them in by reading both SDKs.

**Skeleton (already locked):**

1. **sdk-node WebSocket client** — must consume `sdk.auth.ack`. Code
   outline for the new consumer.
2. **sdk-node state object** — `state()` adds `applicationId`,
   `applicationName`.
3. **sdk-node registration** — no change.
4. **sdk-node reconnect path** — re-mint via `auth.token.issue` (not
   cached on disk).
5. **sdk-browser** — same questions, browser-native transport.
6. **Backward-compat matrix** — old SDK vs new server, new SDK vs
   old server.
7. **Wire-version consumer** — if T5 adds a `protocolVersion` field,
   the SDK reads it.

**Tag:** `delivery: feature-pipeline` — the artifact is produced
  inside the feature-pipeline run, alongside the PRD-TRD that
  consumes its findings.

## Question

What does this map's downstream change require of `sdk-node` and
`sdk-browser` clients — code changes, wire changes, state shape
changes, persistence changes — and what's the minimum delta to
make the new server work?

## What I know

- `packages/sdk-node/src/client.ts` — the WebSocket client. Auth
  handshake is `socket.send(JSON.stringify({type: "sdk.auth", token}))`
  after `onopen`. No `sdk.auth.ack` consumer.
- `packages/sdk-node/src/invoke.ts` — the invocation handler. Uses
  `CallContext.token` directly.
- `packages/sdk-node/src/index.ts` — the public API
  (`createSdk`/`connect`/`register`/`invoke`/`disconnect`/`reset`/`state`).
  `state()` returns connection state. Today no `applicationId` field.
- `sdk-browser` is on the Wayfinder map `docs/wayfinder/sdk-browser/`
  with T5 (WebSocket transport) closed — auth is also first-message
  body.
- The Grill (Q4, Q5) locked: wire protocol unchanged on the SDK
  request side, but `sdk.auth.ack` becomes a new outbound message
  the SDK must handle.

## What to produce

A markdown file `docs/wayfinder/application-entity/research/sdk-behavior-change.md`
with:

1. **sdk-node WebSocket client** — does it need to consume
   `sdk.auth.ack`? Code outline for the new consumer.
2. **sdk-node state object** — does `state()` add `applicationId`,
   `applicationName` fields?
3. **sdk-node registration** — does `register()` need any change?
4. **sdk-node reconnect path** — after `disconnect()` then `connect()`,
   does the SDK re-use the cached `applicationId`? Or does it
   always re-mint via `auth.token.issue`?
5. **sdk-browser** — same questions, browser-native transport.
6. **Backward-compat matrix** — old SDK vs new server, new SDK vs
   old server. What fails, what works, what's a warning.
7. **Wire-version consumer** — if T5 adds a `protocolVersion` field,
   which of these changes need to consume it?

## What blocks this

T1-T5 should be locked so the research knows the exact wire shape,
JWT claim shape, and timing.
