
## 2026-07-27 17:00:12 | source: feature-pipeline:plugin-manager

execute-pack: implement plugin-manager from pipeline docs (PRD/TRD/FLOW/IMPL already shipped)

---


## 2026-07-29 19:45:11 | source: direct

User gave green light on IMPL gateway-sdk-dispatch Phase 1 (scaffold). Then corrected me 3x for: not loading project skills, not following TDD RED-GREEN-REFACTOR, not using Code Map CID comment convention from sibling packages. Wants Phase 1 redone properly.

---

## 2026-07-30 02:28:41 | source: feature-pipeline:gateway-sdk-dispatch

Execute Phase 6: agentide composition. Add backendRuntimePort to CreatePlatformConfig, auto-create BackendRuntime when set, wire lifecycle (start after gateway, stop before), pass to gateway.config.backendRuntime. End-to-end integration test: connect fake SDK over WS, register caps, invoke, assert result.

---

## 2026-07-30 02:40:12 | source: feature-pipeline:gateway-sdk-dispatch

Phase 7: drift check + ship the gateway-sdk-dispatch pack. Fix the 3 existing lint warnings along the way (Phase 2 server.test.ts unused connectAndAuthWithRegisteredCap, Phase 4 dispatch.test.ts unused BackendValue import, Phase 5 gateway-core factory.ts unused BackendRuntime type import). Update Feature_Backlog.md + CONTEXT.md Decisions Log + drift log + run drift sub-agent + build post-impl sim + reconcile.

---

## 2026-07-30 06:26:01 | source: direct

Step back from mcp-adapter. User's audit: 4 real inconsistencies need resolution before building the next layer — event-bus doc duplication (event-bus vs event-bus-b), competing lockfiles (npm + pnpm), D-1 session-manager drift, plugin:<id> dispatch seam incomplete. Backlog gap: scripts/backlog/ outside git. Don't proceed to mcp-adapter until drift is resolved.

---

## 2026-07-30 07:24:25 | source: direct

Tackle audit issues 5 & 6: (5) plugin:<id> dispatch seam in gateway-core/src/dispatch.ts (real work — plugin-manager needs handleInvocation API), (6) scripts/backlog/ — user previously said 'we don't need those' so this is a discussion/decision item, not work.

---

## 2026-07-30 07:45:34 | source: direct

Decision: DEFER Issue 5 (plugin:<id> dispatch seam). Reasons: (1) design question unresolved — how plugins register handler functions (in-process JS / child-process IPC / forked module); (2) no concrete consumer yet (browser-runtime is Tier 4, blocked on BI[8a); (3) current stub is non-blocking with retryable=true; (4) doing it wrong locks in a wrong interface. Recorded as D-29 in drift.md. BI[8a] reopens when BI[12 browser-runtime] starts — browser-runtime IS the first plugin:<id> consumer, so its requirements constrain the API.

---
