# A4 — Response strategy seam: single reply / stream packaging / subscription

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** A7, A8
**Blocked by:** A1, A10 (research must land first)

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
