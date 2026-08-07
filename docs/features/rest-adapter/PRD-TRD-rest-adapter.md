# PRD-TRD: REST adapter

**Slug:** rest-adapter
**Status:** Draft
**Date:** 2026-08-07

## Why This Exists

The platform has two transport doors — WebSocket (`@spanexx/adapter-websocket`) and
MCP (`@spanexx/adapter-mcp`). Neither is a clean fit for HTTP-style clients:
WebSockets require a long-lived connection model, MCP requires JSON-RPC framing
and tool-card awareness. A growing set of integrators (dashboards, webhooks, ops
scripts, third-party agents, REST-style SDKs) want plain HTTP `POST /invoke` —
the canonical capability packet over a request/response envelope.

This pack ships the third door. It is the proof that `@spanexx/adapter-core`
is genuinely shared, not just refactored: a stateless REST door built on the
same primitives as WS and MCP, with **the same audit trail, the same capability
registry, the same session model** — differing only in its transport bytes.

## Behavioral Spec

### Scenario 1 — Happy path: invoke a session-less capability

**Given** a valid Bearer JWT with `platform.*.read` scope
**When** `POST /invoke {"capability": "capability.list", "input": {}}`
**Then** HTTP 200 with body `{"capabilities": [...]}` — the call is recorded in
audit + `gateway.invocation` event.

### Scenario 2 — Happy path: invoke a business capability

**Given** a valid Bearer JWT with `product.read` scope, `sessionId: "s-1"`
**When** `POST /invoke {"capability": "product.list", "input": {}, "sessionId": "s-1"}`
**Then** HTTP 200 with body `{"products": [...]}`.

### Scenario 3 — Auth failure: missing token

**When** `POST /invoke` without `Authorization: Bearer <token>`
**Then** HTTP 401 with body `{"code": "TOKEN_INVALID", "message": "missing bearer token", "retryable": false, "details": {}}`.

### Scenario 4 — Auth failure: expired token

**Given** a Bearer token whose `exp` is in the past
**When** any request
**Then** HTTP 401 with body `{"code": "TOKEN_EXPIRED", ...}`.

### Scenario 5 — Authorization failure: insufficient scope

**Given** a Bearer token with empty scope
**When** `POST /invoke {"capability": "product.list", ...}`
**Then** HTTP 403 with body `{"code": "INSUFFICIENT_SCOPE", ...}`.

### Scenario 6 — Session-required missing

**Given** a Bearer token with `product.read` scope
**When** `POST /invoke {"capability": "product.list", "input": {}}` (no sessionId)
**Then** HTTP 400 with body `{"code": "SESSION_REQUIRED", ...}`.

### Scenario 7 — Capability not found

**When** `POST /invoke {"capability": "does.not.exist", ...}`
**Then** HTTP 404 with body `{"code": "CAPABILITY_NOT_FOUND", ...}`.

### Scenario 8 — Discovery: list capabilities

**Given** a valid Bearer token
**When** `GET /capabilities`
**Then** HTTP 200 with body `{"capabilities": [...]}` (cards from shared
`createCapabilityLookup.list`).

### Scenario 9 — Rate limit

**Given** a caller that has exceeded the token bucket
**When** any request
**Then** HTTP 429 with body `{"code": "RATE_LIMIT_EXCEEDED", "retryable": false, ...}`.

### Scenario 10 — Runtime failure

**When** the kernel returns `HANDLER_TIMEOUT` (or `SDK_UNREACHABLE`, etc.)
**Then** HTTP 500 with body `{"code": "<GATEWAY_*>", "retryable": true, ...}`.

## Simulation Contract

Two sims are in the v1 acceptance bar:

1. **Pre-impl** (`docs/features/rest-adapter/simulate-pre.html`) — design rehearsal;
   already shipped 2026-08-07, user-signed-off. Assertions: 6 capability cards
   render, 18-row status map renders, demo button walks 9 scenarios end-to-end.
