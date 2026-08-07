# IMPL — adapter-mcp migration onto @spanexx/adapter-core

**Status:** Draft (Phase 2)
**Date:** 2026-08-07
**Source:** GRILL-adapter-mcp.txt (5 green-at-each-step commits) + PRD-TRD-adapter-mcp.md

Every phase: `pnpm --filter @spanexx/adapter-mcp build && pnpm --filter @spanexx/adapter-mcp test`
must pass; repo-wide `pnpm build && pnpm test` green before the next phase.

Dependency addition (Phase 0, mechanical): `packages/adapter-mcp/package.json`
gains `"@spanexx/adapter-core": "workspace:*"`; `tsconfig.json` references `../adapter-core`.

## Phase 1 — Claims: `readClaims` replaces `decodeScopeFromToken`

**Build:**
- `packages/adapter-mcp/src/translate.ts` — remove local `decodeScopeFromToken`;
  export/use `readClaims` from `@spanexx/adapter-core` for scope reads at card-listing.
- Keep `translate.ts` pure (imports shared function, no G engine).
- The: `decodeScopeFromToken` behavior (base64url, `[]` defensive) exists already
  in `readClaims` → verifies byte-identical `listTools`.

**Prove:**
- Existing `translate.test.ts` unchanged and green (listing with scope cards).
- `decodeScopeFromToken` no longer present in `src/translate.ts` (grep).

## Phase 2 — Error converter shares the envelope

- [ ] Add the door's JSON-RPC mapping as a table for `createErrorConverter`
  (input `GatewayErrorPoint`, output wire error request). `error-map.ts` becomes
  the table source; conversion mechanics move to adapter-core's shared converter.
- Wire codes `-32000..-32006` and messages (incl. `GATEWAY_*` verbatim) unchanged.

**Prove:**
- `server.test.ts` (JSON-RPC error cases) + `scenarios.test.ts` unchanged, green.
- Adapter-mcp tests still assert the same codes.

## Phase 3 — Capability lookup via shared utility

- [ ] `listTools` builds through `createCapabilityLookup({ gateway, errors })`
  — `list(token)` + per-card `describe(name, token)`.
- Keep tool-card rendering (name/description/input schema; ordering) in
  `translate.ts` — bytes identical.

**Prove:**
- `translate.test.ts` column-party-unchanged green (incl. tier filter result).
- `lookup` imported from `@spanexx/adapter-core` (grep).

## Phase 4 — Invocation through the shared pipeline

- [ ] `callTool` routes via `createAdapterPipeline({gateway, errors, response})`
  channel strategy: MCP sink merges chunks into one `CallToolResult`; single
  invocation exactly-once end.
- WireError handling: pipeline's `endError` emits the door's rendered error —
  `server.ts` render stays.
- Channel's per-corr `sink` created per invocation (correctness with the door's
  own AsyncLocalStorage token flow).

**Prove:**
- `scenarios.test.ts` + `simulate-mcp-adapter.mjs` 8/8 unedited green.
- Adapter tests assert single `CallToolResult` per invoke (exit `isError` on
  error unchanged).

## Phase 5 — Real lazy auth mode (first consumer) + new test

- [ ] Ensure the door calls NO auth-verify helper at open / per request —
  adapter-core's pipeline already forwards the token; kernel verifies per call.
  Remove any door-side verification scaffolding if existex (none expected today).
- NEW unit test: `lazy-verify.test.ts` — invoke with token reaches kernel
  verification; error path returns the kernel's error (not a door-level claim
  check); the door never reads claim identity for normal tokens.

**Prove:**
- New test passes; full MCP suite green; repo `pnpm build && pnpm test` green.
- D-005 deferral note updated (or closed) in docs/drift.md following review.

## Phase 6 — Post-impl sim + drift review

- [ ] `docs/features/adapter-mcp/simulate.sh` — runs `simulate-mcp-adapter.mjs`
  (8/8) + repo build + `pnpm test` MCP suites; ANSI-strip (A7 lesson).
- [ ] replay drift review (feature-pipeline-revetwillskill) → `.reports/`
- [ ] Reconcile/archive pre-sim (N/A — this pack literally shares the MCP sim).

## Pre-flight note

`docs/features/adapter-core/` is the sibling pack that shipped A7; this pack mirrors
its structure. Pack slug: `adapter-mcp`.