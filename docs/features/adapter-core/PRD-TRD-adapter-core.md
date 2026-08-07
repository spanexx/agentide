# PRD-TRD: adapter-core — shared door pipeline (A7: WS migration)

**Slug:** adapter-core
**Status:** Draft
**Date:** 2026-08-07

## Why This Exists

Every door adapter in this repo re-implements the same server-side plumbing: token
claim parsing, auth policy, error translation, capability lookup, connection/record
bookkeeping. The A11 inventory counted **16 duplicated files / 2,222 lines** of this
shared logic spread across `adapter-websocket` and `adapter-mcp`. Each new door (REST,
file, git, …) copies it again.

The six wayfinder grills (A1–A6) locked what "shared" means: a new `@spanexx/adapter-core`
package holding the *invocation pipeline* and its primitives, with doors keeping their
own bytes (wire frames, config, transport). A7 is the first migration — the WebSocket
server half moves onto core **with zero observable delta**: same exports, same wire
bytes, same test suite, unedited. The cost of leaving this unsolved compounds with
every door: three-way drift between WS, MCP, and the next adapter.

## Behavioral Spec

### Scenario 1: adapter-core exists and builds

**Given** the monorepo at HEAD
**When** `pnpm --filter @spanexx/adapter-core build` runs
**Then** the package compiles and exports the canonical surface (re-exports of
`GatewayErrorPayload` from `@spanexx/errors`, plus `readClaims`, `createAuthPolicy`,
`createCapabilityLookup`, `createAdapterPipeline`, error converter, response channel
types, generic `RecordRegistry`).

### Scenario 2: WS suite passes unedited

**Given** `packages/adapter-websocket` migrated onto core
**When** `pnpm vitest run packages/adapter-websocket` runs
**Then** all ~54 cases across 10 test files pass with **zero edits** to `__tests__/`
and `client.ts`.

### Scenario 3: wire simulation unchanged

**When** `simulate-websocket-adapter.mjs` runs
**Then** 37/37 assertions pass with the same script, same assertions.

### Scenario 4: public surface identical

**When** `index.ts` exports of `adapter-websocket` are diffed pre/post
**Then** `createWebSocketAdapter`, `createWsClient`, `WsInvokeError`,
`WsDoorMismatchError`, `originMatches`, `authenticateToken`, `ConnectionRegistry`,
`WS_ERROR_CODES`, `DEFAULT_CONFIG`, `AUTH_ERROR_CODES`, and all types are unchanged.

### Scenario 5: wire bytes identical

**When** a live gateway is driven through the migrated server
**Then** PRD Scenario 11 messages, close codes 1008/1009/1011, `WS_ERROR_CODES`
values, and auth phrases match the pre-migration bytes exactly.

### Scenario 6: consumers untouched

**When** the CLI consumer and wire client run against the migrated server
**Then** `agentide/src/consumer.ts` and `packages/adapter-websocket/src/client.ts`
are untouched and interoperate.

### Scenario 7: core ships its own tests

**When** `pnpm vitest run packages/adapter-core` runs
**Then** the moved logic (readClaims, error converter, auth policy, registry, lookup,
channel) has its own unit tests, green.

### Scenario 8: capability lookup ships unwired

**When** `createCapabilityLookup` is inspected
**Then** it exists in core with `list(token)` / `describe(name, token)`, scope comes
from `readClaims(token).scope`, tier filtering is delegated to the kernel's
`capability.list` — and WS frames wire **nothing** new in v1 (no discovery frame).

## Simulation Contract

The post-impl sim (`simulate.sh`, built after implementation) must demonstrate
Scenarios 1–8:

```bash
pnpm --filter @spanexx/adapter-core build && pnpm --filter @spanexx/adapter-core test
# → core builds + own unit tests green            (S1, S7)
pnpm vitest run packages/adapter-websocket
# → ~54/54, zero edits to __tests__/              (S2)
node packages/agentide/scripts/simulate-websocket-adapter.mjs
# → 31/31, same script                            (S3)
# exports diff pre/post → identical list          (S4)
# wire capture (auth phrase, invoke.partial/end, close 1008/1009/1011) → identical (S5)
git diff --stat agentide/src/consumer.ts packages/adapter-websocket/src/client.ts
# → empty                                       (S6)
node -e "import('@spanexx/adapter-core')" # capability lookup present, no WS wiring (S8)
```

## Technical Design

### Data Models

- `GatewayErrorPayload {code, message, details?, retryable?}` — re-exported from
  `@spanexx/errors` (A5). Shared envelope, not redefined.
- `ResponseChannel` (A4) — per-invocation: `emit(chunk)`, `end(result|error)`,
  `event(topic, payload)`; one call id; `end` exactly once, `emit` after `end` errors,
  `event` only before `end`.
- `RecordRegistry<T>` — generic record store (A1): `add/get/remove/snapshot/clear/count`
  over a caller-supplied record shape. WS `ConnectionRegistry` becomes a thin wrapper
  keeping the `ConnectionRecord` shape (`ws-<n>` ids, queue/stats/heartbeat fields).
