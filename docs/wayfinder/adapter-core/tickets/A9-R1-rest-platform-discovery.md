# A9-R1 — REST adapter: platform discovery (research)

**Type:** `wayfinder:research` (AFK)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A9
**Blocked by:** —

## Resolution

Full report: `docs/wayfinder/adapter-core/research-rest-platform-discovery.md` (branch
`research/adapter-rest-a9-r1`, commit `2e0b76d`). Summary of what A9 must now lock:

1. **The seam is ready.** `handleInvocation` is protocol-agnostic (`handle-invocation.ts:110`,
   header names REST as an intended caller). Primitives 1/3/4/6 (`readClaims`,
   `createErrorConverter`, `createResponseChannel`, `createAdapterPipeline`) are ready today.
2. **Two traps found (own A9 decisions):** (a) `createAuthPolicy` "lazy" mode is **not
   implemented** — the mode is stored but never branched on (`auth-policy.ts:68-88`); REST's
   assumed pass-per-request model either needs A8's lazy work or the door passes the raw token
   through and the kernel verifies per call (`handleInvocation` does this already).
   (b) `createCapabilityLookup.describe()` is **broken against the kernel** — it reads
   top-level fields but `capability.describe` returns `DescribeResult` with everything nested
   under `capability` (`capabilities/lookup.ts:106-115` vs `factory.ts:572-578`); every
   describe returns empty cards. Blocks `GET /capabilities` schemas as-is.
3. **Greenfield error mapping:** no HTTP status table exists anywhere (§8). A9 authors it
   from scratch — the `204`/`304` retryable question is open.
4. **OAuth:** `handleTokenRequest` is kernel-owned and transport-agnostic
   (`gateway-core/types.ts:245`); REST consumes it via `gateway.oauthTokenHandler`, no copy
   (MCP does exactly this). `426` TLS-required precedent exists.

## Question

## Question

Before the REST adapter can be specified, what does the platform already expose that it
must reuse — and what is the canonical pattern for a new adapter door to follow?

The REST adapter is the third consumer of `@spanexx/adapter-core` after `adapter-websocket`
(shipped) and `adapter-mcp` (planned A8). This is research, not decisions: surface the
facts a future grilling session will lock against.

## Scope (read-only)

The agent must read the codebase and produce a structured report. No code changes. No
decisions. Each finding cites `file:line`.

### 1. Platform architecture

One paragraph each, citing the file paths:

- What is the Gateway? Cite the kernel entry point + capability routing path.
- What is an Adapter? Cite the A1 lock (`docs/wayfinder/adapter-core/map.md`) and the
  `createAdapterPipeline` seam.
- What is a Runtime? Cite the runtime registry + plugin-manager.
- What is a Capability? Cite the capability-registry data model.
- What is a Session? Cite the session-manager lifecycle + the `SESSION_LESS_CAPABILITIES`
  list.
- What is a Plugin? Cite the plugin-manager manifest shape + lifecycle events.
- What is the Event Bus? Cite the bus interface + `event.*` reserved namespace rule.

### 2. Invocation flow

Trace ONE example call (suggest `agentide invoke product.list` or `gateway.issueToken`)
from CLI to response. Identify every function/method called and at what `file:line`.

Produce a sequence diagram in markdown (the CLI → WS adapter → Gateway → Runtime → SDK →
Application → back path).

### 3. WebSocket adapter (the model for REST)

Read `packages/adapter-websocket/src/{server,auth,invoke,registry,fanout,queue,errors}.ts`.

Answer:
- How does it start? (`createWebSocketAdapter` + `createPlatform` wiring)
- How does it authenticate? (W2 lock — JWT-in-first-message, pre-auth state, refresh)
- How does it find capabilities? (A6 lookup via `createCapabilityLookup`)
- How does it build an invocation? (A1 seam + A4 channel)
- How does it talk to the Gateway? (in-process `handleInvocation` call points)
- How does it return errors? (A5 envelope + WS close codes 1008/1009/1011)
- How does it create sessions? (pass-through — A3)
- How does it subscribe to events? (W3 sub + W5 fanout)

### 4. Gateway API exposed to adapters

Cite the gateway-core package:
- How do you invoke? (`handleInvocation` signature)
- How do you create a session? (`session.create` capability — note session-less sets)
- How are permissions checked? (`authz.ts` — tier-hierarchy + namespace)
- How are audit logs written? (`AuditWriter` + Event Bus `gateway.invocation`)
- How are events emitted? (event-bus publish)
- How are runtimes located? (Plugin Manager `handleInvocation`)

