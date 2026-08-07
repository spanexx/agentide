# A11 — Research: duplication inventory (adapter pipeline)

**Ticket:** [A11](../tickets/A11-research-duplication-inventory.md) (research, informs A1–A8)
**Date:** 2026-08-07
**Status:** delivered — facts for A1–A8 grilling
**Branch:** `research/adapter-core-a11`

## What this is

Durable, file-by-file inventory of the duplicated adapter pipeline. Charting found the
headlines; this formalizes them with exact `path:line` references, per-file roles,
public exports, and test/sim coverage counts, so later sessions don't re-dig. Facts
only; no design decisions. Line counts are `wc -l` as of 2026-08-07.

## Headline numbers

| Metric | Value |
|---|---|
| Files in duplicated pipeline (both adapters, `src/` only) | **16** (11 WS + 5 MCP) |
| Lines in duplicated pipeline | **2,222** (1,495 WS + 727 MCP) |
| `backend-runtime/src/verify.ts` local copy (deliberate, out of scope) | 81 lines |
| Test files in adapter `src/__tests__/` | **14** (10 WS + 4 MCP), 1,830 lines |
| Post-impl sim scripts (agentide/scripts) | 2 scripts, 986 lines (485 + 501) |
| Kernel contracts NOT duplicated | 5 (`CanonicalInvocation`, `CanonicalResponse`, `GatewayErrorPayload`, `verifyToken`, `originMatches`) |

## 1. adapter-websocket (`packages/adapter-websocket/src/`, package `@spanexx/adapter-websocket`)

Public surface (`index.ts`, 7 lines): `createWebSocketAdapter`, `createWsClient`,
`WsInvokeError`, `WsDoorMismatchError`, `originMatches`, `authenticateToken`,
`ConnectionRegistry`, `WS_ERROR_CODES`, `DEFAULT_CONFIG`, `AUTH_ERROR_CODES`, all types.

| File | LOC | Role | What it duplicates (shared twin) | Public exports | Tests |
|---|---|---|---|---|---|
| `auth.ts` | 69 | Frame auth: JWT verify → origin binding → tenant check, returns `TokenClaims` or lowercase phrase code | **Pipeline, not code**: same verify→origin→tenant sequence as `backend-runtime/src/server.ts:50-135`. Imports (does NOT reimplement) `verifyToken` from `gateway-core/src/auth.ts:51` and `originMatches` from `@spanexx/origin` (`origin.ts:18`, re-exported `gateway-core/src/index.ts:9`) | `authenticateToken`, `originMatches`, `AuthContext`, `AuthResult` | `__tests__/auth.test.ts` (62) |
| `invoke.ts` | 94 | `invoke` frame → `gateway.handleInvocation` → `invoke.result`/`invoke.error`/`invoke.partial`+`invoke.end` wire frames | Constructs `CanonicalInvocation` (`gateway-core/src/types.ts:56` CID / `:62` interface) at `:37-42` and maps `CanonicalResponse` (`types.ts:84`) `:43-67`. Error passthrough verbatim `:43-51` (counterpart of MCP `error-map.ts` mapping) | `invokeFrame`, `parseInvokeFrame` | `__tests__/invoke.test.ts` (87) |
| `errors.ts` | 29 | `WS_ERROR_CODES`: 5 adapter-native `WS_*` string codes | **Not a duplication** — deliberately disjoint from `GATEWAY_*` (`@spanexx/errors`) and capability codes (`:5-10`); gateway codes pass through on `invoke.error` | `WS_ERROR_CODES` | covered via `server.test.ts` + `invoke.test.ts` |
| `queue.ts` | 127 | Per-connection outbound queue: byte budget (FIFO drop-oldest), one-frame-in-flight drain, stats arm | **No MCP twin** — transport state; MCP is stateless HTTP, framing owned by the MCP SDK transport | `enqueueFrame`, `drainQueue`, `clearQueue`, `QueueOptions` | `__tests__/queue.test.ts` (73) |
| `fanout.ts` | 123 | `subscribe`/`unsubscribe`/event relay over the shared event bus; per-pattern authz (`platform.<first>.read`) | **No MCP twin**. Consumes `@spanexx/event-bus` (`validatePattern`, `RESERVED_INTERNAL_PREFIX`) and `checkAuthz` from `gateway-core` | `subscribeTopics`, `unsubscribeTopics`, `pruneSubscriptions`, `derivePermission`, `SubscriptionOptions` | `__tests__/fanout.test.ts` (66) |
| `registry.ts` | 74 | Per-connection bookkeeping: `ConnectionRecord` store, auto-increment `ws-<n>` ids | **No MCP twin** — connection state lives adapter-side (kernel is stateless) | `ConnectionRegistry` | `__tests__/registry.test.ts` (19) |
| `protocol.ts` | 72 | W1–W6 envelope parser: `parseClientFrame` validates the 4 client→server families | **No kernel twin** — the W1–W6 wire contract is adapter-owned (locked in PRD-TRD); delegates invoke validation to `invoke.ts:parseInvokeFrame` | `parseClientFrame`, `isInvokeFrame`, `AuthCandidate`, `InvalidFrame`, `ParsedClientFrame` | `__tests__/protocol.test.ts` (15) |
| `client.ts` | 356 | `createWsClient` — the remote wire client (connect + `auth` handshake, correlationId-mapped invoke, subscribe, event/stats/close listeners) used by the agentide CLI | Speaks the same W1–W6 envelope (`types.ts`); **no MCP twin** (no MCP client ships) | `createWsClient`, `WsInvokeError` (`:49`), `WsDoorMismatchError` (`:65`), `WsClientHandle`, `WsClientConfig` | `__tests__/client.test.ts` (174) + `client-timeout.test.ts` (126) |
| `server.ts` | 294 | WS server lifecycle: `createWebSocketAdapter` factory, pre-auth timer, heartbeat ping/pong, auth-close codes 1008/1009/1011, cleanup | Same WS-server pattern family as `backend-runtime/src/server.ts` (both bind a `ws` `WebSocketServer` + verify token + origin binding; BR is the SDK door, this is the consumer door) | `createWebSocketAdapter` | `__tests__/server.test.ts` (299) |
| `types.ts` | 250 | Frame types (16-frame envelope), `ConnectionRecord` state machine, `DEFAULT_CONFIG` (port 7300), `AUTH_ERROR_CODES` (5 lowercase phrases) | **No kernel twin** — wire contract types; `TokenClaims` imported from `gateway-core/src/types.ts:117` | `DEFAULT_CONFIG`, `WebSocketAdapterConfig`, `ConnectionState`, `ConnectionRecord`, `ClientFrame`, `ServerFrame` (12 frames), `AUTH_ERROR_CODES`, `WebSocketAdapter` | `__tests__/types.test.ts` (73) |

