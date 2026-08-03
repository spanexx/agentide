
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

## 2026-07-30 08:14:23 | source: feature-pipeline:gateway-plugin-dispatch

Implement BI[8a] gateway-plugin-dispatch per the GRILL. Phase 1 scaffold + types. Manifest gains runtime.entry field; plugin-manager gains handleInvocation API; dispatch.ts swaps the stub.

---

## 2026-07-30 09:00:47 | source: feature-pipeline:gateway-plugin-dispatch

Phase 1: write PRD-TRD-gateway-plugin-dispatch.md per skill template. Sections: why, behavioral spec (8 scenarios matching GRILL), simulation contract, technical design (data models + API contracts + deps + architecture), non-goals. 80-150 lines target, hard cap 350.

---

## 2026-07-30 09:09:54 | source: feature-pipeline:gateway-plugin-dispatch

Phase 2: IMPL-gateway-plugin-dispatch.md. PRD-TRD approved with Option B (translate plugin-manager errors to GATEWAY_* codes via kernel try/catch in dispatch.ts). Phases: 1 (already done at 162b4b2) → 2 (concurrent-lifecycle tests) → 3 (gateway error codes) → 4 (dispatch.ts swap) → 5 (integration test) → 6 (drift+sim+ship). Opensrc empty (no new deps). Rollout: zero-migration (no in-the-wild plugins have handlers to migrate to).

---

## 2026-07-30 13:30:46 | source: direct

Invoke wayfinder skill on "sdk-browser" — destination B (pack shipped).
---

## 2026-08-02 | source: user-prompt

how do i run the post simulate simulation interactive and give me the commands

---

## 2026-08-02 | source: handoff

Invoke handoff skill — write session handoff + breadcrumb (interactive sim verified, git-flow commits 2-4 pending).

---

## 2026-08-02 05:18:54 | source: wayfinder:sdk-browser

Wayfinder work-through: sdk-browser map (frontier T4 prototype / T7 task). Continue from map.md, resolve next decision ticket.

---

## 2026-08-02 05:23:46 | source: wayfinder:sdk-browser

Wayfinder work-through with ticket: T7 "sdk-browser and browser-runtime boundary doc" (task). Continue from map.md, resolve next decision ticket.

---

## 2026-08-02 06:56:16 | source: feature-pipeline:sdk-browser (review)

Fresh-eyes drift review of sdk-browser pack: compare PRD-TRD + IMPL docs vs code + post-impl sim; verify the 1→0 unregister fix (CapRegistry.isRegistered + syncRegistration view); run tests (61) and sim (10/10); check GRILL T1-T7, bus events, file sizes; write gap report to .reports/.

---

## 2026-08-03 14:53:31 | source: direct

Plan mint-side expectedOrigins (origin-bound tokens) in agentide. Research-only: 8 research questions with path:line evidence, then write full file-by-file plan to docs/features/expected-origins/PLAN.md. Do not modify implementation source. Do not run tests/builds.

---

## 2026-08-03 16:04:40 | source: feature-pipeline:cli-adapter

Continue (post-compaction): execute-pack closeout — post-impl sim for Phase 6 watch (simulate.sh), sub-agent review acceptance, drift D-59/60/61, reconcile (archive simulate-pre.html), commit 3aebf00, handoff doc.

---
