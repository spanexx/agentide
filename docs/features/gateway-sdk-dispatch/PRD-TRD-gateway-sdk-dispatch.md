# PRD-TRD: gateway-sdk-dispatch

**Slug:** gateway-sdk-dispatch
**Status:** Approved
**Date:** 2026-07-29

## Why This Exists

`@platform/sdk-node` shipped 2026-07-29. A developer can `createSdk()`, register business capabilities, emit 8 lifecycle events, and run handlers. But the Gateway (`@platform/gateway-core`) cannot invoke those capabilities: today `gateway-core/src/dispatch.ts:90-97` throws `GATEWAY_SDK_UNREACHABLE` for any owner starting with `backend-sdk-`.

The architecture (`docs/architecture/Agentide.md` §6) defines the Backend SDK role end-to-end. Today only the SDK side ships. The connection half — the piece that lives inside the Gateway and bridges to the SDK — is missing. Without it, every business capability that an app registered is unreachable from the platform.

The cost of leaving this unsolved: the MCP adapter (next pack, BI[9]) and any external caller successfully translate requests into the canonical invocation shape, but every `business.*` call returns `GATEWAY_SDK_UNREACHABLE`. No business capability ever works. The platform looks fully built but is functionally half-wired on the inbound path.

## Behavioral Spec

### Scenario 1: SDK connects and the Backend Runtime accepts the connection

**Given** the Gateway is running with `config.backendRuntimePort = 9100`; an SDK instance is configured with `appId = "customer-app"` and a valid JWT
**When** the SDK opens a WebSocket and sends `{type: "sdk.auth", token: "<jwt>"}`
**Then** the Backend Runtime verifies the JWT (HS256, same key as `gateway.issueToken`), stores the connection keyed by `appId`, and emits `sdk.connection.accepted` on the Event Bus with `{appId, gatewayUrl, latencyMs}`. The connection count goes from 0 to 1.

### Scenario 2: SDK registers business capabilities

**Given** Scenario 1 just completed; the SDK has a manifest with three handlers: `customer.read`, `customer.delete`, `customer.list`
**When** the SDK sends one `{type: "sdk.capability.register", name, description, version, permissions, tier}` per handler
**Then** the Backend Runtime registers each capability in the Capability Registry with `owner: "backend-sdk-customer-app"` and `type: "business"`, and emits `sdk.capability.registered` on the bus for each. The catalog now has 3 new entries visible to a `capability.list` caller with `customer.*` scope.

### Scenario 3: an external call invokes a business capability end-to-end

**Given** Scenarios 1 and 2 just completed; an MCP client (BI[9]) sends a `tools/call` for `customer.read` with `{id: "c-042"}`
**When** the adapter calls `gateway.handleInvocation({token, capability: {name: "customer.read"}, input: {id: "c-042"}})`
**Then** the dispatch path lands on the Backend Runtime, which finds the connection owning `backend-sdk-customer-app`, generates a `callId`, sends `{type: "sdk.invoke", callId, name: "customer.read", input: {id: "c-042"}, sessionId}` over the WebSocket, awaits the SDK's reply, and returns the result to the caller. Total round-trip: <100ms in v1.

### Scenario 4: SDK reconnects after an unexpected drop

**Given** Scenarios 1-3 just completed; the Gateway process is restarted (or the TCP socket dies unexpectedly)
**When** the SDK's WebSocket close handler fires (NOT a developer-initiated `sdk.disconnect()`)
**Then** the SDK starts its 30s backoff reconnect (`client.ts:206-218`), reopens the WebSocket, re-sends `sdk.auth`, and re-sends every `sdk.capability.register` it previously sent. The Backend Runtime atomically replaces the previous registrations for `backend-sdk-customer-app` and emits `sdk.connection.accepted` again. No operator intervention. In-flight invocations during the drop window return `GATEWAY_SDK_UNREACHABLE` with `retryable: true`.

### Scenario 5: developer explicitly disconnects the SDK

