# PRD-TRD: mcp-adapter

**Slug:** mcp-adapter
**Status:** Approved
**Date:** 2026-07-29

## Why This Exists

After `gateway-sdk-dispatch` (BI[8b) ships, the platform can route a `business.*` capability to a developer's app via the SDK. But nothing external can *call* the platform. The architecture (`docs/architecture/Agentide.md` §8) explicitly names MCP as the first external protocol: "MCP adapter is bundled in the default distribution. Listen on `config.adapter.mcp.port` (default 7100)."

Today zero adapters exist. The kernel's `Adapter` interface (`gateway-core/src/types.ts:161-167`) is declared but no implementation ships. Any AI agent (Claude Desktop, Continue, Cursor, custom MCP clients) that wants to discover and invoke Agentide capabilities has nowhere to land.

The cost of leaving this unsolved: the entire platform is process-local. Operators can run scripts that call `gateway.handleInvocation()` directly, but no remote agent can reach it. Every SDK that ships is unreachable from outside the host.

## Behavioral Spec

### Scenario 1: an MCP client connects and lists available capabilities

**Given** the Gateway is running with the MCP adapter listening on port 7100; an MCP client sends `POST /mcp` with a valid bearer token in `Authorization: Bearer <jwt>` and JSON-RPC body `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}`
**When** the adapter parses the request, decodes the caller's scope from the bearer token, and calls `gateway.handleInvocation({token, capability:{name:"capability.list"}, input:{ scope }})` — the decoded scope is what lets the kernel apply BI[7] tier filtering
**Then** the adapter returns `{"jsonrpc":"2.0","id":1,"result":{"tools":[<Tool[]>]}}` where each Tool is `{name, description, inputSchema, annotations:{tier}}`. The list honors BI[7] tier filtering: a caller with `platform.*.read` sees only read-tier platform caps.

### Scenario 2: an MCP client invokes a business capability through the SDK

**Given** Scenario 1 just completed; `customer-app` SDK is connected via BI[8b) and registered `customer.read`; an MCP client sends `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"customer.read","arguments":{"id":"c-042"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}},"dev.agentide/sessionId":"sess-001"}}}`
**When** the adapter calls `gateway.handleInvocation({token, capability:{name:"customer.read"}, input:{id:"c-042"}, sessionId:"sess-001"})`
**Then** the adapter returns `{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"<serialized>"}],"structuredContent":<output>}}`. Round-trip latency: same as direct `handleInvocation` (no overhead beyond JSON-RPC envelope).

### Scenario 3: an MCP client invokes a platform capability

**Given** Scenario 1 just completed; an MCP client with `platform.session.write` scope sends `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session.create","arguments":{},"_meta":{...}}}`
**When** the adapter calls `gateway.handleInvocation({token, capability:{name:"session.create"}, input:{}})`
**Then** the adapter returns the result wrapped in MCP `CallToolResult` format. The platform capability flows through the same path as any business capability from the MCP client's perspective.

### Scenario 4: MCP client calls a capability that does not exist

**Given** any state **with an active session** (the kernel's session check precedes capability resolution, so business-capability calls without a session return `-32006` `GATEWAY_SESSION_REQUIRED` — see error table fallback row — instead of reaching the not-found path)
**When** an MCP client sends `{"method":"tools/call","params":{"name":"customer.refund","arguments":{}}}`
**Then** the adapter returns `{"jsonrpc":"2.0","id":<n>,"error":{"code":-32001,"message":"capability 'customer.refund' not found"}}`.

### Scenario 5: MCP client lacks the required scope

**Given** a caller with `customer.read` scope
**When** the MCP client sends `{"method":"tools/call","params":{"name":"customer.delete","arguments":{"id":"c-042"}}}`
**Then** the adapter returns `{"error":{"code":-32002,"message":"GATEWAY_INSUFFICIENT_SCOPE"}}` — no handler is invoked.

### Scenario 6: MCP client omits required `_meta` fields

**Given** an MCP client sends `{"method":"tools/list","params":{}}` with no `_meta`
**When** the adapter parses the request
**Then** the adapter returns `{"error":{"code":-32602,"message":"Missing required _meta.io.modelcontextprotocol/protocolVersion or clientCapabilities"}}` per the MCP spec — handler is never invoked.

### Scenario 7: MCP client calls an unsupported method (`prompts/list`, `resources/list`, etc.)

**Given** any state with a valid bearer token
**When** the MCP client sends `{"method":"prompts/list"}` or `{"method":"resources/list"}` or any non-tool method
**Then** the adapter returns `{"error":{"code":-32601,"message":"Method not found: <method>"}}` per Q6 (tools only). Agentide exposes no prompts/resources today.

### Scenario 8: bearer token is missing or invalid

**Given** an MCP client sends a request without `Authorization: Bearer <jwt>` (or with an expired JWT)
**When** the adapter forwards to `gateway.handleInvocation` with an empty / invalid `token`
**Then** the kernel rejects with `GATEWAY_AUTH_FAILED`; the adapter returns `{"error":{"code":-32001,"message":"GATEWAY_AUTH_FAILED"}}` (auth failures map to capability-not-found by convention so the client can't enumerate auth state).

## Simulation Contract

The post-impl simulation MUST demonstrate all 8 scenarios:

```bash
# Scenario 1: tools/list
send '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'
# → result.tools[] includes platform caps (visible to bootstrap) + business caps from connected SDKs

# Scenario 2: invoke business cap (SDK path)
send '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"customer.read","arguments":{"id":"c-042"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}},"dev.agentide/sessionId":"sess-001"}}}'
# → result.content[0].text contains customer data, structuredContent has the parsed object

# Scenario 3: invoke platform cap
send '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session.create","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'
# → result.content[0].text contains sessionId

# Scenario 4: not found
send '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"customer.refund","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'
# → error.code = -32001

# Scenario 5: insufficient scope (call with read-only token, attempt write cap)
send '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"customer.delete","arguments":{"id":"c-042"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'
# (with read-only token) → error.code = -32002

# Scenario 6: missing _meta
send '{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{}}'
# → error.code = -32602

# Scenario 7: unsupported method
send '{"jsonrpc":"2.0","id":7,"method":"prompts/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'
# → error.code = -32601

# Scenario 8: missing/invalid bearer
send '{"jsonrpc":"2.0","id":8,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientCapabilities":{"tools":{}}}}}'  # no Authorization header
# → error.code = -32001 (GATEWAY_AUTH_FAILED maps here)
```

## Technical Design

### Data Models

The MCP adapter has no persistent state. It holds:
- One HTTP server (`@modelcontextprotocol/typescript-sdk`'s `WebStandardStreamableHTTPServerTransport`)
- A reference to the `Gateway` (passed at registration; calls `gateway.handleInvocation` per request)

Token/sessionId extraction is per-request:
- `Authorization: Bearer <jwt>` header → `req.token`
- `_meta.dev.agentide/sessionId` → `req.sessionId`

### API Contracts

Implements the kernel's `Adapter` interface (`gateway-core/src/types.ts:161-167`):

```ts
function createMcpAdapter(gateway: Gateway, config?: McpAdapterConfig): Adapter

interface McpAdapterConfig {
  readonly port?: number;         // default 7100
  readonly host?: string;         // default "127.0.0.1"
}

interface Adapter {
  readonly name: "mcp";
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

JSON-RPC error codes returned to MCP clients (per `PRD-gateway-core.md:213` and Q6):

| Gateway error | JSON-RPC code | Meaning |
|---|---|---|
| `GATEWAY_CAPABILITY_NOT_FOUND` | `-32001` | cap not in registry |
| `GATEWAY_INSUFFICIENT_SCOPE` | `-32002` | tier check failed |
| `GATEWAY_RATE_LIMIT_EXCEEDED` | `-32003` | token bucket empty |
| `GATEWAY_PLUGIN_DISABLED` | `-32004` | runtime plugin paused |
| `GATEWAY_SDK_UNREACHABLE` | `-32005` | no SDK connection for owner |
| `GATEWAY_INTERNAL_ERROR` | `-32006` | handler threw |
| `GATEWAY_HANDLER_TIMEOUT` | *(no JSON-RPC code — superseded)* | handler timeouts return an `isError: true` result, not a JSON-RPC error (see Success response shape; earlier `-32007` mapping deprecated) |
| `GATEWAY_SESSION_REQUIRED` | `-32006` (fallback) | business capability called without an active session — session check precedes capability resolution |
| any other unmapped kernel code (`TENANT_MISMATCH`, `INVALID_REQUEST`, …) | `-32006` (fallback) | `{code: -32006, message: "<KERNEL_CODE>: <kernel msg>"}` — kernel error identifiers are echoed in the wire message for unmapped codes |
| missing protocolVersion in `_meta` | `-32602` | JSON-RPC invalid params |
| unknown method (`prompts/*`, `resources/*`, etc.) | `-32601` | JSON-RPC method not found |
| `GATEWAY_AUTH_FAILED` | `-32001` | mapped to capability-not-found (no enumeration of auth state) |

Success response shape:
- `tools/list`: `{tools: [{name, description, inputSchema, annotations: {tier}}]}`
- `tools/call`: `{content: [{type: "text", text: "<serialized>"}], structuredContent: <output>}` — handler timeouts set `isError: true` instead of returning a JSON-RPC error (per MCP spec, tool-level errors live in the result).

### Dependencies

- **`@platform/gateway-core`** (workspace) — already shipped. The adapter holds a `Gateway` reference and calls `gateway.handleInvocation` per request. No kernel changes.
- **`@platform/event-bus`** (workspace) — already shipped. Optional; not subscribed to by the adapter itself.
- **`@modelcontextprotocol/typescript-sdk`** (third-party) — new dep on `@platform/adapter-mcp`. License: MIT. Maintenance: actively developed by the MCP working group; current version aligns with spec draft 2025-11-25. Alternative considered: hand-rolling Streamable HTTP + JSON-RPC 2.0 — rejected (Q5; spec is detailed, maintenance burden high).
- **`@platform/agentide`** (workspace) — composition: `createPlatform()` auto-registers the MCP adapter if `config.adapterMcp !== false` (default true).

### Architecture Notes

The MCP adapter is a new package `@platform/adapter-mcp`. It owns:
- The HTTP server (Streamable HTTP on port 7100)
- The MCP protocol details (`server.tool()` registration, `_meta` validation, error code mapping)
- The wire-format translation (MCP `Tool` ↔ canonical `CapabilityCard`, MCP `CallToolResult` ↔ canonical `{output}`)

The kernel change is zero: the adapter implements the existing `Adapter` interface and calls `gateway.handleInvocation()`. No new dispatch path, no new error codes — adapter-specific concerns stay in the adapter.

Data flow for an MCP `tools/call`:
```
MCP client
   │  POST /mcp
   │  Authorization: Bearer <jwt>
   │  {"jsonrpc":"2.0","id":N,"method":"tools/call","params":{"name":"customer.read","arguments":{...},"_meta":{...}}}
   ▼
MCP adapter (@platform/adapter-mcp)
   │  parse JSON-RPC envelope
   │  validate _meta.io.modelcontextprotocol/protocolVersion + clientCapabilities
   │  extract token from Authorization header
   │  extract sessionId from _meta.dev.agentide/sessionId
   ▼
gateway.handleInvocation({token, capability:{name:"customer.read"}, input, sessionId})
   │  authn → authz → dispatch
   ▼
dispatch by owner prefix:
   ├── owner = "gateway" / "session-manager" / "capability-registry" / "platform-*" → in-process handler
   ├── owner = "plugin:<id>"                                              → plugin manager
   └── owner = "backend-sdk-<appId>"                                      → Backend Runtime (BI[8b)
                                                                          → SDK WebSocket
                                                                          → handler runs
   ▼
adapter wraps {output} into MCP CallToolResult:
   │  {content: [{type:"text", text: serialize(output)}], structuredContent: output}
   ▼
MCP client
```

## Non-Goals

- **`prompts/list`, `resources/list`, `prompts/call`, `resources/read`, etc.** Returns `-32601` per Q6. Future pack may add prompts/resources if a use case emerges.
- **Server-initiated `notifications/*` (e.g., `notifications/tools/list_changed`).** MCP supports them; Agentide doesn't. Future pack.
- **`subscriptions/listen`, sampling, elicitation.** Out of v1 scope per MCP spec.
- **stdio transport.** Agentide ships Streamable HTTP only (`PRD-gateway-core.md:65`).
- **Legacy SSE transport.** Streamable HTTP replaces it; no backward compat.
- **Bearer token acquisition.** The adapter does NOT mint tokens; it accepts whatever `Authorization` header the client presents. Tokens are minted by `gateway.issueToken` (or `auth.token.issue` capability) — out of scope here.

## Out of Scope (Future)

- **Additional MCP methods** — when prompts/resources/sampling become Agentide concepts.
- **Stdio adapter** — for desktop MCP clients that prefer stdio over HTTP.
- **REST adapter (BI[10)**, **CLI adapter (BI[23)**, **WebSocket adapter (BI[24)** — each ships as its own pack, each implements the kernel `Adapter` interface, none depends on this one.
- **Multi-tenant adapter routing** — when one platform hosts multiple tenants, each with their own MCP endpoint. Today's adapter is single-tenant.

## References

- `GRILL-mcp-adapter.txt` — locked decisions (Q5-Q6)
- `GRILL-gateway-sdk-dispatch.txt` — dependency's locked decisions (Q1-Q4)
- `CONTEXT.md` — glossary (Adapter, Capability, Gateway)
- `IMPL-mcp-adapter.md` — execution plan (Phase 2)
- `packages/gateway-core/src/types.ts:161-167` — `Adapter` interface (kernel contract)
- `packages/gateway-core/src/factory.ts:146-157` — `registerAdapter` / `unregisterAdapter`
- `packages/agentide/src/factory.ts` — `createPlatform()` composition
- `docs/architecture/Agentide.md` §8 — adapter requirements
- `PRD-gateway-core.md` — JSON-RPC error code table (line 213)
- `IMPL-gateway-core.md:260-293` — MCP spec wire format sketch
- `docs/features/mcp-adapter/simulate-pre.html` — Phase 0.5 sim
- MCP spec draft 2025-11-25 (`https://modelcontextprotocol.io/`) — wire format authority