# IMPL: WebSocket Adapter

**Slug:** websocket-adapter
**Status:** Approved
**Date:** 2026-08-03
**PRD-TRD:** [PRD-TRD-websocket-adapter.md](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/websocket-adapter/PRD-TRD-websocket-adapter.md)
**GRILL:** [GRILL-websocket-adapter.txt](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/websocket-adapter/GRILL-websocket-adapter.txt)

## Phase Plan

**Before Phase 1:** no new external deps — `ws` ^8.18.0 is already vendored and
used in-tree by `@platform/backend-runtime`; `event-bus` + `gateway-core` are
workspace packages. opensrc ALREADY DONE — `ws` 8.21.1 source fetched and
findings recorded in Dependency Analysis below (maxPayload→1009 automatic,
connection(req) origin capture, autoPong heartbeat, bufferedAmount getter).
The adapter receives the raw HS256 `Uint8Array` secret, matching
`gateway-core` and `backend-runtime`; it does not decode or mint tokens.

### Phase 1: Types + error codes

**Build:**
- `packages/adapter-websocket/src/types.ts` — `WebSocketAdapterConfig` (host
  default 127.0.0.1, port default 7300, tokenSecret, clock?, maxBufferedBytes
  1_048_576, maxFrameBytes 1_048_576, statsIntervalMs 1000, preAuthTimeoutMs
  30000, heartbeatIntervalMs 30000, heartbeatTimeoutMs 10000) + `ConnectionRecord`
  + wire frame types (16-frame envelope, PRD-TRD §Data Models).
- `packages/adapter-websocket/src/errors.ts` — `WS_INVALID_TOPIC`,
  `WS_FORBIDDEN`, `WS_INVALID_FRAME`, `WS_INTERNAL`, `WS_FRAME_TOO_LARGE`
  (PRD Scenario 12 + W4 sub-Q 3).

**Verify:**
- [ ] `tsc --build` clean; `errors.ts` exports the 5 WS_* codes, none clash with
      `@platform/errors` GATEWAY_* names.
- [ ] Unit test: config defaults resolve to the locked constants (7300, 1 MiB × 2,
      1000ms, 30s × 2).

**Blocked by:** nothing

### Phase 2: Auth (verify + origin binding + pre-auth state machine)

**Build:**
- `src/auth.ts` — `verifyToken(token, clock, secret)` from gateway-core;
  `originMatches(origin, expected)` — exact OR single-label `*.` wildcard,
  right-anchored (RFC 6125 §6.4.3: `https://*.acme.com` matches
  `https://app.acme.com`; rejects zero-label, multi-label, typo-squats);
  pre-auth flow: only `auth` processed, others silently dropped; 30s timeout →
  close 1008; auth.error codes `token missing|invalid|expired|origin mismatch|tenant suspended`;
  refresh = atomic claim swap, carries subs/in-flight/queue/connectionId, emits
  `event.connection.rotated` on internal bus (NOT relayed).

**Verify:**
- [ ] Unit tests: originMatches table (exact ✓, wildcard ✓, zero-label ✗,
      multi-label ✗, typo-squat ✗, Node null-origin bypass ✓, deny-by-default ✗).
- [ ] Unit tests: pre-auth drops non-auth frames silently; timeout → 1008;
      refresh carries subs + queue + connectionId; rotated event emitted.

**Blocked by:** Phase 1

### Phase 3: Registry

**Build:**
- `src/registry.ts` — `ConnectionRegistry`: add/remove/get, snapshot-iterate
  (for stop()), prune-on-close (subs + queue), connectionId assignment.

**Verify:**
- [ ] Unit tests: open/close/prune semantics; stop() snapshot+clear.

**Blocked by:** Phase 1

### Phase 4: Fan-out (per-connection × pattern subscriptions)

**Build:**
- `src/fanout.ts` — per (connection × pattern) `eventBus.subscribe(pattern,
  handler)` returning unsubscribe handle stored on the record; relay handler
  enqueues frame and returns immediately (NEVER awaits socket.send — bus
  dispatches with Promise.allSettled); `event.*` filtered at fan-out
  (defense-in-depth); per-pattern authz at subscribe time via
  `checkAuthz(claims.scope, ["platform.<firstSegment>.read"])` (bare `*` →
  `platform.*.read`); subscribe batch all-or-nothing; idempotent dedupe;
  unsubscribe of never-subscribed → ok (no error).

**Verify:**
- [ ] Unit tests (mock event-bus): relay matches only subscribed patterns;
      event.* filtered; authz derived permission (session.* → platform.session.read,
      bare * → platform.*.read); all-or-nothing batch; dedupe; unsubscribe idempotent.
- [ ] Verify relay handler is sync-return (no await send) — code review.
- [ ] `validatePattern` is imported from the public `@platform/event-bus` root export;
      see D-51.

**Blocked by:** Phases 1-3

### Phase 5: Invoke translation (call + stream wrapper)