**Given** a connected SDK
**When** the SDK calls `sdk.disconnect()`
**Then** the Backend Runtime emits `sdk.connection.closed {appId, reason: "explicit"}`, removes all of the app's capabilities from the registry, closes the WebSocket, and decrements the connection count. Subsequent `business.*` invocations return `GATEWAY_SDK_UNREACHABLE` until the SDK reconnects.

### Scenario 6: handler throws an error

**Given** Scenarios 1-2 just completed; a handler is invoked but throws
**When** the SDK receives the `sdk.invoke` and the handler throws
**Then** the SDK sends `{type: "sdk.invoke.error", callId, code: "HANDLER_ERROR", message}` back. The Backend Runtime maps `HANDLER_ERROR` to `GATEWAY_INTERNAL_ERROR` and surfaces it to the caller. The audit log records `status: "error"`.

### Scenario 7: handler does not exist on the SDK

**Given** Scenarios 1-2 just completed
**When** the Backend Runtime routes an invocation for a name not in the SDK's manifest (e.g. dispatch lands on a stale registration)
**Then** the SDK sends `{type: "sdk.invoke.error", callId, code: "HANDLER_NOT_FOUND", message}`. The Backend Runtime maps this to `GATEWAY_CAPABILITY_NOT_FOUND` and surfaces to the caller.

### Scenario 8: Backend Runtime is configured but not started

**Given** the Gateway is running but `config.backendRuntime` is undefined (default behavior in tests)
**When** the gateway dispatches a `backend-sdk-*` owner
**Then** the dispatch falls through to the existing `GATEWAY_SDK_UNREACHABLE` stub (`dispatch.ts:90-97`) — backward-compatible. Test fixtures that don't stand up a Backend Runtime continue to work.

## Simulation Contract

The post-impl simulation (Phase 4) MUST demonstrate all 8 scenarios. Each maps to one or more sim commands:

```bash
# Scenario 1: connect
connect                                    # ws.open → sdk.auth → sdk.connection.accepted

# Scenario 2: register caps
register customer.read
register customer.delete
register customer.list
# → 3 caps in Capability Registry under owner="backend-sdk-customer-app"

# Scenario 3: invoke (drives a real handler)
invoke customer.read {"id":"c-042"}        # → ws.send sdk.invoke → handler → ws.recv sdk.invoke.result
# → result returns to caller, audit record written, sdk.invoke.completed emitted

# Scenario 4: reconnect after drop
drop                                       # simulate Gateway crash (dropper shim)
# → SDK reconnects with backoff, re-registers, sdk.connection.accepted emitted

# Scenario 5: explicit disconnect
disconnect                                 # → sdk.connection.closed emitted, caps removed

# Scenario 6: handler error
invoke customer.read {"id":"throw"}        # handler throws → HANDLER_ERROR → GATEWAY_INTERNAL_ERROR

# Scenario 7: handler not found
invoke nonexistent.cap                     # SDK returns HANDLER_NOT_FOUND → GATEWAY_CAPABILITY_NOT_FOUND

# Scenario 8: no Backend Runtime configured
# → dispatch.ts falls through to GATEWAY_SDK_UNREACHABLE (regression coverage)
```

## Technical Design

### Data Models

The Backend Runtime owns a single in-memory store:

```ts
interface BackendConnection {
  readonly appId: string;          // stable identifier (JWT 'sub' claim)
  readonly socket: WebSocket;      // ws library socket handle
  readonly acceptedAt: number;     // ms timestamp for latencyMs
  readonly caps: Map<string, RegisteredCapability>;
}

interface RegisteredCapability {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly permissions: string[];  // SDK sends comma-joined; split on receive
  readonly tier: CapabilityTier | null;
}
```

Capabilities are also registered in the shared `CapabilityRegistry` with `owner: "backend-sdk-<appId>"` and `type: "business"`. Owner-collision semantics: re-registration by the same `appId` atomically replaces (matches `CapabilityRegistry.register()` semantics at `capability-registry/src/types.ts:110-113`).

