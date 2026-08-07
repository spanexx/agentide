# A8 — MCP migration plan

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** — (delivery after A2–A6 resolve)
**Blocked by:** A1, A2, A3, A4, A5, A6

## Question

How does `adapter-mcp` move its pipeline onto adapter-core with zero behavior delta —
the cleanest of the two migrations because `translate.ts` is already pure?

## Context

- `translate.ts`: pure functions (validateMeta, decodeScopeFromToken → A6/A2,
  listTools → A6, callTool → A4), "fully unit-testable with a mock".
- `error-map.ts`: `gatewayErrorToJsonRpc` → A5.
- `server.ts`: HTTP/SSE transport + OAuth routes (extraction + transport — stays).
- Tests: translate, scenarios (8 PRD scenarios), server; sim `simulate-mcp-adapter.mjs`
  (8/8 scenarios, interconnected with sim-state).

## Sub-questions

1. After the move, what remains in `translate.ts`? (proposal: only what reads/writes
   MCP's own shapes — validateMeta + tool-card rendering)
2. Do the 8 PRD scenarios + 8/8 sim assertions double as the acceptance harness for
   zero-delta?
3. OAuth token routes (`server.ts`): shared with adapter-core or adapter-local?
   (proposal: local — transport-level)
4. Migration order: A6 first (listTools) then A4/A5, or whole-file moves?
