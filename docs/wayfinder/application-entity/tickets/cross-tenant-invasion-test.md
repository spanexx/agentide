# Cross-tenant invasion test

**Type:** `wayfinder:prototype` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** feature-pipeline

## Resolution

**Artifact:** `docs/wayfinder/application-entity/prototype/cross-tenant-attack.mjs`
(produced during feature-pipeline). The script implements the four
phases outlined in the skeleton.

**Skeleton (already locked):**

1. **Proto shape**: a Node script
   (`docs/wayfinder/application-entity/prototype/cross-tenant-attack.mjs`).
2. **Uses fake sockets** (no real WebSocket). The backend-runtime's
   `HandlerRegistry` and `InvocationDispatcher` are tested through
   the `createBackendRuntime` factory.
3. **Two phases**: pre-fix (asserts the leak) and post-fix (asserts
   no leak). The pre-fix phase is a "what we are preventing" demo.
4. **Output**: PASS or FAIL with a one-line summary. The proto
   becomes a deliverable in the feature-pipeline IMPL.

**Tag:** `delivery: feature-pipeline` — the proto is produced as
  part of the feature-pipeline.

## Question

Build a prototypic in-process test (or minimal script) that
demonstrates the audit's Section 1.1 attack fails end-to-end AFTER
the fix, and successfully leaks data BEFORE the fix. The proto is
the proof-of-concept for the feature-pipeline run.

## What I know

- The attack is documented in `docs/.reports/Agentide Production Audit_ Security, Performance & Design Patterns.md` Section 1.1.
- It's a two-tenant scenario: Acme and Beta. Both have an SDK with
  `callerId = "portfolio-service"`. The registry collides. A's agent
  invokes a capability; the dispatch routes to B's handler; B sees
  A's input.
- The fix is by-construction: the registry keys by `applicationId`
  (a UUID), and the JWT carries that id. Two tokens with different
  `applicationId` cannot collide.
- The existing `TestClock` pattern + `InMemoryFs` + `backend-runtime`
  compose pattern is in `packages/agentide/src/__tests__/backend-runtime.test.ts`
  — the proto extends this.

## What I don't know

- **Best proto shape** — a Jest test, a Node script, or a browser
  HTML page? The feature-pipeline convention is a post-impl sim
  script (`packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs`).
  The proto for this map should be lighter — a focused script that
  sets up two fakes, runs the attack, asserts the outcome.
- **Whether the proto should also demonstrate the SECOND bug** (cross-
  tenant cap invocation by capability name) — the audit's Section 1.1
  covers both the connection keying AND the cap dispatch. The proto
  should cover both.
- **Where the proto lives** — `docs/wayfinder/application-entity/prototype/`
  vs `packages/agentide/scripts/`. The feature-pipeline post-impl
  sim lives in the latter; the proto can live in the former (the
  proto is a planning artifact, not a deliverable).

## Plain-English scenario

I run `node prototype/cross-tenant-attack.mjs`. The script:

1. Boots two fake tenants (Acme, Beta) with an in-memory backend
   runtime.
2. Connects two SDKs both with `callerId = "portfolio-service"` but
   owning different capabilities (one for each tenant).
3. **Pre-fix (faked):** simulates the current behavior. The second
   SDK overwrites the first. An Acme-originated invocation routes
   to Beta's handler. Asserts the leak.
4. **Post-fix (real):** connects the same two SDKs, but the second
   is keyed by `applicationId = "...:B"`. Both connections live.
   An Acme-originated invocation routes only to Acme's handler.
   Asserts no leak.
5. Prints PASS/FAIL.

## Skeleton answer (to be grilled)

1. **Proto shape**: a Node script (`docs/wayfinder/application-entity/prototype/cross-tenant-attack.mjs`).
2. **Uses fake sockets** (no real WebSocket). The backend-runtime's
   `HandlerRegistry` and `InvocationDispatcher` are tested through
   the `createBackendRuntime` factory.
3. **Two phases**: pre-fix (asserts the leak) and post-fix (asserts
   no leak). The pre-fix phase is a "what we are preventing" demo.
4. **Output**: PASS or FAIL with a one-line summary. The proto
   becomes a deliverable in the feature-pipeline IMPL.

## What blocks this

T1, T2, T3, T4, T5. The proto only makes sense after the data
model, provisioning, token, and wire shape are all locked.
