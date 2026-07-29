# IMPL: gateway-sdk-dispatch

**Slug:** gateway-sdk-dispatch
**Status:** Approved
**Date:** 2026-07-29

## Phase Plan

### Phase 1: package scaffold + types

**Build:**
- `agentide/packages/backend-runtime/package.json` — name `@platform/backend-runtime`, dep `ws`
- `agentide/packages/backend-runtime/tsconfig.json` — extends root `tsconfig.base.json` with `composite: true`, `outDir: dist`
- `src/types.ts` — `BackendRuntimeConfig`, `BackendRuntime`, `BackendConnection`, `RegisteredCapability`, `BackendValue` (recursive value type; replaces the planned `WireMessage` to avoid cross-package type coupling on `@platform/sdk-node` — see drift review D-29 for rationale), `ConnectionAcceptedPayload`, `ConnectionClosedPayload`, `Clock` (per-package timer abstraction matching the pattern in `@platform/gateway-core`, `@platform/session-manager`, `@platform/plugin-manager`)
- `src/index.ts` — `createBackendRuntime(config): Promise<BackendRuntime>` stub returning a no-op

**Verify:**
- [ ] `pnpm --filter @platform/backend-runtime build` succeeds
- [ ] `pnpm --filter @platform/backend-runtime test` passes (placeholder test)
- [ ] `tsconfig.json` workspace reference added at agentide root

**Blocked by:** nothing (Phase 0 GRILL locked)

### Phase 2: connection lifecycle (server + auth handshake)

**Build:**
- `src/server.ts` — `ws.Server` listening on `config.port`; on connection, buffer messages until `sdk.auth` arrives, then verify JWT against `config.tokenSecret` (same HS256 as gateway)
- `src/registry.ts` — `Map<appId, BackendConnection>`; `accept(appId, socket)`, `get(appId)`, `remove(appId)`, `replaceCaps(appId, caps)`
- `src/events.ts` — `sdk.connection.accepted { appId, gatewayUrl, latencyMs }` and `sdk.connection.closed { appId, reason }` payloads
- Wire `src/index.ts` `start()` to construct `ws.Server` and bind; `stop()` to close all sockets and shut down
- Emit `sdk.connection.accepted` on successful auth; `sdk.connection.closed` on close (with reason: `explicit` if server-initiated, `dropped` if peer-initiated unexpected)

**Verify:**
- [ ] `server.test.ts` — bad token → socket closed without `accepted` event; valid token → `accepted` event with correct `appId`
- [ ] `server.test.ts` — two SDKs with same `appId` → second replaces first (one entry in registry, both connections gone? OR last-write-wins? — replace semantics: drop first connection, register second)
- [ ] `server.test.ts` — explicit `stop()` → all sockets closed, `closed` event emitted per `appId`

**Blocked by:** Phase 1

### Phase 3: capability registration bridge

**Build:**
- `src/server.ts` (continued) — on `sdk.capability.register` message, split `permissions` comma-string, call `config.capabilityRegistry.register(appId, [{name, version, type: "business", description, permissions, owner: "backend-sdk-<appId>", tier}])`
- On `sdk.capability.register.error` message (rare async rejection from gateway → SDK), log it (no equivalent action; SDK side handles via its own `sdk.capability.rejected` bus event)
- On WebSocket close, call `config.capabilityRegistry` `removeByOwner("backend-sdk-<appId>")` to clear caps

**Verify:**
- [ ] `server.test.ts` — register 3 caps → `capability.list` (filtered by caller scope) returns them
- [ ] `server.test.ts` — close socket → `capability.list` no longer returns those caps
- [ ] `server.test.ts` — re-register after reconnect (same `appId`) → caps atomically replaced (no duplicates)

**Blocked by:** Phase 2

### Phase 4: dispatch path (sdk.invoke round-trip)

**Build:**
- `src/dispatch.ts` — `dispatchInvocation(owner, capability, input, sessionId, ctx): Promise<YamlValue>`
  - Look up connection by `owner.slice("backend-sdk-".length)`
  - Generate `callId = uuid()`
  - Send `{type: "sdk.invoke", callId, name: capability.name, input, sessionId}` over the WebSocket
  - Await response: `{type: "sdk.invoke.result", callId, payload}` → return `payload`; `{type: "sdk.invoke.error", callId, code, message}` → throw `GatewayError`
  - Map error codes: `HANDLER_NOT_FOUND → GATEWAY_CAPABILITY_NOT_FOUND`; `HANDLER_ERROR → GATEWAY_INTERNAL_ERROR`
  - Apply `config.handlerTimeoutMs` (default 30s) via `Promise.race` — on timeout, throw `GATEWAY_HANDLER_TIMEOUT { retryable: true }`
  - On socket closed mid-invoke, throw `GATEWAY_SDK_UNREACHABLE { retryable: true }`

