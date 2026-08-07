# A4 — Response strategy seam: single reply / stream packaging / subscription

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A7, A8
**Blocked by:** A1 (closed), A10 (research, closed)

`delivery: decision-only` — design locked; the build happens via A7/A8.

## Resolution

1. **Seam shape (Q1): a per-invocation `ResponseChannel` created by the door's strategy,
   driven by the pipeline.** Three primitives — `emit(chunk)`, `end(result|error)`,
   `event(topic,payload)` — all sharing one call id (A10 shape). The strategy is a
   factory: the door hands adapter-core `makeChannel()` at setup; the pipeline calls it
   once per invocation, pushes chunks, calls `end` once. Rules out three separate handler
   slots (`emitSingle`/`emitStream`/`emitEvent` as distinct pipeline branches — the
   pre-A10 shape) and any shared channel object across connections.
2. **Stream packaging (Q2): stays in the door; the pipeline only produces
   protocol-neutral chunks.** Chunks are the shared intermediate; rendering is the
   door's bytes (A1 rule). WS strategy renders `invoke.partial` + `invoke.end` per
   chunk; MCP strategy merges chunks into one `CallToolResult`. Kernel streaming later:
   WS renders N partials, MCP merges N. Rules out a shared frame packager in core that
   knows the WS envelope, and a WS-style partial/end protocol imposed on MCP.
3. **Subscription (Q3): adapter-local in v1; the channel's `subscribe` mode is FUTURE
   intent, not v1 surface.** WS `subscribe`/`unsubscribe` frames stay exactly as today —
   Event Bus + per-pattern authz (`derivePermission`, `fanout.ts`), a separate long-lived
   frame pair, not an invocation. The A10 `subscribe` mode on the channel is documented
   as future: it exists in the type only when a real capability streams events
   (e.g. `gateway.watch` — a real invocation whose response is a live stream), NOT
   shipped dormant in v1. Graduates to core only with a second consumer (REST).
4. **Backpressure/queueing (Q4): adapter-local in v1; WS `queue.ts` untouched.** The
   1 MiB FIFO byte-budget, drop-oldest, `stats` arm, `maxFrameBytes`, serialized drain
   is per-connection transport bookkeeping — the door's own bytes (A1 rule). MCP has no
   equivalent. The pipeline never awaits `socket.send` — `emit` is fire-and-forget from
   the pipeline's perspective (fanout relay already: slow socket must not back-pressure
   the bus). Graduates to core only with a second consumer.
5. **Kernel real streaming (Q5): additive by construction — zero seam changes, by
   design.** The channel contract is identical whether the kernel emits one chunk or N
   (A10: unary = stream of length one); the pipeline never knows the kernel's mode.
   Terminal guarantees must be locked NOW in v1: `end` fires exactly once; `emit` after
   `end` is an error; `event` allowed before `end` only — testable today with a
   one-chunk fake. Rules out a `v2: ResponseChannel` variant, version flags, or the
   pipeline branching on kernel mode.

## Question

The kernel is single-shot (`handleInvocation` returns one `CanonicalResponse`), but doors
differ in how they present results: WebSocket wraps one result into
`invoke.partial` + `invoke.end` for stream mode and supports long-lived
`subscribe`/`event`; MCP returns one `CallToolResult`. What is the shared seam that
expresses all three — and anticipates real kernel streaming later?

## Context

- WS: `adapter-websocket/src/invoke.ts:56` synthesizes `invoke.partial` per result +
  `invoke.end`; `queue.ts` + `fanout.ts` handle frame ordering/backpressure; top-level
  `subscribe` exists (W3/W6).
- MCP: `callTool` → single `CallToolResult` (with timeout → `isError` result).
- Future: browser-runtime era may give the kernel real streaming; the seam must not
  force a redesign then (A10 surveys how other systems model this).

## Sub-questions

1. Seam shape: a strategy object (`emitSingle(result)`, `emitStream(result)`,
   `emitEvent(topic, payload)`) handed to the pipeline — or something else?
2. Where does stream packaging live — is `partial`/`end` synthesis itself shared
   (protocol-neutral "stream chunks" intermediate) with the adapter mapping chunks to
   its own frames?
3. Subscription: is `subscribe` a pipeline concern (topic authz exists in WS —
   per-pattern) or stays adapter-local?
4. Backpressure/queueing (WS 1 MiB FIFO, `stats` frames): shared or adapter-local?
5. What does the seam do when the kernel gains real streaming — additive change or
   break?
