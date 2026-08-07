# A9 — REST proof adapter: spec on the shared foundation

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07 — all 6 sub-questions locked)
**Blocks:** — (delivery: feature-pipeline, backlog row 10)
**Blocked by:** A1 (A9-R1 research resolved 2026-08-07 — see research report)

`delivery: feature-pipeline` — Way is clear. Route: feature-pipeline. Pack path:
`docs/features/rest-adapter/`. Pre-impl sim per the
[interconnected-simulation skill](/home/spanexx/Shared/Learn/Agent-Bridge-SDK/.agents/skills/interconnected-simulation/SKILL.md).

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

## Resolution

All six sub-questions locked 2026-08-07.

1. **Route shape — `POST /invoke` only.** Single endpoint. The adapter is a protocol
   translator, not an API surface (CONTEXT.md Adapter row). Capability names are dynamic
   (registered by apps at runtime); a static route tree duplicates the registry + authz.
2. **Auth — Bearer JWT per request, kernel-verified.** Lazy-path semantics =
   `Bearer <token>` rides through, kernel verifies per call (`handle-invocation.ts:145`).
   No client-credentials grant in v1 (kernel `gateway.oauthTokenHandler` is available
   adapter-side for adapters that need it; not REST). No origin binding in v1 (early-path
   only; REST is lazy-by-shape).
3. **Verb→tier mapping — none.** Single verb `POST`. Tiers are declared on the capability
   record and enforced by `checkAuthz`; the door doesn't second-guess.
4. **Error shape — body = `GatewayErrorPayload` verbatim, status mapping at the door.**
   Token-related → 401; scope-related → 403; session-required / invalid-request → 400; not-
   found set → 404; rate-limit → 429; runtime errors → 500. `retryable` rides in the body,
   not the status. No new carrier.
5. **Discovery — `GET /capabilities` only.** Backed by shared `createCapabilityLookup.list`
   (works today). `GET /capabilities/{name}` deferred — `createCapabilityLookup.describe()`
   is broken against the kernel (16.2 in the A9-R1 research report). Everything else
   (`/sessions`, `/health`, `/status`, plugins, organizations, clients) stays OUT of v1 —
   all are session-less capabilities already reachable over `POST /invoke`.
6. **Sim is in the v1 acceptance bar** — pre-impl design sim + post-impl verification sim
   + reconcile, per the [interconnected-simulation
   skill](/home/spanexx/Shared/Learn/Agent-Bridge-SDK/.agents/skills/interconnected-simulation/SKILL.md).
   Pre-impl files: `docs/features/rest-adapter/simulate-pre.html` (HTML, Phase 0.5).
   Post-impl files: `docs/features/rest-adapter/simulate.html` (canonical, Phase 4/6) and
   `simulate-rest-adapter.mjs` (shell-driver, drives a real `createRestAdapter` +
   `createPlatform` on port 7400). Loopback-only (127.0.0.1). Reference: the user-supplied
   interconnected-simulation skill (`.agents/skills/interconnected-simulation/SKILL.md`).

## Question

The REST adapter (backlog row 10: "REST adapter for non-MCP integrations") is the proof
consumer — it must be buildable from adapter-core + a small input/output translator,
exactly the "different door, same runtime" claim. What is its v1 spec?
