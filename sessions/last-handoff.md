# agentide — Session Handoff

**Date:** 2026-08-07
**Session:** A9 wayfinder grilling — REST proof adapter v1 spec locked + routed to feature-pipeline.

## Soul

This was the "lock the REST adapter" session. The agent arrived carrying the wayfinder
rest-adapter briefing; the loose idea was the row-10 REST adapter. The map already
existed (A9 on the dormant adapter-core wayfinder map); the work was to chart the v1
spec by grilling the six sub-questions through the human, against the foundation
research code-read. The map's frontier collapsed to A9 alone (A8 closed earlier in
the day); claimed A9, opened a research sub-ticket A9-R1 to surface the platform
facts a future session would lock against, then walked the human through Q1–Q6 with
plain-English recommendations. All six locked. Map frontier empty. Way is clear;
routed to feature-pipeline.

## What We Did

**A9-R1 (research) — closed.** Spun up a read-only subagent; the report is
`docs/wayfinder/adapter-core/research-rest-platform-discovery.md` (671 lines, 13
sections + divergences appendix). Captured on branch `research/adapter-rest-a9-r1`
(commit `2e0b76d`). Key findings for A9: (1) seam is ready — `handleInvocation` is
protocol-agnostic and its own header names REST as an intended caller; primitives 1/3/4/6
(`readClaims`, `createErrorConverter`, `createResponseChannel`, `createAdapterPipeline`)
are ready today. (2) Two traps found: `createAuthPolicy` lazy mode is **not implemented**
(mode stored but never branched on — `auth-policy.ts:68-88`); and
`createCapabilityLookup.describe()` is **broken against the real kernel** (returns empty
cards against anything real). (3) No HTTP status mapping exists anywhere — greenfield.
(4) OAuth handler is kernel-owned and transport-agnostic — REST consumes via
`gateway.oauthTokenHandler`, no copy.

**A9 (grilling) — closed.** Six sub-questions locked, all with the agent's recommendations
accepted by the user:

1. **Route shape — `POST /invoke` only.** One endpoint, `{capability, input, sessionId?}`
   body. The adapter is a protocol translator, not an API surface; capability names
   are dynamic. Static route trees would duplicate the registry + authz.
2. **Auth — Bearer JWT per request, kernel-verified.** Already what
   `handle-invocation.ts:145` does. No client-credentials grant in v1 (kernel
   `gateway.oauthTokenHandler` available for adapters that need it; not REST). No
   origin binding in v1 (early-path only; REST is lazy by shape).
3. **Verb→tier mapping — none.** Single verb `POST`. Tiers are declared on the
   capability record and enforced by `checkAuthz`; the door doesn't second-guess.
4. **Error shape — body = `GatewayErrorPayload` verbatim, status mapping at the door.**
   Token-* → 401, scope-* → 403, session-required / invalid-request → 400, not-found
   set → 404, rate-limit → 429, runtime-* → 500. `retryable` rides in the body, not
   the status.
5. **Discovery — `GET /capabilities` only.** List, via shared `createCapabilityLookup.list`.
   `GET /capabilities/{name}` deferred — `describe()` is broken. Everything else
   (`/sessions`, `/health`, `/status`, plugins, organizations, clients) stays OUT of
   v1 — all are session-less capabilities already reachable over `POST /invoke`.
6. **Sim in the v1 acceptance bar** — pre-impl HTML + post-impl shell, per the
   [interconnected-simulation skill](../../../.agents/skills/interconnected-simulation/SKILL.md).

**Drift entry D-100 logged.** The `createCapabilityLookup.describe()` bug is now a High
drift against adapter-core. A9-R1 §14.2 has the citations. Fix target: `extractDescriptor`
should unwrap `rec.capability` first, mirroring MCP's pattern at `translate.ts:114-127`.
Blocks: A9's deferred describe route (Q5) AND A8's "MCP tests run UNEDITED" acceptance bar
(swapping `listTools` onto the shared lookup would change tool schemas to empty).

**Map.** Frontier collapsed to empty. A9 appended to Decisions so far with the six
locked items. Closure branch: `research/adapter-rest-a9-r1`.

## Outstanding blocker