**Verify:**
- [ ] `dispatch.test.ts` — success path: mock SDK echoes `sdk.invoke.result`, returns payload
- [ ] `dispatch.test.ts` — handler throws: mock SDK sends `sdk.invoke.error HANDLER_ERROR`, GatewayError thrown with correct code
- [ ] `dispatch.test.ts` — handler not found: `HANDLER_NOT_FOUND` → `GATEWAY_CAPABILITY_NOT_FOUND`
- [ ] `dispatch.test.ts` — handler times out: GatewayError `GATEWAY_HANDLER_TIMEOUT` after 30s
- [ ] `dispatch.test.ts` — socket closed mid-invoke: `GATEWAY_SDK_UNREACHABLE`

**Blocked by:** Phase 3

### Phase 5: wire into gateway-core dispatch

**Build:**
- `agentide/packages/gateway-core/src/dispatch.ts:90-97` — replace SDK_UNREACHABLE stub:
  ```ts
  if (owner.startsWith("backend-sdk-")) {
    if (ctx.backendRuntime === undefined) {
      throw new GatewayError(ERROR_CODES.SDK_UNREACHABLE, ...);  // backward compat
    }
    return await ctx.backendRuntime.dispatchInvocation(owner, capability, input, sessionId);
  }
  ```
- `agentide/packages/gateway-core/src/dispatch.ts:17-19` — add `backendRuntime?: BackendRuntime` to `DispatchHandlers` (or to a new `DispatchCtx` type)
- `agentide/packages/gateway-core/src/handle-invocation.ts:90-130` — thread `backendRuntime` through the dispatch ctx (read from `gateway.config` or `gateway.backendRuntime`)
- `agentide/packages/gateway-core/src/factory.ts:75-100` — `createGateway()` config gains `backendRuntime?: BackendRuntime`
- `agentide/packages/gateway-core/src/index.ts` — re-export `BackendRuntime` type for adapter users

**Verify:**
- [ ] existing dispatch tests pass (regression: stub still fires when no runtime)
- [ ] new dispatch test: with a mock BackendRuntime, `backend-sdk-*` owner routes through `dispatchInvocation`
- [ ] full `pnpm test` passes (no regressions in other gateway tests)

**Blocked by:** Phase 4

### Phase 6: agentide composition

**Build:**
- `agentide/packages/agentide/src/factory.ts` — `createPlatform()` auto-creates a `BackendRuntime` if `config.backendRuntimePort` is set
  - Pass `gateway.tokenSecret` (read from existing config) so JWTs issued by `gateway.issueToken` are accepted
  - Wire lifecycle: `backendRuntime.start()` after `gateway.start()`; `backendRuntime.stop()` before `gateway.stop()`
  - Set `gateway.config.backendRuntime = backendRuntime`
- `agentide/packages/agentide/src/types.ts` — add `backendRuntimePort?: number` to `CreatePlatformConfig`

**Verify:**
- [ ] `createPlatform.test.ts` — with `backendRuntimePort: 0` (random port), full flow: createPlatform → SDK connects → capabilities register → invoke → result returns
- [ ] `createPlatform.test.ts` — `platform.stop()` closes the Backend Runtime's WebSocket server cleanly

**Blocked by:** Phase 5

### Phase 7: drift check + reconcile

**Build:**
- Update `docs/Feature_Backlog.md` row 8b (or add it if missing) — mark shipped when verified
- Update `docs/CONTEXT.md` Decisions Log with `<date> — gateway-sdk-dispatch ship (BI[8b]) — ...`
- Spawn drift-check sub-agent per `feature-pipeline-review` skill; output to `.reports/<ts>-drift-gateway-sdk-dispatch.md`
- Resolve any gaps (code, docs, or accepted drift)
- Build post-impl sim at `docs/features/gateway-sdk-dispatch/simulate.html` — mirror real implementation, demo Scenario 1-8
- Reconcile pre-impl + post-impl into one canonical `simulate.html`; archive `simulate-pre.html`

**Verify:**
- [ ] Drift report exists at `.reports/2026-07-29-drift-gateway-sdk-dispatch.md`
- [ ] All gaps resolved or logged
- [ ] Post-impl sim runs all 8 scenarios
- [ ] `pnpm test` passes (full repo, target +50 tests)

