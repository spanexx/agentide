# IMPL: mcp-adapter

**Slug:** mcp-adapter
**Status:** Shipped (2026-08-01)
**PRD-TRD:** [PRD-TRD-mcp-adapter.md](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/mcp-adapter/PRD-TRD-mcp-adapter.md)
**GRILL:** [GRILL-mcp-adapter.txt](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/mcp-adapter/GRILL-mcp-adapter.txt)
**Drift review:** [.reports/2026-08-01-drift-mcp-adapter.md](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/.reports/2026-08-01-drift-mcp-adapter.md) — verdict Minor Drift, D-28..D-34 logged in `docs/drift-issue-log.md`

> Retro-fitted IMPL (2026-08-01) per drift review D-28. Phases assembled from the
> CID comments + Code Maps in `packages/adapter-mcp/src/*.ts` and the BI[9] Phase 5

## Delivery note (2026-08-09) — real-client fixes D-123 + D-124

Two bugs found by testing the MCP door with a REAL MCP client (official SDK, the way Zed connects) — both invisible to the sim/unit tests:
- **D-123 (multi-connection):** the SDK `Server` keeps protocol state across connections; one shared `Server` + stateless transport served only the FIRST connection, every later connection (or reconnect) got a silent `-32603`. Fix: per-request `Server` + transport (`createMcpAdapter` now passes a `createServer` factory; `startMcpHttpServer` builds both per `/mcp` request; `stop()` no longer closes a shared transport). Verified: 3× `initialize` in a row all succeed.
- **D-124 (_meta gate):** the adapter required `_meta.io.modelcontextprotocol/protocolVersion` + `clientCapabilities` on every tools request (PRD Scenario 6) — real MCP clients send `_meta` only in initialize, so every real client got `-32602` on tools/list. Gate dropped (`validateMeta` kept as a pure function for tests); `_meta.dev.agentide/sessionId` still honored when present. Scenario 6 test rewritten to assert success without `_meta`; PRD-TRD Scenario 6 + API-contract row amended.

Tests: adapter-mcp 42/42 (incl. rewritten Scenario 6 + server.test.ts with the new factory signature). Live verification with the official SDK client: connect → tools/list (29 tools) → gateway.status + session.create tools/call all OK, reconnect OK. Files: `packages/adapter-mcp/src/index.ts`, `server.ts`, `translate.ts` (comment), `__tests__/scenarios.test.ts`, `__tests__/server.test.ts`, PRD-TRD Scenario 6/API table/architecture note.

## Delivery note (2026-08-09) — D-126 MCP session auto-mint

Found by calling business capabilities through the in-chat MCP tools: every `tools/call` on a business cap failed `GATEWAY_SESSION_REQUIRED` — the session-manager GRILL locks per-request short sessions (Active → Destroyed) owned by the adapter layer, transparent to the client (the CLI does this via D-79 `withAutoSession`); the MCP door didn't.
- **Fix:** NEW `packages/adapter-core/src/session-mint.ts` `withAutoMintSession` (CID:adapter-core-009, A1 seam — doors import only adapter-core) mirroring the CLI's D-79 helper; adapter-mcp tools/call retries once with a minted session when the kernel says `GATEWAY_SESSION_REQUIRED` and no session was supplied, then best-effort destroys. Business-only tokens (no `session.create` scope) keep deny-by-default (D-91).
- **Tests:** scenarios.test.ts +2 (auto-mint happy path with `*` token: dispatch carries a real minted session id + no active session remains; sessionless caps untouched). adapter-mcp 15/15, adapter-mcp + adapter-core 96/96.
- **Docs:** PRD-TRD Scenario 2 note. D-126 written + resolved in `docs/drift.md`.
- **Note (not surgical):** `tools/list_changed` push on capability registration (D-127) requires registry events + a stateful transport — new surface, feature-pipeline candidate; clients refresh on reconnect (user observed: business caps appear after Zed restart).

## Delivery note (2026-08-09) — D-125 structuredContent array wrap

