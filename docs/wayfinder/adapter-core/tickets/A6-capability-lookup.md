# A6 — Capability lookup: shared list/describe + tier filter

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** A7, A8
**Blocked by:** A1

## Question

Only MCP does capability discovery today (`listTools` → `capability.list` +
`capability.describe` + scope-based tier filtering). Should that move into adapter-core
as an optional shared utility — so the WS adapter and any future adapter can get the
same behavior without re-writing it?

## Context

- MCP: `adapter-mcp/src/translate.ts` — `listTools` calls `handleInvocation` with
  `capability.list` / `capability.describe`, filters tiers via `decodeScopeFromToken`.
- WS: no discovery today — registry.ts is per-connection bookkeeping only.
- Kernel: `capability.list` supports tier filtering (authz tier-aware, factory.ts
  `capability.list` filter); the `--tier` CLI flag exists.

## Sub-questions

1. Utility shape: `createCapabilityLookup(gateway, tokenScopeDecoder?)` returning
   `list()`, `describe(name)`, `listByTier()` — or leaner?
2. Zero-delta: MCP's tool list must come out byte-identical — does moving
   `listTools` under core preserve ordering, descriptions, error codes?
3. Does the scope-decoder (`decodeScopeFromToken`) move to core as the standard claim
   reader (shared with A2)?
4. WS adapter gains the utility but no new behavior in v1 — confirm the migration does
   not wire discovery into WS frames.