Src total: **1,495 lines / 11 files**. Tests: **10 files, 994 lines**.

## 2. adapter-mcp (`packages/adapter-mcp/src/`, package `@spanexx/adapter-mcp`)

Public surface (`index.ts`): `createMcpAdapter`, types `McpAdapter`, `McpAdapterConfig`;
`translate.ts` additionally re-exports `gatewayErrorToJsonRpc`, `JsonRpcError`,
`getRequestCtx`.

| File | LOC | Role | What it duplicates (shared twin) | Public exports | Tests |
|---|---|---|---|---|---|
| `translate.ts` | 233 | MCP ⇄ canonical translation: `listTools` (capability catalog), `callTool` (one invocation), `decodeScopeFromToken` (scope claim), `validateMeta` (`_meta` gate) | `callTool` builds `CanonicalInvocation` (`gateway-core/src/types.ts:56`/`:62`) and calls `gateway.handleInvocation` at `:213` — direct twin of WS `invoke.ts:37`. `listTools` same pattern (`:139-154`). **`decodeScopeFromToken` (`:54-73`) duplicates the base64url payload-parse step of `verifyToken` (`gateway-core/src/auth.ts:86-95`)** — unsigned decode; signature stays in kernel | `validateMeta`, `decodeScopeFromToken`, `listTools`, `callTool`, `McpTool`, `ListToolsOutcome`, `CallToolResultShape`, `CallToolOutcome`, `META_*` keys (+ re-exports above) | `__tests__/translate.test.ts` (293) + `scenarios.test.ts` (224) |
| `error-map.ts` | 59 | `gatewayErrorToJsonRpc`: kernel `GATEWAY_*` code → JSON-RPC code (`-32001..-32006`) | Same decision point as WS `invoke.ts:43-51` (kernel error → wire error), opposite strategy: MCP maps to a table, WS passes codes verbatim. Consumes `GatewayErrorPayload` (`gateway-core/src/types.ts:75`) + `ERROR_CODES` (`@spanexx/errors`) | `JsonRpcError`, `gatewayErrorToJsonRpc` | covered via `translate.test.ts` (293) |
| `server.ts` | 248 | HTTP/SSE transport: `startMcpHttpServer` (stateless `WebStandardStreamableHTTPServerTransport`), Bearer extraction, `POST /oauth/token` + OIDC routes | **Transport has no WS twin** (different protocol). OAuth/OIDC routes are thin HTTP wrappers over gateway-core handlers (`OAuthTokenHandler`, `OidcResponse` — twin `gateway-core/src/oauth-token-handler.ts`); `extractBearer` (`:44`) is the MCP-side auth-header read | `startMcpHttpServer`, `McpHttpServerHandle`, `requestCtxStore`, `getRequestCtx` | `__tests__/server.test.ts` (101) |
| `index.ts` | 142 | Factory `createMcpAdapter`: wires low-level MCP `Server` handlers (`tools/list`, `tools/call`) to kernel; `WireError` carries wire codes verbatim | **No twin** — SDK-handler wiring is MCP-specific | `createMcpAdapter` (+ type re-exports) | `__tests__/server.test.ts` + `scenarios.test.ts` |
| `types.ts` | 45 | `McpAdapterConfig` (default port 7100), `McpAdapter` handle, `RequestCtx` | **No twin** | `McpAdapterConfig`, `McpAdapter`, `RequestCtx` | covered via `server.test.ts` + `harness.ts` |