**Build:**
- `src/invoke.ts` — `{type:"invoke", correlationId, name, input?, sessionId?,
  mode:"call"|"stream"}` → `gateway.handleInvocation({token, capability:{name},
  input, sessionId})`; response mapping: output → `invoke.result`; error →
  `invoke.error` with gateway/capability code passthrough (no third vocabulary);
  correlationId echoed verbatim; stream mode wraps single-shot kernel call into
  `invoke.partial` × N + `invoke.end` (adapter-level streaming; partials ride the
  same outbound queue).

**Verify:**
- [ ] Unit tests (mock gateway): result mapping, error passthrough (custom code
      e.g. SESSION_NOT_FOUND passes verbatim), missing correlationId/name →
      WS_INVALID_FRAME, invalid mode → WS_INVALID_FRAME, stream emits
      partial(s)+end with correlationId echoed.
- [ ] `invoke.partial` goes through `enqueue` (backpressure applies) — code review.

**Blocked by:** Phase 1, 3

### Phase 6: Backpressure (FIFO queue + stats recovery)

**Build:**
- `src/queue.ts` — per-connection outbound FIFO; `enqueue(frame)`: while
  `bufferedBytes > maxBufferedBytes` shift head (drop oldest, keep newest),
  increment cumulative `dropped`; arm `statsIntervalMs` timer on first drop →
  emit `{type:"stats", dropped:N}` then disarm (rate-limited ~1/s);
  drain by `socket.send` on the socket's own backpressure (writable) —
  bufferedBytes decremented on successful write.

**Verify:**
- [ ] Unit tests (fake socket with controllable drain): FIFO drops oldest first;
      dropped cumulative monotonic; stats emitted ~1s after first drop, then
      disarmed; recovery after drain.
- [ ] Buffer never exceeds maxBufferedBytes (invariant test).

**Blocked by:** Phase 1

### Phase 7: Server + factory (createWebSocketAdapter)

**Build:**
- `src/protocol.ts` — `parseClientFrame` parses raw JSON into the typed
  `ParsedClientFrame` union (`ClientFrame | AuthCandidate | InvalidFrame`).
  `AuthCandidate.token` may be undefined so `authenticateToken` can map the
  locked "token missing" phrase 1:1 to the wire.
- `src/server.ts` — `createWebSocketAdapter(gateway, eventBus, cfg): Adapter`
  (`name: "adapter-websocket"`, `start()`, `stop()`); `ws.WebSocketServer` with
  `maxPayload: maxFrameBytes` (inbound cap → close 1009, zero adapter code);
  upgrade captures `req.headers.origin`; heartbeat: server ping every
  `heartbeatIntervalMs`, no pong within `heartbeatTimeoutMs` → close 1011;
  outbound over-cap → `{type:"error", code:"WS_FRAME_TOO_LARGE"}` + close 1009;
  `stop()`: snapshot registry, unsubscribe all bus handles, close sockets, clear
  timers, close server.
- `src/index.ts` — re-exports (types, errors, createWebSocketAdapter, registry,
  originMatches re-export).

**Verify:**
- [ ] Integration test (real `ws` client, real event-bus, mock gateway):
      connect → pre-auth → auth.ok; subscribe → bus publish → event relayed;
      invoke result; close → prune. Close codes 1008/1009/1011 asserted.
- [ ] `stop()` releases the port; no dangling handlers (process exits cleanly).
- [ ] Full suite green: `npm run test -w @platform/adapter-websocket`.

**Blocked by:** Phases 2-6

### Phase 8: agentide wiring (adapterWs)

**Build:**
- `packages/agentide/src/factory.ts` — auto-create ws adapter when
  `config.adapterWs !== false` (default ON like MCP); `wsPort?` default 7300;
  start after gateway + backend-runtime; stop in reverse (ws first); expose
  `platform.wsAdapter`. Reuse the bootstrapped secret bytes.
- `packages/agentide/src/types.ts` — `adapterWs?: boolean`, `wsPort?: number`,
  `adapterWsHost?: string` (default 127.0.0.1).
- `packages/agentide/src/cli.ts` — CLI opts out (`adapterWs: false`, same
  port-binding-race reason as MCP).
- `packages/agentide/src/index.ts` — re-export adapter types.
- `packages/agentide/src/__tests__/websocket-adapter.test.ts` — wiring tests
  mirroring `mcp-adapter.test.ts` (auto-register, port 0 = OS-assigned, stop
  releases port, `adapterWs:false` suppresses).

**Verify:**
- [ ] `npm run test -w @platform/agentide` — websocket-adapter.test.ts green.
- [ ] E2E smoke: createPlatform with wsPort 0 → connect real ws client → auth →
      invoke `capability.list` → result; stop() clean.

**Blocked by:** Phase 7

### Phase 9: Post-impl sim (drives real adapter)

**Build:**
- `packages/agentide/scripts/simulate-websocket-adapter.mjs` — different script
  from `simulate-pre.html`; drives the REAL adapter (mirror mcp-adapter's
  `simulate-mcp-adapter.mjs` pattern); covers PRD Scenarios 1-14 per Simulation
  Contract.

**Verify:**
- [ ] Script runs headless against a booted platform; asserts scenario
      outcomes (auth.ok, relay, invoke result/partial, stats, 1008/1009/1011).
- [ ] Every PRD scenario 1:1 mapped (checklist in script header).