- Auth policy (A2): `{mode: "early" | "lazy"}` knob; early verifies once at open and
  caches identity (in the door's connection record); auth-failure behavior frozen
  (wire phrases stay door-local). `lazy` mode in v1 behaves identically to `early` —
  deferral noted in code (D-95); kernel-verifies-per-call is the documented future.
- `createCapabilityLookup` (A6): `list(token)` → filtered list; `describe(name, token)`
  → single entry; scope via `readClaims(token).scope`; empty scope → `[]` defensive;
  no tier logic in core.

### API Contracts

- `createAdapterPipeline({gateway, errors, response})` (A1) — the shared invocation
  pipeline. Per-invocation input/output flow through the `invoke()` args
  (`PipelineInvocation`); `config` passthrough omitted in v1 (A1's 6-key shape
  simplified during IMPL — D-96). Emits **no events**; imports
  `@spanexx/gateway-core` at runtime.
- `readClaims(token)` — moved from MCP `decodeScopeFromToken` (base64url payload
  parsing, `[]` defensiveness). `decodeScopeFromToken` stays in MCP until A8.
- Error converter (A5): shared converter + shared default fallback
  (`-32006` + `${code}: ${message}`), door-configurable via `errors: table`.
- Doors import **only** `@spanexx/adapter-core` for shared logic (own-bytes rule, A1).

### Dependencies

- `@spanexx/errors` — runtime; source of `GatewayErrorPayload` (re-export only).
- `@spanexx/gateway-core` — runtime (A1); pipeline needs gateway handle + kernel
  `capability.list` filtering (`factory.ts:554-570`).
- `@spanexx/capability-registry` — types only, if needed.
- Dev: `vitest`, `typescript` from the workspace. **Zero new external deps.**
- Move map (from sim Step 2): MOVE → `readClaims`, auth policy early mode, response
  channel types, error converter + fallback, generic `RecordRegistry`,
  `createCapabilityLookup`, canonical re-exports. STAYS → `protocol.ts` (W1–W6
  envelope), `errors.ts` (WS table + codes), `queue.ts` (1MiB FIFO), `fanout.ts`,
  `registry.ts` (record shape), `invoke.ts`/`auth.ts`/`server.ts` (delegate to core),
  `client.ts` (untouched), `types.ts`.

### Architecture Notes

```
 door (WS) ──createAdapterPipeline──> adapter-core ──> @spanexx/gateway-core
   │                                    │
   │ wire bytes / config / transport    │ primitives: readClaims, auth policy,
   │ (door-local)                       │ error converter, RecordRegistry,
   │                                    │ capability lookup, response channel
   └── keeps its file surface ──────────┘ emits NO events; imports gateway-core
```

Migration strategy (extract-and-delegate): internal files tests import directly
(`invoke.ts`, `auth.ts`, `queue.ts`, `fanout.ts`, `registry.ts`, `protocol.ts`,
`types.ts`, `errors.ts`) keep their signatures; bodies delegate to core. This is what
makes the zero-edit rule possible.

## Non-Goals

- **Client half** — `createWsClient`, `WsInvokeError`, `WsDoorMismatchError` stay in
  WS; consumer surface frozen.
- **Wire format** — W1–W6 envelope (`protocol.ts`) untouched; no new frames.
- **Backpressure/queueing** — 1MiB FIFO, stats, drop-oldest stay door-local
  (adapter-local v1 per A4).
- **Subscribe mode / live streaming** — channel `subscribe` mode is future
  (A4 amendment).
- **Session policy** — pass-through only in core; lifecycle is a consumer concern
  (A3).
- **Events** — core emits none (A1).
- **Tier logic** — none in core; kernel `capability.list` owns the verdict (A6).
- **Capability lookup wiring into WS** — ships in core, unwired (A6).
- **MCP migration (A8), REST proof adapter (A9)** — separate wayfinder tickets.
- **WS errors table** — stays door-local; core provides converter + default only (A5).

## Out of Scope (Future)

Seven items locked in `docs/wayfinder/adapter-core/future.md` — kernel-level real
streaming, channel `subscribe` mode, backpressure/queueing graduating to core,
subscription pattern graduating to core, WS capability-discovery frame, error-catalog
setup-time validation, consumer-edge session policy. None ship in A7.

## References

- `docs/wayfinder/adapter-core/tickets/A1..A6` — locked decisions (all `decision-only`)
- `docs/wayfinder/adapter-core/future.md` — deferred items
- `docs/features/adapter-core/simulate-pre.sh` — design sim (move map + gates G1–G5)
- `packages/adapter-websocket/src/` — migration source; `packages/adapter-mcp/src/translate.ts` (decodeScopeFromToken), `packages/gateway-core/src/factory.ts:554-570`
- `docs/drift.md` — D-94 glossary wording resolves after A1 ships
