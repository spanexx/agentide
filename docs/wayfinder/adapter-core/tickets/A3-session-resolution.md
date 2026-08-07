# A3 — Session resolution: passthrough vs auto-mint

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A7, A8
**Blocked by:** A1 (closed)

`delivery: decision-only` — design locked; the build happens via A7/A8.

## Resolution

1. **Pass-through only (Q1).** adapter-core's pipeline translates; it never decides a
   session exists. No `sessionPolicy`, no auto-mint helper. Session policy lives at the
   consumer edge. Kernel lock stands: the Gateway never mints implicitly. Auto-mint means
   owning lifecycle (who destroys? idle timeout? ownerId for a shared MCP server?) — that
   is consumer policy, not pipeline shape.
2. **Lifecycle stays a consumer concern (Q2).** `withAutoSession` in the CLI
   (`agentide/src/session-mint.ts`) stays put — zero-delta, CLI untouched. adapter-core
   exposes no session-mint helper and no session events. Consumers decide their own
   lifecycle: CLI destroys best-effort, SDK keeps sessions alive, watch holds one session
   for the duration. D-91 (narrow-token auto-mint gap) is a consumer-side CLI issue, not
   adapter-core's.
3. **Passthrough-undefined (Q3).** No sessionId → adapter-core forwards
   `sessionId: undefined`, no error, no synthesis. The kernel owns the verdict via
   `SESSION_LESS_CAPABILITIES` (`gateway-core/src/handle-invocation.ts:48`): read-only
   discovery + `session.*` lifecycle + `auth.token.*` proceed session-less (dashboard
   does exactly this); business/runtime caps with missing session → kernel's existing
   `GATEWAY_*` error, unchanged. MCP stays STATELESS by default; WS `invoke` frames keep
   their optional sessionId.
4. **No session lifecycle events (Q4).** adapter-core emits nothing on the Event Bus
   (A1 lock). Keep-alive is consumer policy — CLI watch already works
   (`consumer.ts:317-340`: one auto-minted session for the watch duration, destroy on
   clean exit). `session.touch` stays a capability
   (`SESSION_LESS_CAPABILITIES` — no sessionId needed to touch), so any consumer can
   implement keep-alive without adapter-core involvement.

## Question

Who decides a session exists, and where does that live once the pipeline is shared?
Today the adapters mostly pass a sessionId through; the CLI consumer owns auto-minting.
Should adapter-core own any of it?

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