**Blocked by:** Phase 8

## Phase Dependencies

```
P1 types/errors → P2 auth → P4 fanout → P7 server → P8 agentide → P9 post-impl sim
                ↘ P3 registry ↗        ↘ P5 invoke  ↗
                   P6 queue ────────────────────────↗
```

## Open Drift

- **D-50 (High):** Browser tokens cannot yet carry `expectedOrigins`; the adapter
  enforces deny-by-default for browser Origins. Dashboard owns mint-side repair.
- **D-52 (Low):** The websocket-adapter work temporarily replaced a shipped
  `verifyToken` leeway test. Test was restored the same session (drift logged).

## Closed Drift

- **D-51 (Medium, Resolved 2026-08-03, websocket-adapter):** `validatePattern`
  now exported at `packages/event-bus/src/index.ts` and consumed by the
  adapter's fan-out module.

## Test Strategy

- Vitest per package convention; TDD red-green per phase.
- `packages/adapter-websocket/src/__tests__/` — unit files per module
  (auth, registry, fanout, invoke, queue) + one integration file (server).
- Real `ws` client for integration; mock `Gateway` (mock `handleInvocation`)
  for translation; real `createEventBus()` for fan-out.
- Runs: `npm run test -w @platform/adapter-websocket`; agentide wiring via
  `npm run test -w @platform/agentide`.
- Gate: every phase's Verify checkboxes must pass before the next phase starts.

## Dependency Analysis (opensrc)

No new external deps — `ws` is already a runtime dep of `@platform/backend-runtime`
and is fetched via the opensrc skill so the implementation phase reads real
internals, not just types.

```bash
opensrc path ws --cwd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide
# → ~/.opensrc/repos/github.com/websockets/ws/8.21.1  (auto-resolved from pnpm-lock.yaml)
```

**opensrc findings (ws 8.21.1, all verified in source):**
- **`maxPayload` → 1009 is automatic.** `websocket-server.js` passes
  `options.maxPayload` into each `Receiver`; `receiver.js` (lines 420/446-447/
  555-556) closes with `1009 WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` on oversized
  inbound messages. Zero adapter code for the inbound cap — do NOT double-handle.
  NOTE: default is **100 MiB** (websocket-server.js:74) — we MUST pass our
  `maxFrameBytes` (1 MiB) explicitly.
- **Upgrade `Origin` capture:** the `connection` event signature is
  `(ws, req)` (`completeUpgrade` → `emitConnection(ws, req)`), so
  `req.headers.origin` is captured at upgrade time with zero extra wiring.
  (Fallback: `verifyClient(info)` also exposes `info.origin`.)
- **Heartbeat:** `autoPong` defaults to `true` (websocket.js:670, 1251 —
  incoming ping → automatic pong); server-initiated heartbeat is
  `socket.ping()` + listen `socket.on('pong')` (websocket.js:1262 emits
  `'pong'`), missed-pong counter → close 1011. Our design is protocol-level
  only — no app-level pong frame.
- **Backpressure:** `ws.bufferedAmount` getter (websocket.js:120-124) =
  `socket._writableState.length + sender._bufferedBytes` (kernel write backlog
  + ws sender pending) — available for finer-grained v2 backpressure; v1 uses
  our own byte-budget FIFO (`maxBufferedBytes`) so this getter is optional.
- **License MIT, maintained, single-file core** (`lib/websocket-server.js`,
  `lib/websocket.js`, `lib/receiver.js`, `lib/sender.js`) — vendored in-tree
  at `packages/backend-runtime/node_modules/ws` already; no opensrc fetch
  needed again unless we bump versions.

Other deps: `@platform/event-bus` (`matches`, `validatePattern`),
`@platform/gateway-core` (`verifyToken`, `checkAuthz`, `Adapter`) — workspace
packages, read in-tree.

## Rollout

- New package `@platform/adapter-websocket`; no existing behavior replaced.
- Default ON in `createPlatform` (mirrors MCP); CLI opts out. Existing MCP/HTTP
  doors untouched. Port 7300 confirmed 2026-08-03.
- D-50 (expectedOrigins minting) is NOT this pack's scope — the adapter
  enforces the claim; browser clients stay denied until dashboard IMPL lands
  the mint. Do not block this pack on D-50.

## Risk Notes

- **Origin matching bug class:** slice-based wildcard matching ate the `h` of
  `https://` in the pre-impl sim (fixed there). Implement `originMatches` as
  split-at-`*.` from the start and port the sim's tested table to unit tests.
- **Never await `socket.send` in bus handlers** — the bus dispatches with
  `Promise.allSettled`; a slow socket must only enqueue.
- **`ws` maxPayload** closes with 1009 automatically — do NOT double-handle in
  the message path.
- **Refresh must not re-authorize/prune subs** (W3 sub-Q 5) and must not abort
  in-flight invokes (W2 sub-Q 3).
- **Sim contract:** post-impl sim must differ from the pre-impl sim script
  (pipeline requirement).
- After each phase, update `docs/Feature_Backlog.md` + run `update-backlog`
  skill; run `feature-pipeline-review` before marking SHIPPED.