### API Contracts

`BackendRuntime` factory:
```ts
function createBackendRuntime(config: BackendRuntimeConfig): Promise<BackendRuntime>

interface BackendRuntimeConfig {
  readonly port: number;            // default 9100
  readonly tokenSecret: Buffer;     // shared with @platform/gateway-core for JWT verify
  readonly capabilityRegistry: CapabilityRegistry;  // composite dep
  readonly eventBus: EventBus;
  readonly clock?: Clock;
  readonly handlerTimeoutMs?: number;  // default 30_000
}

interface BackendRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatchInvocation(
    owner: string,                  // "backend-sdk-<appId>"
    capability: CapabilityRecord,
    input: YamlValue,
    sessionId: string | undefined,
  ): Promise<YamlValue>;            // throws GatewayError on failure
}
```

Bus events (new):
- `sdk.connection.accepted { appId: string; gatewayUrl: string; latencyMs: number }`
- `sdk.connection.closed { appId: string; reason: "explicit" | "error" | "dropped" }`

Wire messages the Backend Runtime SENDS to the SDK (new in this pack):
- `{type: "sdk.invoke", callId: string, name: string, input: YamlValue, sessionId?: string}` — the call

Wire messages the Backend Runtime RECEIVES from the SDK (already defined by sdk-node):
- `{type: "sdk.auth", token: string}` — handshake
- `{type: "sdk.capability.register", name, description, version, permissions, tier}` — registration
- `{type: "sdk.invoke.result", callId, payload}` — handler success
- `{type: "sdk.invoke.error", callId, code, message}` — handler error or not found
- `{type: "sdk.capability.register.error", name, reason}` — async rejection (rare; BI[9] test surface)

Error code mapping (Backend Runtime → caller):
- `HANDLER_NOT_FOUND` (SDK) → `GATEWAY_CAPABILITY_NOT_FOUND` (`-32001` in MCP mapping)
- `HANDLER_ERROR` (SDK) → `GATEWAY_INTERNAL_ERROR` (`-32006`)
- 30s handler timeout → `GATEWAY_HANDLER_TIMEOUT` (`-32007`), `retryable: true`
- WebSocket closed mid-invoke → `GATEWAY_SDK_UNREACHABLE` (`-32005`), `retryable: true`

### Dependencies

- **`@platform/capability-registry`** (workspace) — already shipped. `register()` accepts the owner prefix as a free-form string; no schema change needed.
- **`@platform/event-bus`** (workspace) — already shipped. `publish()` for `sdk.connection.*` events.
- **`@platform/gateway-core`** (workspace) — kernel change: `dispatch.ts:90-97` replaced; `DispatchHandlers.ctx` gains `backendRuntime?: BackendRuntime`. `createGateway()` config gains `backendRuntime?: BackendRuntime` so tests can opt out.
- **`@platform/agentide`** (workspace) — composition: `createPlatform()` auto-creates the Backend Runtime if `config.backendRuntimePort` is set (default 9100) and wires `start()` / `stop()` into the platform lifecycle.
- **`ws`** (third-party) — WebSocket server. New dep on `@platform/backend-runtime`. License: MIT. Maintenance: widely used (npm: ~30M weekly downloads), stable. Alternative considered: Node's built-in `http` upgrade handling — rejected because `ws` is the de-facto standard, has reconnect/heartbeat helpers, and is already a dep of `@platform/sdk-node` (consistent transport layer across both sides).

### Architecture Notes

The Backend Runtime is a new package `@platform/backend-runtime` (Q1). It owns:
- The `ws.Server` lifecycle (port 9100 by default)
- The connection registry (`Map<appId, BackendConnection>`)
- The Capability Registry bridge (registers/unregisters caps as SDK events fire)
- The invoke-dispatch path (sends `sdk.invoke`, awaits `sdk.invoke.result` / `sdk.invoke.error`)

