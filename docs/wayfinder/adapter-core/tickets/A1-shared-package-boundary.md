# A1 — Shared package boundary: what moves into adapter-core, what stays

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A2, A3, A4, A5, A6, A7, A8, A9

`delivery: decision-only` — a design boundary; the build happens through the tickets that follow.

## Resolution

1. **The boundary rule (Q1):** whatever reads or writes the door's own bytes stays in the
   door; everything between those two points is shared. Edge cases: MCP tool-card rendering
   stays in the MCP door (its own shape) while the capability *lookup* it renders is shared;
   connection bookkeeping (per-connection registry — ids, timers, queues) is a shared
   primitive.
2. **Dependencies (Q2):** adapter-core imports gateway-core at runtime (verifyToken,
   CanonicalInvocation, CanonicalResponse, GatewayErrorPayload — the stable contracts).
   Doors import ONLY adapter-core; it re-exports the canonical contracts (replaceability
   test: one file changes if the core's shape changes). The W1–W6 frame envelope stays
   door-local — consistent with the Q1 rule.
3. **Setup shape (Q3):** one call — `createAdapterPipeline({ gateway, config, input:
   parse(), output: render(), errors: table, response: strategy })` — returns the door's
   ready-to-use handlers. The door keeps its transport lifecycle (sockets/HTTP servers are
   transport bytes); the pipeline owns only what happens between request and response.
4. **Events (Q4):** adapter-core emits NOTHING on the Event Bus. Observability stays in the
   core (`gateway.invocation`, audit log). Auth policy *returns* facts to the caller; it
   never broadcasts. No emit moves out of the core during migration.

## Question

Where exactly is the line between "shared pipeline" (adapter-core) and "protocol-specific
work" (each adapter)? Every other ticket assumes this boundary — it is resolved first.

## Context (from the map + A11 inventory)

- Kernel already owns the heavy parts: `verifyToken`, `handleInvocation`,
  `CanonicalInvocation`, `CanonicalResponse`. adapter-core wraps, never rewrites.
- WS server pipeline today: `auth.ts` (frame auth + origin binding), `invoke.ts`
  (frame → handleInvocation → wire frames), `errors.ts`, `queue.ts`/`fanout.ts`
  (response packaging), `registry.ts` (per-connection bookkeeping).
- MCP pipeline today: `translate.ts` (Bearer extraction, scope decode, `listTools`
  capability lookup, `callTool`), `error-map.ts` (→ JSON-RPC).
- The wire client + frame envelope (W1–W6) stay in adapter-websocket — locked.

## Sub-questions

1. Which modules move? (draft surface: auth-policy, session-policy, invocation-builder,
   capability-lookup, error-envelope, response-strategy, connection-registry?)
2. The extraction rule: what counts as "protocol-specific" and must stay in the adapter?
   (proposal: anything that reads or writes the transport's own bytes/shapes —
   everything else is shared)
3. Dependencies: may adapter-core import gateway-core at runtime (not just types)?
   (proposal: yes — no cycle; see map Notes)
4. Options/config shape: one shared config type + per-adapter extension, or
   adapter-core takes plain args?
5. Does adapter-core emit events (Event Bus)? (today: adapters emit nothing — kernel
   emits `gateway.invocation`; keep it that way?)
