# websocket-adapter — Future work (post-v1)

> **Status:** post-v1. v1 covers push + pull + adapter-level streaming + top-level
> subscribe messages. This file now records what is **left** for future runs.

## What no longer needs recording here

- ~~Pull support~~ — **shipped in v1** (W1 re-open 2026-08-03; lock entry in
  `tickets/adapter-scope-vs-mcp.md`). Every WS adapter v1 client can use
  `invoke` / `invoke.result` / `invoke.error` / `invoke.partial` / `invoke.end`
  over the same socket as `subscribe` + `event`. Demand-driven by
  `dashboard-core` BI[13]; available universally, not scoped.

## What remains future

### 1. Kernel-level streaming seam

v1 streams **adapter-level** (W1 sub-Q 2 Reading A): the WS adapter packages
progress events into partial frames for `mode: "stream"` invokes without
changing the kernel. `Gateway.handleInvocation()` stays single-shot per
gateway-core Q11 lock.

If a future run wants `handleInvocation()` to natively emit partial results
(so MCP and WS both see live progress, and progress survives kernel-side
backpressure), that is a kernel change touching MCP + WS, not just WS.
Promote "streaming" from adapter concern to platform concern in that run.

Pre-conditions for that run:
- The adapter-level streaming tickets (`W5` fan-out, `W6` backpressure) have
  landed and the inbound contract is stable.
- A concrete consumer has asked for streaming on MCP (the kernel promotion
  is justified only if MCP users also want it; otherwise the adapter-level
  approach is sufficient).

### 2. `invoke.batch` — multi-invoke in one frame

Suspected demand: a dashboard that wants to load all five views
(`session.list`, `plugin.list`, `capability.list`, `system.health`,
`gateway.metrics`) at open-time could send one `invoke.batch` instead of
five correlated invokes. Same kernel cost in aggregate; lower frame
overhead, lower latency (one DNS-less round-trip).

Shape is NOT locked. The future run must grill it. Plausible shape:
`{type: "invoke.batch", correlationId, calls: [{name, input, sessionId?, mode?}, ...]}`
with `invoke.batch.result` (parallel array of result/error, by index) or
`invoke.batch.stream` (one partial stream per call). Whether the batch
fan-out is sequential or parallel is a server-side decision.

GRILL-it-later. Not a v1 demand.

### 3. Subprotocol versioning for v2

v1 is single-versioned. If a v2 of the WS adapter ships with a breaking
change (e.g. multi-tenant fan-out, native streaming, new envelope variants),
the path-version or query-version move is a separate ticket. Do not bundle
into a v1 ticket.

### 4. MCP-shape compatibility (cross-cuts adapters)

If a future client wants to speak JSON-RPC over WS (e.g. an MCP client that
also wants push), that's a new adapter or a sub-protocol. The current WS
adapter does not consume JSON-RPC and will not. A scoped "MCP-on-WS" adapter
would be a separate map.

## Non-negotiables

- All v1 contracts (`auth` / `auth.ok` / `auth.error`, `subscribe` /
  `subscribe.ok` / `subscribe.error`, `unsubscribe` / `unsubscribe.ok`,
  `event`, `invoke` / `invoke.result` / `invoke.error` / `invoke.partial` /
  `invoke.end`, `stats`, `error`) are **post-v1**: they may be evolved
  per the versioning rule above, not silently broken. **REVISED 2026-08-03
  (W4 close): `pong` removed from this list — W4 finalized the v1 contract
  as protocol-level heartbeat only (mirrors T3 Q4); there is no app-level
  pong frame type, so nothing to preserve.**
- Any future WS-adapter map charting or PRD must read this file first.
- Every decision to add to this list must be recorded in `docs/CONTEXT.md`
  Decisions Log.