The Gateway kernel change is minimal:
- `dispatch.ts` lines 90-97 (the `SDK_UNREACHABLE` stub) replaced with: if `ctx.backendRuntime` is set, call `backendRuntime.dispatchInvocation(...)`; otherwise keep the existing error (backward-compatible for tests).
- `DispatchHandlers.ctx` shape gains one optional field.

`@platform/agentide/createPlatform()` composes the Backend Runtime into the default lifecycle:
1. Build EventBus, CapabilityRegistry, SessionManager, PluginManager, Gateway
2. Build Backend Runtime (passing the bus, registry, token secret)
3. Set `gateway.backendRuntime = backendRuntime`
4. Wire `backendRuntime.start()` after `gateway.start()`, `backendRuntime.stop()` before `gateway.stop()`

Data flow for an external `tools/call customer.read`:
```
MCP client → MCP adapter (BI[9])
            → gateway.handleInvocation({token, capability:{name:"customer.read"}, input:{id:"c-042"}})
            → authn (JWT verify)
            → authz (tier check; reads "customer.read" requires scope "customer.read" or higher)
            → dispatchCapability (Q5 three-path; this pack adds the 3rd path)
            → backendRuntime.dispatchInvocation("backend-sdk-customer-app", customer.read, {id:"c-042"}, undefined)
            → ws.send {type:"sdk.invoke", callId, name:"customer.read", input, sessionId}
            → SDK handler runs → ws.recv {type:"sdk.invoke.result", callId, payload}
            → return payload up the stack
            → audit log: {status:"ok", durationMs, ...}
```

## Non-Goals

- **Per-instance load balancing.** Owner is `backend-sdk-<appId>`; if multiple pods of the same app connect, the Backend Runtime picks one (the most recently accepted). Multi-instance dispatch is a follow-up pack.
- **Application-level ping/pong.** Relies on TCP keep-alive + the SDK's existing 30s backoff reconnect (Q4).
- **Explicit auth handshake response.** `open` after `sdk.auth` = success (Q3).
- **`prompts/list` / `resources/list` MCP support.** Out of scope for this pack — BI[9] returns `-32601` for non-tool methods.
- **`@platform/sdk-node`-side changes.** The wire protocol is frozen; this pack consumes what sdk-node ships.

## Out of Scope (Future)

- **Multi-instance dispatch** — when `backend-sdk-customer-app` has 5 pods connected, route by round-robin or load. Tracked separately.
- **`sdk.runtime.status` platform cap** — surfaces connected SDKs to operators. Today there's no way for an operator to enumerate connected SDKs from the canonical invocation shape.
- **Heartbeat / keep-alive** — application-level ping/pong if real-world deployment shows TCP defaults are insufficient.
- **Wire-protocol v2 with explicit `sdk.auth.accepted` / `sdk.auth.rejected`** — if v1's implicit handshake causes diagnostic pain in production.

## References

- `GRILL-gateway-sdk-dispatch.txt` — locked decisions (Q1-Q4)
- `CONTEXT.md` — glossary (Adapter, Runtime, Session, Audit Log, Tier)
- `IMPL-gateway-sdk-dispatch.md` — execution plan (separate doc, Phase 2)
- `packages/gateway-core/src/dispatch.ts:90-97` — the stub being replaced
- `packages/gateway-core/src/types.ts:161-167` — kernel `Adapter` interface (not used here; sibling concept)
- `packages/sdk-node/src/{client,invoke,lifecycle,events}.ts` — wire protocol contract
- `packages/capability-registry/src/{types,store,validate}.ts` — registry semantics
- `packages/event-bus/` — pub/sub for `sdk.connection.*` events
- `docs/architecture/Agentide.md` §6 — Backend SDK role
- `docs/drift.md` — drift log (D-2 → D-9 resolved for sdk-node)
- `docs/features/gateway-sdk-dispatch/simulate-pre.html` — Phase 0.5 sim