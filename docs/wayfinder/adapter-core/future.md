# adapter-core — Future work (post-v1)

> **Status:** v1 = shared pipeline as locked by A1–A6 (`createAdapterPipeline`,
> zero-delta migrations A7/A8, REST proof A9). This file records what is **left**
> for future runs — everything below was explicitly ruled OUT of v1 during
> grilling, or flagged as a future gate.

## What remains future

### 1. Kernel-level real streaming (browser-runtime era)

v1 kernel stays single-shot (`handleInvocation` → one `CanonicalResponse`,
gateway-core Q11 lock). The A4 response channel is built additive-by-construction:
when the kernel emits N results, the pipeline pushes N chunks — same `emit` ×N +
`end` ×1, zero seam changes. Terminal guarantees locked in v1 (`end` exactly once,
`emit` after `end` = error, `event` before `end` only) make this testable today
with a one-chunk fake.

Pre-conditions for that run:
- A7/A8 migrations landed, zero-delta proven.
- A concrete consumer asks for streaming on MCP too (kernel promotion justified
  only if more than WS wants it — see websocket-adapter `future.md` §1).

### 2. Channel `subscribe` mode — live-streaming capabilities

The A10 channel type declares a `subscribe` mode, but NO capability uses it in v1 —
it is future intent, not shipped dormant. First real use: a capability whose
response IS a live event stream (e.g. `gateway.watch` — a real invocation that
never ends until `end`). The WS `subscribe`/`unsubscribe` frame pair stays
adapter-local forever (it is Event Bus registration, not an invocation); the
channel's `subscribe` mode is for *capability-level* streams only.

Gate: a concrete capability that streams. GRILL it then, not now.

### 3. Backpressure / queueing graduates to core

v1: WS `queue.ts` (1 MiB FIFO, drop-oldest, stats, `maxFrameBytes`) stays in the
WS door — per-connection transport bookkeeping (A1 "own bytes" rule). MCP has no
queue. The pipeline never awaits `socket.send`; `emit` is fire-and-forget.

When a SECOND door needs outbound queueing with backpressure (likely REST, A9 or
later), the pattern graduates to a shared primitive — proven by two consumers,
not invented in advance. Same rule as §4 below.

### 4. Subscription pattern graduates to core

WS per-pattern topic authz (`derivePermission` — `*` → `platform.*.read`) stays
adapter-local in v1. If a second door needs Event Bus subscriptions (REST events
endpoint?), the pattern graduates to a shared primitive then. Two-consumer rule.

### 5. WS capability-discovery frame

v1: WS exposes NO discovery frame — `capability.list` already works via a plain
`invoke` frame (kernel capability, passthrough). The shared lookup
(`createCapabilityLookup` — A6) is for adapter-side code (MCP tool catalog,
future REST), not new WS wire surface.

If WS ever needs a native discovery frame (e.g. typed `discover` with schema
batching), that is a future ticket with its own PRD — not smuggled into a
migration.

### 6. Error-catalog setup-time validation

A5 locked the shared fallback (MCP's `-32006` + `${code}: ${message}`, door-
configurable). An optional setup-time check — validate each door's `errors:
table` against the `ERROR_CODES` catalog at pipeline creation, warn on unmapped
codes — was flagged as a cheap guard but NOT required for v1. Add it when the
catalog grows (new codes start appearing in tables).

### 7. Session policy at the consumer edge

A3 locked: adapter-core never decides a session exists (pass-through only);
lifecycle stays consumer concern (`withAutoSession` in CLI). If a future consumer
wants adapter-level session policies (auto-mint knobs, idle destroy), those are
consumer-side primitives — GRILL where they should live when a real consumer asks.

## Explicitly NOT future (locked v1)

- `GatewayErrorPayload` re-export = the shared error envelope (A5) — no
  `AdapterError` intermediate, ever, unless the kernel contract changes.
- `readClaims(token)` = the standard claim reader (A2/A6) — MCP's
  `decodeScopeFromToken` dies, no second reader.
- Doors import ONLY adapter-core; adapter-core emits NO events (A1).