Src total: **727 lines / 5 files**. Tests: **4 files (incl. `harness.ts` helper), 836 lines**.

**Correction to charting note:** the ticket's context lists "Bearer extraction" under
`translate.ts` — the extractor actually lives in `server.ts:44` (`extractBearer`, used
at `:241`). `translate.ts` is pure (no I/O).

## 3. backend-runtime `verify.ts` — deliberate local copy (out of scope, documented)

| File | LOC | Role | Twin | Status |
|---|---|---|---|---|
| `packages/backend-runtime/src/verify.ts` | 81 | HS256 JWT verify: parse, timing-safe signature compare, `exp` check against injected clock; returns discriminated union | **File-level copy** of `gateway-core/src/auth.ts:51-98` (`verifyToken`); header comment `:6-8`: "Logic MUST stay in sync" | **Deliberate** — keeps backend-runtime's runtime independent of gateway-core's (gateway-core depends on backend-runtime; cycle). Out of scope for adapter-core; do NOT fold into adapter-core. Consumed by `backend-runtime/src/server.ts:55` (call at `:135`) |

Test coverage: no dedicated test file — exercised via `backend-runtime/src/__tests__/server.test.ts`
using `jwt-helper.ts` (itself a local copy of `issueToken`'s signature, `jwt-helper.ts:4`).
Kernel twin is covered by `gateway-core/src/__tests__/auth.test.ts` (13 `verifyToken`
references).

## 4. Kernel contracts NOT duplicated (shared, single-owner)

| Contract | Location | Who consumes it |
|---|---|---|
| `CanonicalInvocation` | `packages/gateway-core/src/types.ts:56` (CID) / `:62` (interface) | Both adapters construct it: WS `invoke.ts:37-42`, MCP `translate.ts:139-142` / `:207-212` |
| `CanonicalResponse` | `packages/gateway-core/src/types.ts:84-86` | Both adapters consume it: WS `invoke.ts:43-67`, MCP `translate.ts:144-146` / `:214-232` |
| `GatewayErrorPayload` | `packages/gateway-core/src/types.ts:75-80` | WS `invoke.ts:44-49` (verbatim passthrough), MCP `error-map.ts:30-58` (mapping) |
| `verifyToken` | `packages/gateway-core/src/auth.ts:51-98` | Imported by WS `auth.ts:16-20`; in-kernel for MCP. **Not** imported by backend-runtime (local copy, §3) |
| `originMatches` | `packages/origin/src/origin.ts:18-31` (`@spanexx/origin`), re-exported `gateway-core/src/index.ts:9` | WS `auth.ts:29` (via gateway-core), backend-runtime `server.ts:50` (direct — avoids package cycle) |

Also shared, not duplicated: `ERROR_CODES` (`@spanexx/errors`) consumed by MCP
`error-map.ts:15` and the WS adapter's passthrough framing; `TokenClaims`
(`gateway-core/src/types.ts:117`).

## 5. Import surface (who consumes the adapters outside their packages)

| Consumer | Reference | Symbols |
|---|---|---|
| `packages/agentide/src/consumer.ts` | `:7` | `createWsClient`, `WsInvokeError`, `WsDoorMismatchError` (used: client at `:189`, door-mismatch branch `:198`, invoke-error branches `:291`/`:349`) — the CLI's remote wire client |
| `packages/agentide/src/factory.ts` | `:33-34` | `createMcpAdapter`, `createWebSocketAdapter` (wired into `createPlatform`) |
| `packages/agentide/src/index.ts` | `:13-14` | Type re-exports: `McpAdapter`, `McpAdapterConfig`, `WebSocketAdapter`, `WebSocketAdapterConfig` |
| `packages/agentide/src/types.ts` | `:166-180` | `Platform.backendRuntime?`, `Platform.mcpAdapter?`, `Platform.wsAdapter?` |
| `packages/backend-runtime/src/server.ts` | `:50`, `:55`, `:135` | `originMatches` from `@spanexx/origin` (direct), `verifyToken` from local `./verify.js` |
| `packages/gateway-core/src/index.ts` | `:9` | `originMatches` re-export from `@spanexx/origin` |
| `packages/dashboard-core/src/server.ts` | `:10` | Comment-only ("adapter-websocket is the only door") — no import |
| `packages/dashboard-core/src/config.ts` | `:7` | Comment-only (port note) — no import |
| Tests outside the packages | — | `agentide/src/__tests__/`: `cli.test.ts`, `consumer.test.ts`, `consumer-ux.test.ts` (WS adapter), `mcp-adapter.test.ts` (MCP adapter) |

## 6. Post-impl simulation coverage

| Script | LOC | Coverage |
|---|---|---|
| `packages/agentide/scripts/simulate-websocket-adapter.mjs` | 485 | Post-impl sim for the WS adapter (BI[24]): 14 scenarios S1–S14 (origin capture/binding, auth, pre-auth timeout, token refresh, subscribe/unsubscribe, fan-out, invoke call+stream, backpressure, frame cap, heartbeat, shutdown) against real packages; shared token fixtures via `sim-state.mjs` |
| `packages/agentide/scripts/simulate-mcp-adapter.mjs` | 501 | Post-impl sim for the MCP adapter (BI[9]): scenarios 1–8b (tools/list catalog, call through kernel, not-found, insufficient scope, `_meta` gate, unknown method, missing/expired bearer) + timeout path (covered in `scenarios.test.ts` with a fake backend runtime) |

Both fail (exit 1) on assertion mismatch; both read/write the shared `sim-state.mjs`
interconnected state.

## 7. What the inventory implies (facts for A1–A8, no decisions)

- **The true shared seam is the Canonical Invocation model**, not the WS wire: both
  adapters call `gateway.handleInvocation` with a `CanonicalInvocation` and map a
  `CanonicalResponse` (WS `invoke.ts:37`, MCP `translate.ts:213`; cf. drift D-94). A1's
  boundary and A7/A8's migrations reason over this shape.
- **One decision point, two strategies** (A5): kernel error → wire error is done as
  verbatim passthrough in WS `invoke.ts:43-51` and as a mapping table in MCP
  `error-map.ts:30-58`.
- **One real unsigned-JWT duplication** (A2): `decodeScopeFromToken`
  (`translate.ts:54-73`) re-implements the base64url payload-parse of `verifyToken`
  (`gateway-core/src/auth.ts:86-95`).
- **The only file-level code copy is deliberate**: `backend-runtime/src/verify.ts`
  (§3) — documented, out of scope.
- **WS-only state machinery has no MCP twin**: `queue.ts`, `fanout.ts`, `registry.ts`,
  `protocol.ts`, `types.ts` are transport-owned (connection state, byte budgets,
  W1–W6 envelope). A7's migration scope is these files; the kernel stays stateless.
- **`client.ts` is the only remote wire client** and a CLI dependency
  (`consumer.ts:7`): A1 must keep it reachable (or relocate it to adapter-core) or the
  CLI breaks.
- **Auth pipeline pattern is duplicated across doors** (WS `auth.ts` vs
  `backend-runtime/src/server.ts`): same verify→origin→tenant sequence; only the
  `verifyToken`/`originMatches` primitives are shared.