2. **Post-impl** (`docs/features/rest-adapter/simulate.sh`) — drives a real
   `createRestAdapter(...)` + `createPlatform({adapterRestPort: 7400})` against a
   loopback (127.0.0.1) HTTP server. Runs every scenario above using `curl` and
   asserts on (a) HTTP status, (b) body JSON shape, (c) `content-type: application/json`.

Post-impl sim required commands:
```
POST /invoke {"capability":"capability.list","input":{}}                 → 200
POST /invoke {"capability":"product.list","input":{},"sessionId":"s-1"}  → 200
POST /invoke  (no token)                                                  → 401 TOKEN_INVALID
POST /invoke {"capability":"product.list"...}  token=Bearer expired      → 401 TOKEN_EXPIRED
POST /invoke {"capability":"product.list","input":{}}  token=noscope     → 403 INSUFFICIENT_SCOPE
POST /invoke {"capability":"product.list","input":{}}  (no sessionId)    → 400 SESSION_REQUIRED
POST /invoke {"capability":"does.not.exist",...}                         → 404 CAPABILITY_NOT_FOUND
GET  /capabilities                                                        → 200
GET  /capabilities/{name}                                                 → DEFERRED (D-100)
```

## Technical Design

### Data Models

Reuses what's shipped:
- `CanonicalInvocation` (`gateway-core/src/types.ts:56`) — `{token, capability, input, sessionId?}`
- `CanonicalResponse` (`gateway-core/src/types.ts:66`) — `{output}` or `{error: GatewayErrorPayload}`
- `GatewayErrorPayload` (`errors/src/index.ts:19`) — `{code, message, details, retryable}`

Door-local additions:
- `RestAdapterConfig { port?: number; host?: string; bearerRegex?: RegExp; statusMap?: StatusMapEntry[] }`
- `StatusMapEntry { gatewayCodePrefix: string; httpStatus: number }` — table per Q4

### API Contracts

- `POST /invoke` — body `{capability: string, input: object, sessionId?: string}`;
  response 200 with `{output}` or 4xx/5xx with `GatewayErrorPayload`.
- `GET /capabilities` — no body; response 200 with `{capabilities: CapabilityCard[]}`.
- `GET /capabilities/{name}` — DEFERRED to v1.1 (D-100). Same path would have returned
  `CapabilityRecord`; blocked until `createCapabilityLookup.describe()` is fixed.

Public factory:
```ts
export function createRestAdapter(
  gateway: Gateway,
  config?: Partial<RestAdapterConfig>
): Adapter;  // shape: { name, start(), stop() }
```

### Dependencies

- **Production:** `@spanexx/gateway-core` (handleInvocation, verifyToken, types),
  `@spanexx/adapter-core` (`createAdapterPipeline`, `createErrorConverter`,
  `createResponseChannel`, `createCapabilityLookup`, `readClaims`),
  `@spanexx/event-bus` (for cancel/handoff if needed — no events emitted by the door).
- **No new runtime deps.** HTTP server uses Node's `node:http` (no Express, no Fastify;
  the door is small enough that a router on top of `http.createServer` is cleaner than
  pulling in a framework, and the precedent at `dashboard-core/src/server.ts` does exactly that).
- **No client_credential grant in v1** — kernel `gateway.oauthTokenHandler` is available
  to adapters that need it; not REST.

### Architecture Notes

One package: `packages/adapter-rest/`. Same shape as `@spanexx/adapter-websocket` and
`@spanexx/adapter-mcp`: own `package.json`, own tsconfig, own tests, own sim.

Module layout:
```
packages/adapter-rest/
  src/
    server.ts        # http.createServer + router; transport lifecycle
    invoke.ts        # POST /invoke → createAdapterPipeline + createResponseChannel
    capabilities.ts  # GET /capabilities → createCapabilityLookup.list
    errors.ts        # status map (table per Q4) + createErrorConverter wiring
    auth.ts          # bearer extraction (precedent: adapter-mcp/src/server.ts:44-48)
    index.ts         # public surface: createRestAdapter, RestAdapterConfig
    __tests__/
      parse.test.ts, router.test.ts, status-map.test.ts, scenarios.test.ts
  package.json
  tsconfig.json
```