Found by USING the MCP tools directly from the Zed agent surface (in-chat tool calls — `session_list` failed with `-32602 Invalid tools/call result: expected record, received array`). The adapter passed the raw kernel output into `CallToolResult.structuredContent`; the MCP SDK's schema demands a RECORD, so every array-returning capability (session.list, tenant.list, capability.list, client.list, …) broke at the SDK validation layer.
- **Fix:** `translate.ts` callTool wraps array/null outputs as `{items: <output>}`; records pass through; text content always carries the raw JSON.
- **Tests:** `translate.test.ts` +2 (array wrap, null wrap) — 20/20 in that file, 44/44 adapter-mcp total.
- **Docs:** PRD-TRD Scenario 2 note + API-contract row + architecture diagram amended. D-125 written + resolved in `docs/drift.md`.

> wiring in `packages/agentide/src/factory.ts`. All code references are to
> in-tree paths; no behavior was changed during this retro-fit.

## Phase Index

| # | Phase | Status | Module(s) | Tests |
|---|---|---|---|---|
| 0.5 | Pre-impl sim (HTML mock) | Done | `docs/features/mcp-adapter/archive/simulate-pre.html` | n/a |
| 1 | Error map + types | Done | `packages/adapter-mcp/src/{error-map,types}.ts` | covered by Phase 6 |
| 2 | Pure translation logic | Done | `packages/adapter-mcp/src/translate.ts` | `__tests__/translate.test.ts` (18) |
| 3 | Streamable HTTP server seam | Done | `packages/adapter-mcp/src/server.ts` | `__tests__/server.test.ts` (7) |
| 4 | Factory + wire-error protocol glue | Done | `packages/adapter-mcp/src/index.ts` | covered by Phase 6 |
| 5 | Meta-package wiring (auto-register) | Done | `packages/agentide/src/{factory,index}.ts` | `agentide/src/__tests__/mcp-adapter.test.ts` (5) |
| 6 | End-to-end PRD scenarios | Done | (no new code) | `adapter-mcp/src/__tests__/scenarios.test.ts` (13) |
| 7 | Post-impl sim (drives real stack) | Done | `packages/agentide/scripts/simulate-mcp-adapter.mjs` | n/a (script; 7/8 PRD scenarios) |

Test totals across the three adapter-mcp test files: **38** (18 + 7 + 13). See
drift D-30 — the sim's self-narration says "39"; that is off-by-one and is
accepted as-is.

---

## Phase 0.5 — Pre-impl sim

**Goal:** Lock the JSON-RPC error table and the request envelope shape before
writing transport code.

**Delivered:** [archive/simulate-pre.html](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/mcp-adapter/archive/simulate-pre.html).
A single-page HTML mock with a textarea-driven JSON-RPC request and two output
panels: (1) the wire response the adapter would return, and (2) the canonical
invocation the adapter would forward to `gateway.handleInvocation()`. Mock
bearer is `mock-jwt`; mock catalog is 25 platform caps + 3 mock SDK caps.

**Why archived:** The pre-impl sim used a hardcoded `mock-jwt` placeholder and
hardcoded tool catalog. The shipped adapter parses real bearer tokens and
queries `capability.list` for the live registry filtered by the caller's scope.
Both evolutions are correct (drift D-29..D-32 §design-drift 1+2 in the review).

**CIDs:** n/a (HTML only).

---

## Phase 1 — Error map + types

**Goal:** Define the wire-facing error envelope and the public types the
factory returns.

**Delivered:**

