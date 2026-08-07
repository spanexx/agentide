# A9 — REST proof adapter: spec on the shared foundation

**Type:** `wayfinder:grilling` (HITL)
**Status:** **in progress** (claimed 2026-08-07 — discovery phase)
**Blocks:** — (delivery: feature-pipeline, backlog row 10)
**Blocked by:** A1, A9-R1

## Question

The REST adapter (backlog row 10: "REST adapter for non-MCP integrations") is the proof
consumer — it must be buildable from adapter-core + a small input/output translator,
exactly the "different door, same runtime" claim. What is its v1 spec?

## Context

- Goals §1 (Agnostic by Design): REST is a named protocol; adapters must not change core.
- Auth precedent: Bearer JWT header (MCP-style extraction), kernel verifies (lazy mode,
  A2).
- Session precedent: optional header or query sessionId (passthrough, A3); CLI owns
  minting.
- Response precedent: single JSON reply per request (no streaming in v1); errors as
  HTTP status + `GatewayErrorPayload`-shaped body (A5).
- Zero-delta does not apply (new adapter — no existing behavior to preserve).

## Sub-questions

1. Route shape: `POST /invoke` with `{capability, input, sessionId?}` vs RESTful
   per-capability routes (`GET/POST /<domain>/<action>`) — or both?
2. Auth: Bearer only, or also client-credentials grant for machine identities (row 29
   precedent)?
3. Which HTTP verbs map to which tier semantics (read=GET, act=POST, destructive=DELETE)?
4. Error shape: HTTP status mapping table (400/401/403/404/409/500) + body
   `{code, message, details, retryable}`?
5. Discovery surface: `GET /capabilities` (via A6 lookup)?
6. Scope of the v1 pack: is `simulate-rest-adapter.mjs` part of the acceptance bar?
