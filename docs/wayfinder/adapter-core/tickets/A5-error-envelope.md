# A5 — Error envelope: one neutral shape, per-adapter tables

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A7, A8
**Blocked by:** A1 (closed)

`delivery: decision-only` — design locked; the build happens via A7/A8.

## Resolution

1. **Envelope (Q1): `GatewayErrorPayload` IS the shared envelope — adapter-core
   re-exports it, no intermediate shape.** It is already protocol-neutral, already the
   kernel's contract (`@spanexx/errors`), already consumed by both doors. A new
   intermediate would fork the vocabulary. adapter-core re-exports the payload type +
   the `ERROR_CODES` catalog so doors import ONLY adapter-core (A1 rule). Rules out any
   `AdapterError`/`CanonicalError` wrapper (second vocabulary) and per-door payload
   re-implementations.
2. **Mechanics shared, tables adapter-local (Q2): adapter-core owns one generic
   converter — input `GatewayErrorPayload`, output a neutral "wire error request"
   (`code/message/details/retryable`, pre-render); each door hands its own `errors:
   table` into `createAdapterPipeline` (the A1 slot), mapping code → wire shape. The
   table stays in the door's own file (WS `errors.ts`, MCP `error-map.ts`) — wire
   shapes are the door's bytes. WS's passthrough-verbatim is a rendering policy, not a
   table entry. Rules out registered mappings in core (inverted ownership, module-load
   ordering hazards) and moving tables into core (zero-delta violation).
3. **Unmapped codes (Q3): shared default = MCP's existing fallback, door-configurable
   (Option A).** Converter default reproduces today's behavior exactly — MCP unknown
   code → `-32006` + `${code}: ${message}`; WS needs no fallback (verbatim passthrough
   — its table can declare an explicit `*` default if it wants, but none is required).
   Optionally combined with a setup-time catalog check (warn on unmapped codes — cheap
   guard). Rules out dropping the fallback (render would blow up on new codes) and
   inventing a new fallback code for WS (wire delta).
4. **Zero wire delta (Q4): NO WS close codes / MCP error codes change under the
   migration — asserted by test.** WS close codes (1008 auth, 1009 frame-too-large) and
   `WS_*` frame codes stay; MCP `-32001..-32006` + fallback stay. Acceptance rule: the
   existing error-path test suites (PRD Scenario 11 verbatim messages, close codes)
   run against the migrated pipeline with ZERO edits — any expected string/code change
   is a migration failure signal, not a test fix (A2 "asserted today = frozen forever"
   inherited). Rules out "improving" codes during migration and adding new vocabularies
   for errors that don't exist today.

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