**The precommit hook fails on parallel A8 work in the working tree.** Not mine — DO NOT
TOUCH per AGENTS.md rule -1. The file is `packages/adapter-mcp/src/translate.ts:140`:
`const rec = item as Readonly<Record<string, unknown>>;` — banned type (`unknown` in
non-catch position). The parallel A8 migration introduced this when reshaping the door
to consume the shared converter. The full precommit (`check-banned-types.sh` + typecheck
+ lint + build) runs on the whole tree, so my staged A9 docs can't land until the
parallel work either fixes its banned type or moves off the worktree.

My staged A9 docs are correct and harmless: drift.md (D-100 addition), map.md (A9 in
Decisions so far + frontier empty), A9-R1 ticket (status closed + resolution block),
A9 ticket (status closed + resolution block + 6 locked decisions). 4 files, 101
insertions, 9 deletions. All on the `research/adapter-rest-a9-r1` branch.

## How to Continue

**For the next session / the next agent:**

1. **Resolve the precommit blocker.** Three options:
   - **Fix the banned type:** change `packages/adapter-mcp/src/translate.ts:140` from
     `as Readonly<Record<string, unknown>>` to a typed interface (MCP's MCP-style card
     shape: `{name: string, description: string, tier?: string|number}`). Owner: the
     A8 migration session. Two minutes of mechanical work.
   - **Stash the parallel work:** `git stash push -- packages/adapter-core/src/capabilities/lookup.ts packages/adapter-mcp/src/translate.ts` from the
     `research/adapter-rest-a9-r1` branch — the parallel A8 work is unstaged already; a
     `git stash` is the only thing that flips it. Then commit A9, then `git stash pop`
     (parallel A8 work resumes). Brief pollution of the reflog; otherwise clean.
   - **Commit with --no-verify:** bypasses the project's gate. Not recommended.
2. **Land A9 — start feature-pipeline.** The route is `feature-pipeline` per the
   A9 ticket's resolution comment. Pack path: `docs/features/rest-adapter/`. First
   step: GRILL reconfirmation (the locked six items above are the input) → pre-impl
   HTML sim (skill: `interconnected-simulation`, template `simulate.html`) → PRD-TRD
   → IMPL → implement → post-impl shell sim (`simulate-rest-adapter.mjs` drives a
   real `createRestAdapter` + `createPlatform` on port 7400) → drift check → reconcile.
3. **D-100 fix follows A8's MCP migration.** The `describe()` unwrap is required
   before A9's `GET /capabilities/{name}` ships. A8's "MCP tests run UNEDITED" gate
   also depends on it (`listTools` → shared lookup would change tool schemas to empty).
   Resolve as part of A8's tail, OR as a one-line lookup.ts fix tucked into A9's
   pre-impl phase.
4. **Cross-pack reminder.** A9's spec assumes A8 lands the lazy auth path
   (A8 P5: "real lazy mode + new test"). If A8's pack ships without that step,
   A9 still works (just routes per-request through kernel `verifyToken` instead of
   `createAuthPolicy`) — the assumed auth story holds.

## Open State

- **Branch:** `research/adapter-rest-a9-r1` (not pushed)
- **Staged for commit:** my A9 docs (4 files, 101/9) — blocked by precommit
- **A8 frontier:** A8 lock-ticket is closed; the build is in flight as a feature-pipeline
  pack (`docs/features/adapter-mcp/`). Parallel A8 migration work is unstaged in the
  working tree of THIS branch (NOT mine; the A8 session will reconcile).
- **Map frontier:** empty. adapter-core map is dormant until a future reopens.

## Reference

- A9 ticket: `docs/wayfinder/adapter-core/tickets/A9-rest-proof-adapter.md`
- A9-R1 ticket: `docs/wayfinder/adapter-core/tickets/A9-R1-rest-platform-discovery.md`
- A9-R1 report: `docs/wayfinder/adapter-core/research-rest-platform-discovery.md`
- Map: `docs/wayfinder/adapter-core/map.md` (A9 at top of Decisions so far; frontier empty)
- Drift: `docs/drift.md` (D-100 added)
- Pack path: `docs/features/rest-adapter/` (does not exist yet — feature-pipeline will create)
- Wiring point for the new adapter: `packages/agentide/src/factory.ts:214-234` (alongside
  the existing WS + MCP wiring)
- Discovery report §13 has the architecture proposal draft (objective, scope, reused
  components, new components, testing strategy) — the PRD-TRD seed.
