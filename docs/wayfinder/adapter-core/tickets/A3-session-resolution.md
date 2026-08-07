# A3 — Session resolution: passthrough vs auto-mint

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** A7, A8
**Blocked by:** A1

## Question

Who decides a session exists, and where does that live once the pipeline is shared?
Today the adapters mostly pass a sessionId through; the CLI consumer owns auto-minting.
Should adapter-core own any of it?

## Context

- WS: `invoke` frames carry an optional `sessionId` (parsed in `invoke.ts`), passed into
  `CanonicalInvocation.sessionId`. No minting at the adapter.
- MCP: optional `_meta.dev.agentide/sessionId` (STATELESS by default — no session dance).
- CLI consumer: `agentide/src/consumer.ts` + `session-mint.ts` — auto-mints
  `session.create` → invoke → `session.destroy` when `--session` omitted (D-79).
- Kernel: sessions are created via the `session.create` capability — the Gateway never
  mints implicitly.

## Sub-questions

1. Adapter-core policy: pass-through only (sessionId in → invocation), or a
   `sessionPolicy` with an auto-mint helper?
2. If auto-mint moves to adapter-core: does it call `session.create` + `session.destroy`
   like the CLI does, or is that lifecycle a consumer concern in v1? (proposal: stays a
   consumer concern — zero-delta, CLI untouched)
3. What does "no sessionId supplied" mean per adapter in the shared pipeline — error,
   session-less invoke (dashboard does this), or passthrough-undefined?
4. Does the shared pipeline need to expose session lifecycle events for adapters that
   want to keep sessions alive (watch semantics)?