### 5. Authentication

- JWT verification path: `verifyToken` (`gateway-core/src/auth.ts:51`)
- OAuth: `oauth-token-handler.ts` + `client-credentials` flow
- Permission scopes: `authz.ts` `checkAuthz` (tier + namespace)
- Origin binding: `@platform/origin` package + `expectedOrigins` claim
- Token claims shape: `sub: { tenantId, callerId }`, `scope[]`, `expectedOrigins`, `exp`

### 6. Sessions

- Lifecycle: Active ⇄ Suspended → Archived (CONTEXT.md)
- Timeouts: 5 min idle → Suspend, 30 min TTL → Archive (configurable)
- Where session-less capabilities are listed (`SESSION_LESS_CAPABILITIES`)
- Owner model: session-manager owns records, gateway owns the verdict
- How an adapter passes sessionId (passthrough-undefined per A3)

### 7. Capabilities

- Registration: `registerPlatformCapabilities` + plugin-manager
- Search: `capability.list` calls (filtered by `checkAuthz`)
- Metadata fields: name, version, description, tier, permissions, owner, type
- Versioning: auto-latest default + explicit pin
- Types: business / platform / runtime
- Tier: read / act / destructive (runtime) + read / write (platform)

### 8. Error model

- `GatewayErrorPayload` shape: `{code, message, details, retryable}`
- `ERROR_CODES` catalog location
- Per-adapter error tables (WS `errors.ts`, MCP `error-map.ts`)
- HTTP status mapping (if any) — note: NO existing adapter maps to HTTP, so this is the
  REST adapter's WIP

### 9. Event Bus

- Does the Gateway emit events? (`gateway.invocation` + audit)
- Does the adapter need lifecycle events? (NO per A1 lock)
- Subscription patterns: per-pattern authz, wildcard `*` final-segment
- Reservation rule: `event.*` reserved namespace

### 10. Existing adapters (duplication inventory)

A11 found 16 duplicated files (2,222 lines) between WS and MCP. After A7 (WS migration
shipped), which duplications remain? What does MCP still carry that WS delegated to core?

Cite specific files:
- `packages/adapter-mcp/src/{translate,server,error-map}.ts`
- `packages/adapter-mcp/src/__tests__/*`
- `packages/adapter-websocket/src/__tests__/*` (per A7, untouched)

### 11. REST API surface (input for A9 grilling)

Inventory any existing HTTP endpoints in the platform:
- `dashboard-core/src/server.ts` — static server (GET /, GET /assets/*)
- `adapter-mcp/src/server.ts` — HTTP/SSE transport + OAuth routes
- `packages/agentide/src/oauth-token-handler.ts` — OAuth routes
- Any others

Output: a list of paths, methods, handlers, and what they do. This is the input for the
A9 sub-questions about route shape.

### 12. Reusable code inventory

The 7 primitives locked by A7:
1. `readClaims`
2. `createAuthPolicy` (early mode — lazy path is A8)
3. `createErrorConverter`
4. `createResponseChannel`
5. generic `RecordRegistry<T>`
6. `createAdapterPipeline` (A1 seam)
7. `createCapabilityLookup` (A6)

For each, note what the REST adapter would need and whether it exists today.

### 13. Architecture proposal (draft input for A9 grilling)

A draft proposal (NOT a decision — the user locks via A9):
- Objective: package name, factory, default port
- Scope: endpoints, auth model, session model, error mapping
- Reused components: which adapter-core primitives
- New components: REST-only door surface (HTTP parser, JSON output, error table)
- Testing strategy: `simulate-rest-adapter.mjs` proposed shape

## Deliverable

- One markdown report: `docs/wayfinder/adapter-core/research-rest-platform-discovery.md`
- Committed on a NEW branch: `research/adapter-rest-a9-r1`
- Does NOT carry the uncommitted A8 diff on `main` (the subagent must `git stash` first
  or branch from the last clean commit)
- Citations as `file:line` wherever possible
- Findings only — decisions are A9's job

## Out of scope

- REST API shape decisions (route shape, verb mapping, error status codes) — A9
- Any code changes
- Any decisions about endpoints, auth, or session model
- Resolving A9 (HITL)
