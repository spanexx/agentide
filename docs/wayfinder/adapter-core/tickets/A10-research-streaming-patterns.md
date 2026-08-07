# A10 — Research: streaming/subscription response patterns at adapter boundaries

**Type:** `wayfinder:research` (AFK)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A4
**Blocked by:** —

## Resolution

Survey complete — `docs/wayfinder/adapter-core/research/A10-streaming-patterns.md` (branch `research/adapter-core-a10`, commit `ccde406`). Recommendation: a **response channel with a terminal** per invocation — declared mode `single | stream | subscribe`; three primitives (`emit(chunk)`, `end(result|error)`, `event(topic,payload)`), all chunks share one call `id`. gRPC proves unary = stream of length one, so kernel streaming later is **additive by construction** — no seam redesign. Adapters map chunks to their own frames (WS `invoke.partial`/`invoke.end`, MCP merges into one `CallToolResult`). Backpressure, topic authz, replay stay adapter-local for v1.

## Question

How do mature systems model "one request → many results over time" at their protocol
boundaries? The survey feeds the response-strategy seam (A4) — single reply, stream
packaging, and subscription must all fit one interface that also anticipates real kernel
streaming.

## Context

- Today: kernel is single-shot; WS synthesizes `invoke.partial`+`invoke.end` around one
  result; MCP returns one `CallToolResult`.
- A4 needs a seam that is additive when the kernel starts streaming (browser-runtime era).

## Research targets

1. MCP streamable HTTP / SSE (current spec) — how tool-call streaming is framed.
2. LSP (Language Server Protocol) — request/notification/event model over one channel.
3. gRPC server-streaming vs unary — the interface shape for "one call, N responses".
4. Any JSON-RPC 2.0 batch/notification conventions relevant to WS frames.
5. One non-IPC example (HTTP SSE / WebSocket push) for the subscription side.

## Output

`docs/wayfinder/adapter-core/research/A10-streaming-patterns.md` — per target: mechanism,
strengths, weaknesses for the Agentide case, and a one-paragraph recommendation the A4
grilling can react to. Branch: `research/adapter-core-a10`.
