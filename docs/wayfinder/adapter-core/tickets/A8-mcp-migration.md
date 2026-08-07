# A8 — MCP migration plan

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** — (delivery after locks)
**Blocked by:** A1, A2, A3, A4, A5, A6 (all closed)

`delivery: feature-pipeline` — the migration builds as a pack on `docs/features/adapter-core/` (post-A7 precedent).

## Resolution

1. **Auth (Q1):** MCP becomes the first REAL `lazy` consumer — the shared package's lazy
   path gets implemented (per-call kernel verification, no door-side caching) instead of
   the today's early-copy stub. Closes the D deferral. Zero-delta: visible behavior
   unchanged (same token, same kernel verify, same JSON-RPC error codes).
2. **Residual door surface (Q2):** four things stay in adapter-mcp — (a) the HTTP/SSE
   transport server, (b) MCP-shaped rendering (tool cards + merging chunks into one
   CallToolResult via the door's response strategy), (c) the local error table,
   (d) the OAuth/token routes (transport-level identity flows, door-specific — NOT
   shared; REST will have its own). Everything else moves to/through adapter-core:
   invocation, auth policy, capability lookup, error envelope, claims reader,
   response channel.
3. **Acceptance bar (Q3):** the WS playbook reused — existing MCP tests (4 files incl.
   8 PRD scenarios) run UNEDITED and green; post-impl sim 8/8; public exports stay
   compatible with the agentide wiring. Anything unasserted may change. The lazy path
   is NEW behavior → gets its own new test, not a re-run.
4. **Migration order (Q4):** five green-at-each-step commits — (1) claims swap
   (`readClaims`), (2) error envelope import source, (3) capability lookup util,
   (4) pipeline + response strategy (callTool), (5) real lazy mode + new test.

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
