# PRD-TRD — adapter-mcp migration onto @spanexx/adapter-core

**Status:** Draft (Phase 1)
**Date:** 2026-08-07
**Source:** wayfinder A8 lock; GRILL-adapter-mcp.txt; sibling pack `docs/features/adapter-core/`
**Delivery:** feature-pipeline pack; after drift review → release

## Why this exists

The WebSocket door and the MCP door each rebuilt the same server-side plumbing —
identity, capability lookup, error translation, invocation forwarding, response
delivery. The shared foundation (`@spanexx/adapter-core`, shipped 0.2.1) now owns
that plumbing; the WebSocket door already stands on it. This pack moves the MCP door
onto the same foundation, so the two doors are identical underneath, and proves the
A9 claim that a new door costs only its input/output translation.

## What it does (behavioral spec — operator-visible)

Nothing changes for anyone using MCP. Byte-for-byte, the MCP door:

1. **8 PRD scenarios unchanged** — the original pack's scenarios (`docs/features/mcp-adapter/`)
   pass identical: tool listing, tool invocation, invalid `_meta`, capability-missing
   mapping, insufficient-scope messages verbatim, stateless vs. sessionId passthrough,
   OAuth token route, transport.
2. **Same wire contract** — JSON-RPC 2.0, error codes `-32000`..`-32006` (defaults
   included), messages unchanged (e.g. `GATEWAY_INSUFFICIENT_SCOPE` verbatim),
   `CallToolResult` shape unchanged.
3. **Same capabilities surface** — `listTools` emits the same tool cards in the same
   order (tool-card rendering stays in the door).
4. **Same transport** — HTTP/SSE server, OAuth/`token` routes, bearer extraction,
   AsyncLocalStorage token flow — all unchanged.
5. **One behavior gains the real lazy mode (new)** — the shared foundation's lazy
   auth path (kernel verifies each call, no door-level identity) becomes the MCP
   path, exercised for the first time. This is invisible externally (same token,
   same kernel verification, same errors) but closes the "lazy is a copy of early"
   deferral (D-95).

Internal: the package's server-side logic delegates to adapter-core
(`createAdapterPipeline`, `createCapabilityLookup`, `createErrorConverter`,
`readClaims`, `RecordRegistry`); remaining door files are those the A8 lock listed.

## Simulation contract (post-impl sim must demonstrate)

- `packages/agentide/scripts/simulate-mcp-adapter.mjs` runs **8/8 unchanged** —
  same markers, same scenario list, no edits.
- The adapter-mcp unit suite (translate / tool / server / transport tests) runs
  **unedited** and green — the zero-delta oracle.
- NEW unit test: lazy-verify proof — an invoke with an invalid token must reach
  the kernel's verification and return the kernel's error shape (no adapter-side
  identity cache exists).
- NEW unit test: the door makes NO adapter-side verify call at all (it never
  touches a "verify at dispatch" helper for normal tokens).

## Technical design

### Target public surface after migration

`adapter-mcp/src/` after migration:

| File | Role (after) |
|---|---|
| `server.ts` | Transport + OAuth routes (unchanged) |
| `translate.ts` | MCP-only: `validateMeta`, tool-card rendering, listing → composes lookup |; no token/claim logic left |
| `error-map.ts` | Door's error **table** for the shared converter (mapping stays door-local, mechanics move) |
| `types.ts` | Door types (`WireError`, `Meta`, session keys) |
| `index.ts` | `createMcpAdapter` wiring — creates pipeline + lookup + converter; element names |

### What the door hands to adapter-core (one constructor)

```
createAdapterPipeline({
  gateway,                       // from createPlatform
  errors: createErrorConverter({ table: MCP_JSONRPC_TABLE, defaultCode: -32000 }),
  response: (correlationId) => mcpResponseSink(correlationId),  // merges chunks → one Reply
})
```

- `invocation`: `{correlationId: <c>, token, name, input?, sessionId?, mode}` —
  MCP has no `mode: "stream"` in v1; single result.
- `createCapabilityLookup({ gateway, errors } )` — `list(token)`/`describe(name, token)`
  backing `listTools`; Card rendering stays in `translate.ts`.
- `readClaims(token)` replaces `decodeScopeFromToken` (same base64url parse, same
  defensive `[]`).
- Auth: **no** `createAuthPolicy` call at the door — that is the lazy mode by
  definition (kernel per-call verification).
- Errors: `createErrorConverter` with the door table (JSON-RPC code map) keeps
  `-32000..-32006` messages verbatim.

### What does NOT change in the package

- dependencies already declared: `@spanexx/adapter-core` (workspace) only added.
- consumed public exports by `agentide` etc. stay.

## Non-goals

- No new MCP features, no wire protocol changes, no OAuth changes.
- No event-bus emitters added.
- No session lifecycle ownership (A3: pass-through only; auto-mint stays consumer-side).
- No kernel changes (no streaming, no auth changes).
- No CJS variants.