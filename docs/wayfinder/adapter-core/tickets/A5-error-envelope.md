# A5 — Error envelope: one neutral shape, per-adapter tables

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** A7, A8
**Blocked by:** A1

## Question

Both adapters map the shared `ERROR_CODES` catalog into their own wire error shapes
(WS frame errors, MCP JSON-RPC codes -32001..-32006). Zero-delta migration means the
OUTER shapes must not change. What does the shared error envelope look like so each
adapter keeps its own mapping table but the conversion logic lives once?

## Context

- Kernel: `GatewayErrorPayload` — `{ code, message, details, retryable }` — the neutral
  shape already.
- WS: `adapter-websocket/src/errors.ts` — `WS_ERROR_CODES`, frame-level error text.
- MCP: `adapter-mcp/src/error-map.ts` — `gatewayErrorToJsonRpc` → JSON-RPC error objects.
- `@spanexx/errors` — the 18-code catalog both adapters start from.

## Sub-questions

1. Is `GatewayErrorPayload` itself the shared envelope (adapter-core re-exports it), or
   does adapter-core define its own intermediate?
2. Per-adapter mapping tables: do they live in adapter-core as registered mappings, or
   stay in the adapter with only the *mechanics* (table lookup, defaulting, retryable
   propagation) shared? (proposal: mechanics shared, tables adapter-local — zero delta)
3. What happens to codes with no adapter mapping — same fallback as today?
4. Do any WS close codes / MCP error codes change under the migration? (must: none)