Wiring point: `packages/agentide/src/factory.ts:214-234` (alongside the existing WS + MCP
adapters). Default port: **7400** (next in sequence after MCP 7100, dashboard 7200, WS 7300,
backend-runtime 7350 — confirmed unallocated by A9-R1 §11).

Data flow per request:
```
HTTP request → server.ts (parse URL, method, headers)
  → auth.ts (extract bearer token)
  → invoke.ts (router → POST /invoke handler)
    → input parser → PipelineInvocation
    → createAdapterPipeline({gateway, errors, response}).invoke(...)
    → ResponseChannel renders JSON envelope
  → HTTP response (status from errors.ts map, body verbatim)
```

A1 rule (CONTEXT.md): only the **bytes** are door-local — parse, render, the status map.
Everything between is shared via `createAdapterPipeline`. The door does not invent its own
invocation packet, error shape, or capability lookup.

## Non-Goals

- **GET /capabilities/{name}** — deferred to v1.1; `createCapabilityLookup.describe()` is
  broken against the real kernel (D-100). Resolve D-100 first, then expose the route.
- **Client-credentials grant in v1** — `gateway.oauthTokenHandler` is available adapter-side
  for adapters that need it. REST is bearer-only; revisit when a real machine-identity
  consumer lands.
- **Origin binding** — early-path only; REST is lazy by shape (`Bearer JWT per request`).
- **Per-route verb→tier mapping** — single verb `POST`. Tiers are enforced by `checkAuthz`
  in the kernel; the door doesn't second-guess.
- **Per-resource discovery sugar** — `/sessions`, `/health`, `/status`, plugins, organizations,
  clients: all stay OUT. Reachable over `POST /invoke` as session-less capabilities.
- **Streaming / SSE** — unary `POST /invoke` only. Kernel stays single-shot (gateway-core Q11).
- **Rate-limit knob at the door** — kernel `rate-limit.ts` already enforces per-caller
  token buckets; the door forwards `RATE_LIMIT_EXCEEDED` to 429 with no local throttling.
- **TLS termination** — the door binds plain HTTP on `127.0.0.1:7400`. Operators front it
  with a reverse proxy (ngrok, nginx, etc.) for production. Same posture as MCP / dashboard /
  backend-runtime.

## Out of Scope (Future)

- **`GET /capabilities/{name}` (describe)** — D-100 fix is the gate.
- **Client-credentials grant** —when a real machine-identity consumer asks.
- **Origin binding for REST** — if a future consumer wants browser-style protection, add
  the `expectedOrigins` claim + early-mode path (the bedrock is already there in
  `createAuthPolicy`).
- **Streaming SSE endpoint** — when the kernel emits real streams (post-browser-runtime era).
- **WebSub / webhook subscribe** — capability invocation is the v1 surface; event subscription
  is a separate door concern (the WS door's W3 lock).

## References

- **GRILL** — `docs/wayfinder/adapter-core/tickets/A9-rest-proof-adapter.md` (6 locked decisions)
- **Discovery** — `docs/wayfinder/adapter-core/research-rest-platform-discovery.md` (A9-R1)
- **Adapter-core map** — `docs/wayfinder/adapter-core/map.md` (A1–A9 closed)
- **CONTEXT.md** — glossary, decisions log
- **Drift** — D-100 (describe bug, blocks GET /capabilities/{name})
- **Adapter-core primitives** — `packages/adapter-core/src/{pipeline,error-converter,response-channel,capabilities/lookup,read-claims}.ts`
- **HTTP door precedent** — `packages/dashboard-core/src/server.ts` (static + 127.0.0.1 bind)
- **Bearer extraction precedent** — `packages/adapter-mcp/src/server.ts:44-48`