- [error-map.ts:30-58](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/error-map.ts#L30-L58) — `gatewayErrorToJsonRpc(code, message, capabilityName?)`. Maps the 8 kernel error codes (`AUTH_FAILED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `CAPABILITY_NOT_FOUND`, `INSUFFICIENT_SCOPE`, `RATE_LIMIT_EXCEEDED`, `PLUGIN_DISABLED`, `SDK_UNREACHABLE`, `INTERNAL_ERROR`, `HANDLER_ERROR`) to the PRD's wire code table. `HANDLER_TIMEOUT` is deliberately **not** mapped here — `callTool` turns it into `isError: true` instead (see Phase 2). The default branch wraps the kernel code verbatim so unmapped codes are still visible to operators.
- [types.ts:18-21](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/types.ts#L18-L21) — `McpAdapterConfig` (port default 7100, host default 127.0.0.1).
- [types.ts:27-32](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/types.ts#L27-L32) — `McpAdapter` interface (kernel `Adapter` conformance + `port` accessor for OS-assigned ports).
- [types.ts:39-41](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/types.ts#L39-L41) — `RequestCtx` (bearer token only; sessionId is read from `_meta` by the handlers).

**CIDs:** `error-map-001`, `error-map-002`, `types-001`, `types-002`, `types-003`.

**Validation gate:** All 10 PRD error codes map to the wire codes the PRD
asserts verbatim — verified by Phase 6 scenarios 4, 5, 8, 8b.

---

## Phase 2 — Pure translation logic

**Goal:** Translate MCP wire format to canonical invocation and back, with zero
I/O. The module takes a `Gateway` reference and stays unit-testable with mocks.

**Delivered:** [translate.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/translate.ts) (233 lines).

| Function | Purpose | PRD scenario |
|---|---|---|
| `validateMeta` ([translate.ts:41-46](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/translate.ts#L41-L46)) | `_meta` presence gate — both `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` must be present and non-null | 6 |
| `decodeScopeFromToken` ([translate.ts:54-73](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/translate.ts#L54-L73)) | Decode JWT payload scope claim for `capability.list` tier filtering (BI[7]) | 1 |
| `listTools` ([translate.ts:138-177](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/translate.ts#L138-L177)) | `capability.list` filtered by caller's scope, enriched per-card via `capability.describe`. Describe-denied callers still get the card with a generic schema so the catalog stays visible per BI[7] (authz is enforced at call time, not at list time). | 1 |
| `callTool` ([translate.ts:198-233](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/translate.ts#L198-L233)) | One MCP `tools/call` → canonical invocation → MCP `CallToolResult`. `HANDLER_TIMEOUT` becomes `isError: true` (not a JSON-RPC error) per PRD §Success response. | 2, 3, 4, 5, 8, timeout path |

**CIDs:** `translate-001` through `translate-007`.

**Tests:** [__tests__/translate.test.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/__tests__/translate.test.ts) — 18 tests covering each function in isolation with a mock `Gateway`.

**Validation gate:** `npm run test -w @platform/adapter-mcp` — `translate.test.ts` passes 18/18.

---

## Phase 3 — Streamable HTTP server seam

**Goal:** Bind an HTTP server, route `/mcp` traffic to the MCP transport, and
carry the per-request bearer token via `AsyncLocalStorage` so MCP handler
callbacks can read it (the transport doesn't expose request headers to handler
callbacks).

**Delivered:** [server.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts) (144 lines).

- [server.ts:90-94](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L90-L94) — `WebStandardStreamableHTTPServerTransport` in **stateless** mode (BI[9] GRILL Q1): `sessionIdGenerator: undefined`, `enableJsonResponse: true`. No session-header dance, no init requirement, raw JSON-RPC POSTs work.
- [server.ts:36-40](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L36-L40) — `requestCtxStore: AsyncLocalStorage<RequestCtx>`. Per-request context readable from handler callbacks.
- [server.ts:42-46](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L42-L46) — `extractBearer` — `Authorization: Bearer <jwt>` regex parse.
- [server.ts:48-70](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L48-L70) — `toWebRequest` — Node `IncomingMessage` → Web `Request` adapter.
- [server.ts:96-110](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L96-L110) — `startMcpHttpServer` — bind HTTP server, route `/mcp` to the transport, 404 for everything else.
- [server.ts:128-143](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/server.ts#L128-L143) — `handleTransportRequest` — wraps the transport call in `requestCtxStore.run(ctx, ...)` so the bearer token is in scope for MCP handler callbacks.

**CIDs:** `server-001`, `server-002`, `server-003`.

**Tests:** [__tests__/server.test.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/__tests__/server.test.ts) — 7 tests:
- 200 + `-32601` (MethodNotFound) for bare Server with no handlers
- 200 + `-32700` (Parse error) for malformed JSON
- 200 + `-32601` for unknown method with valid JSON-RPC envelope
- 406 + `-32000` for GET without `Accept: text/event-stream` (Streamable HTTP SSE requirement)
- stop() is idempotent
- 404 for non-`/mcp` paths
- Bearer token extracted into AsyncLocalStorage context (verified by handler callback)

**Validation gate:** `npm run test -w @platform/adapter-mcp` — `server.test.ts` passes 7/7.

---

## Phase 4 — Factory + wire-error protocol glue

**Goal:** Build `createMcpAdapter(gateway, config?)` that returns the
`McpAdapter` handle. Register the two PRD handler callbacks (`tools/list` and
`tools/call`) on a low-level MCP `Server`, run them inside the per-request
`AsyncLocalStorage` context, and translate kernel `{error}` outcomes into
JSON-RPC errors via a `WireError` class that the SDK's protocol layer
serializes verbatim.

**Delivered:** [index.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts) (142 lines).

Key design decisions (locked in code comments):

- [index.ts:24](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L24) — Use the **low-level** `Server` from `@modelcontextprotocol/sdk/server/index.js`, not the high-level `McpServer` wrapper. `McpServer` intercepts unknown tool calls with `-32602` (invalid params), which would mask PRD Scenario 4's `-32001` (capability not found) — so we use the low-level Server and register handlers ourselves.
- [index.ts:36-39](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L36-L39) — `WireError` is a plain `Error` subclass with a numeric `code` property. We don't throw the SDK's `McpError` because it prefixes messages with `"MCP error <code>: "` (see `@modelcontextprotocol/sdk/dist/esm/types.js`), and the PRD asserts wire messages verbatim (e.g. `"GATEWAY_INSUFFICIENT_SCOPE"`).
- [index.ts:77-95](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L77-L95) — `tools/list` handler: read bearer from `getRequestCtx()`, throw `WireError(-32001, "GATEWAY_AUTH_FAILED")` if empty, validate `_meta` (throw `-32602` on failure), call `listTools(gateway, token)`, return `{ tools }`.
- [index.ts:97-126](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L97-L126) — `tools/call` handler: same auth + meta gates, extract `sessionId` from `_meta.dev.agentide/sessionId` if present, call `callTool(gateway, ...)`, throw `WireError` with the wire code produced by `gatewayErrorToJsonRpc`, return `{ content, structuredContent, isError }` for the success path.
- [index.ts:61-67](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L61-L67) — `start()` is idempotent (subsequent calls are no-ops; the `handle !== null` check).
- [index.ts:130-135](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L130-L135) — `stop()` is idempotent (subsequent calls are no-ops; nulls the handle before awaiting so a stop-during-stop is safe).
- [index.ts:136-138](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/index.ts#L136-L138) — `port` accessor returns `null` before `start()` and the bound port after.

**CIDs:** `index-001` (createMcpAdapter), `index-002` (WireError).

**Validation gate:** All 8 PRD scenarios + timeout path have verbatim-wire-message assertions (covered by Phase 6).

---

## Phase 5 — Meta-package wiring (auto-register)

**Goal:** `createPlatform()` from `@platform/agentide` auto-registers the MCP
adapter unless the caller passes `adapterMcp: false`. Lifecycle is wired
(start after gateway + backendRuntime; stop before backendRuntime).

**Delivered:**

- [packages/agentide/src/factory.ts:33](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L33) — Import `createMcpAdapter` and `McpAdapter` from `@platform/adapter-mcp`.
- [packages/agentide/src/factory.ts:38-39](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L38-L39) — Defaults: port 7100, host 127.0.0.1.
- [packages/agentide/src/factory.ts:139-146](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L139-L146) — `if (config.adapterMcp !== false)` → create + start. The CLI passes `adapterMcp: false` explicitly because CLI invocations are short-lived and binding 7100 would race across runs.
- [packages/agentide/src/factory.ts:149-164](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L149-L164) — `stop()` order: MCP first (closes the port cleanly), then backendRuntime (so in-flight dispatches fail fast with `GATEWAY_SDK_UNREACHABLE`).
- [packages/agentide/src/index.ts:11-14](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/index.ts#L11-L14) — Re-export `McpAdapter` and `McpAdapterConfig` so consumers wiring their own platform can use the same types the meta-package auto-registers.
- [packages/agentide/src/__tests__/mcp-adapter.test.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/__tests__/mcp-adapter.test.ts) — 5 BI[9] Phase 5 wiring tests (CID:agentide-mcp-test-001..004):
  - 001: `createPlatform` exposes `mcpAdapter` with a bound port by default
  - 002: `tools/list` round-trip via real `fetch` returns the registered cap
  - 002b: `tools/call` on a platform cap (`session.create`) flows through the kernel
  - 003: `platform.stop()` releases the MCP port
  - 004: `adapterMcp: false` suppresses the adapter; `stop()` stays safe

**CIDs:** `platform-factory-001`, `platform-factory-002`, `agentide-mcp-test-001..004`.

**Validation gate:** `npm run test -w @platform/agentide` — `mcp-adapter.test.ts` passes 5/5. End-to-end createPlatform + MCP round-trip works on OS-assigned port (`adapterMcpPort: 0`), so parallel vitest workers don't collide on 7100.

---

## Phase 6 — End-to-end PRD scenarios

**Goal:** Drive the real `createMcpAdapter` + real gateway kernel end-to-end
over real HTTP at `/mcp` and assert the wire messages verbatim. This is the
contract gate: every PRD scenario must have at least one passing assertion here.

**Delivered:** [__tests__/scenarios.test.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/__tests__/scenarios.test.ts) (217 lines, 13 tests).

| Test | PRD scenario | What it asserts |
|---|---|---|
| 1 (line 27) | Scenario 1: tools/list | `tools[].annotations.tier`, `tools[].inputSchema` |
| 2 (line 44) | Scenario 2: business-cap dispatch | `result.content[0].text` contains the customer id, `result.structuredContent` matches the fixture, `fakeSdk.dispatched[0].sessionId` is the session id from `_meta` |
| 3 (line 64) | Scenario 3: platform-cap dispatch | `result.structuredContent.id` is a string session id |
| 4 (line 78) | Scenario 4: not found | `error.code === -32001`, `error.message === "capability 'X' not found"` |
| 5 (line 95) | Scenario 5: insufficient scope | `error.code === -32002`, `error.message === "GATEWAY_INSUFFICIENT_SCOPE"` |
| 6 (line 109) | Scenario 6: missing `_meta` | `error.code === -32602`, `error.message` matches `/Missing required _meta/` |
| 7 (line 121) | Scenario 7: unsupported method | `error.code === -32601`, `error.message` matches `/Method not found/` |
| 8 (line 133) | Scenario 8: missing bearer | `error.code === -32001`, `error.message === "GATEWAY_AUTH_FAILED"` |
| 8b (line 145) | Scenario 8b: expired token | `error.code === -32001`, `error.message === "GATEWAY_AUTH_FAILED"` |
| timeout (line 162) | HANDLER_TIMEOUT | `result.isError === true`, no JSON-RPC error, `content[0].text` matches `/exceeded/i` |
| lifecycle: stop (line 198) | (lifecycle) | stop() is idempotent, port is released |
| lifecycle: port (line 205) | (lifecycle) | `port === null` before `start()` |
| error code sanity (line 220) | (regression guard) | `ERROR_CODES.HANDLER_TIMEOUT === "GATEWAY_HANDLER_TIMEOUT"` (catches accidental renames) |

**Test harness:** [__tests__/harness.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/__tests__/harness.ts) — shared `InMemoryFs`, `FakeClock`, `SystemClock`, `makeToken`, `customerReadCard`, `makeNeverSdk`, `rpc`, `start`/`stop`/`track` helpers. Kept in a separate file so the spec stays under the repo's 350-line limit.

**Validation gate:** `npm run test -w @platform/adapter-mcp` — `scenarios.test.ts` passes 13/13. Combined with Phases 2 + 3 tests, the package total is 38/38.

---

## Phase 7 — Post-impl sim

**Goal:** Drive the full stack (`@platform/agentide` + `@platform/adapter-mcp`
+ `@platform/gateway-core`) end-to-end from a script a human can run, and
report pass/fail per PRD scenario.

**Delivered:** [packages/agentide/scripts/simulate-mcp-adapter.mjs](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/scripts/simulate-mcp-adapter.mjs) (372 lines).

**Coverage:** 7 of 8 PRD scenarios + 8b demonstrated (1, 3, 4, 5, 6, 7, 8, 8b). Scenario 2 (business-cap dispatch through a fake SDK) and the timeout path are explicitly deferred to Phase 6's `scenarios.test.ts` because `createPlatform()` does not currently accept an injected `BackendRuntime` (drift D-31). The deferral is documented in the script's preamble.

**Run:** `node packages/agentide/scripts/simulate-mcp-adapter.mjs`

**Why hermetic and parallel-safe:** OS-assigned port (`adapterMcpPort: 0`,
`backendRuntimePort: 0`), 32-zero-byte secret seeded into the in-memory fs
before `createPlatform` reads it, and a fresh platform per scenario (no
cross-scenario state).

**Validation gate:** Running the script prints `8/8 scenarios passed` (the
seven PRD scenarios + 8b). Exit code 0 on success, 1 on failure.

---

## Validation Summary

| Gate | Status | Evidence |
|---|---|---|
| All 8 PRD scenarios + timeout covered by assertions | ✓ | [scenarios.test.ts](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/adapter-mcp/src/__tests__/scenarios.test.ts) (lines 27-196) |
| Wire messages match PRD verbatim | ✓ | Scenarios 4, 5, 6, 7, 8, 8b assert the exact strings the PRD lists |
| Meta-package auto-registers, supports opt-out | ✓ | [factory.ts:140-146](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L140-L146) + [mcp-adapter.test.ts:128,199](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/__tests__/mcp-adapter.test.ts#L128) |
| Lifecycle order correct (stop MCP before backendRuntime) | ✓ | [factory.ts:149-164](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/packages/agentide/src/factory.ts#L149-L164) |
| Post-impl sim runs end-to-end | ✓ | 8/8 scenarios pass via `node packages/agentide/scripts/simulate-mcp-adapter.mjs` |
| All source files under 350-line limit | ✓ | server.ts 144, translate.ts 233, index.ts 142, error-map.ts 59, types.ts 41 |
| Code Map headers + JSDoc + CID index in every file | ✓ | Verified by direct read |

## Open Drift Items (carried forward)

From the [drift review](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/.reports/2026-08-01-drift-mcp-adapter.md):

- **D-28** (this IMPL) — RESOLVED with this retro-fit.
- **D-29** (post-impl sim at non-standard path) — accepted, logged.
- **D-30** (sim says "39 tests", actual 38) — accepted, logged.
- **D-31** (sim defers Scenario 2 + timeout to adapter's test suite) — accepted, logged.
- **D-32** (meta-package mcp-adapter.test.ts covers only wiring) — accepted, logged.

## Files Touched

Implementation (unchanged by this IMPL retro-fit):

- `packages/adapter-mcp/src/{translate,server,index,error-map,types}.ts`
- `packages/adapter-mcp/src/__tests__/{translate,server,scenarios}.test.ts`
- `packages/adapter-mcp/src/__tests__/harness.ts`
- `packages/adapter-mcp/{package.json,tsconfig.json}`
- `packages/agentide/src/{factory,index}.ts`
- `packages/agentide/src/__tests__/mcp-adapter.test.ts`
- `packages/agentide/scripts/simulate-mcp-adapter.mjs`

Docs (this IMPL + pre-existing):

- `docs/features/mcp-adapter/PRD-TRD-mcp-adapter.md` (existed)
- `docs/features/mcp-adapter/GRILL-mcp-adapter.txt` (existed)
- `docs/features/mcp-adapter/archive/simulate-pre.html` (existed, archived)
- `docs/features/mcp-adapter/IMPL-mcp-adapter.md` (this file — retro-fitted 2026-08-01)
- `.reports/2026-08-01-drift-mcp-adapter.md` (drift review, 2026-08-01)
- `docs/drift-issue-log.md` (D-28..D-32 logged)