**Blocked by:** Phase 6

## Phase Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6 ──→ Phase 7
  scaffold   lifecycle   registry    dispatch    kernel     agentide    ship
                                              wiring   composition
```

Linear; no parallel opportunities within this pack. (mcp-adapter can run in parallel as a separate pipeline instance per the architecture docs' "Tiers 2-5 parallel opportunity" note, but it won't be useful until Phase 5 of this pack lands.)

## Test Strategy

- **Unit tests** at `packages/backend-runtime/src/__tests__/`:
  - `server.test.ts` — auth handshake, multi-connection, replace semantics
  - `registry.test.ts` — connection map, cap storage, replace-on-reconnect
  - `dispatch.test.ts` — success/error/timeout/closed paths using a `vi.fn()`-backed mock socket
- **Integration test** at `packages/agentide/src/__tests__/backend-runtime.test.ts`:
  - Stand up `createPlatform()` with `backendRuntimePort: 0` (auto-assign)
  - Connect a fake SDK over WebSocket (use `ws` client)
  - Send `sdk.auth` + 3 `sdk.capability.register`
  - Invoke via `gateway.handleInvocation`
  - Assert result + audit record + bus events
- **Regression**: all existing gateway-core tests pass without modification (the SDK_UNREACHABLE stub is preserved as fallback when `backendRuntime` is undefined).

Test runner: vitest (workspace default). `pnpm test` runs all packages; `pnpm test --filter @platform/backend-runtime` runs only this pack.

## Dependency Analysis (opensrc)

**`ws`** — WebSocket server library
- **Version:** latest 8.x (same major as sdk-node's dep)
- **License:** MIT
- **Maintenance:** very active (npm ~30M weekly downloads), stable API since 7.x
- **Why this dep:** needed to accept WebSocket connections on the gateway side; without it, we'd hand-roll the HTTP Upgrade handshake, frame parsing, and per-connection lifecycle
- **Alternatives considered:**
  - Node's built-in `http` + `Upgrade: websocket` handling — rejected: `ws` is the de-facto standard, has reconnect helpers we don't need, and is already a dep of `@platform/sdk-node` (consistent transport layer across both sides)
  - `socket.io` — rejected: heavier protocol, has its own framing; we need raw WebSocket for SDK compat
- **Call pattern:** we use `ws.Server({port})` + `socket.on('message')` + `socket.send(JSON.stringify(...))` — standard library usage, not their custom abstractions

## Rollout

- New package `@platform/backend-runtime` lands in `packages/backend-runtime/`
- Workspace reference added at root `tsconfig.json`
- `pnpm install` adds `ws` to root lockfile
- `dispatch.ts` change is additive (new optional ctx field); backward-compatible with existing tests
- No flag flips; no migration needed
- `feature-backlog-data.js` Tier 3 needs `BI[8b]` added — but `BI[8b]` doesn't exist yet (the explore agent confirmed only BI[8], BI[9], BI[10], BI[23], BI[24] are in Tier 3). I'll create `scripts/backlog/gateway-sdk-dispatch.js` to define it, add it to Tier 3 in `feature-backlog-data.js`, and add a `<script>` tag to `Feature_Backlog.html`. (Done at end of Phase 7.)

## Risk Notes

- **`CapabilityRegistry.register()` is synchronous today.** Each SDK `sdk.capability.register` triggers one sync `register()` call. For an SDK registering 50 caps, that's 50 sync calls. Acceptable for v1; revisit if profiling shows hot path.
- **JWT verification uses HS256.** Same shared secret as the Gateway. If the secret leaks, anyone can mint valid SDK tokens. Document this in the README and the security section of the post-impl sim.
- **WebSocket connections held in-memory.** A Gateway restart drops every SDK connection. SDKs reconnect via their existing 30s backoff; no data loss (capability state is in the registry, which is also in-memory; restart wipes it). Document as v1 limitation.
- **No request ID propagation.** `callId` is generated by the Backend Runtime; the audit log records it via the standard `gateway.invocation` event but doesn't link it back to the SDK-side event. Operators correlating an SDK log with a gateway audit entry must use the timestamp + capability name. Acceptable for v1.
- **`@platform/sdk-node`'s `permissions` field is comma-joined string on the wire** (`index.ts:148`), not array. The Backend Runtime MUST split on receive. Easy to miss — write a unit test that registers a cap with `permissions: "a,b,c"` and verifies the registry has `["a","b","c"]`.