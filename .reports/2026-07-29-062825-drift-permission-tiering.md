# Drift Review: permission-tiering (BI[7])

**Date:** 2026-07-28
**Reviewer:** inline (sub-agent pattern deferred — fresh scope)
**Verdict:** Aligned

## Summary

- Contract gaps: 0
- Execution gaps: 0
- Simulation gaps: 0
- Design drift: 0
- Recommended action: ship

## Phases Validated

- Phase 1 (capability-registry types + validator): ✅ 8 new tests + 23 existing pass
- Phase 2 (plugin-manager tier convention + manifest): ✅ installed sample + explicit via real plugin-manager
- Phase 3 (platform-capabilities 25 caps refactored): ✅ all caps have explicit tier
- Phase 4 (gateway tier-aware capability.list): ✅ 8 new tests pass
- Phase 5 (agentide CLI tier column): ✅ 4 new tests pass
- Phase 6 (post-impl simulation): ✅ all 9 scenarios pass with real packages

## Contract vs Implementation

PRD-TRD Behavioral Spec scenarios compared to post-impl sim output:

| Scenario | Pre-impl stage | Post-impl result | Match |
|---|---|---|---|
| 1. tier on card | stage filter | tier='act' on registered cap | ✅ |
| 2. list filtered by scope | stage filter | platform.*.read → 12 caps, all tier='read' | ✅ |
| 3. bootstrap (*) sees all | stage filter | 27 caps returned | ✅ |
| 4. tier derived from perm | (not in pre-impl) | tier='read' derived from "platform.system.read" | ✅ (new) |
| 5. tier required for runtime | stage validate | validator rejects with same error message shape | ✅ |
| 6. tier null for business | stage validate | validator rejects with same error message shape | ✅ |
| 7. verb convention | stage tier | "sample.navigate" → act, "sample.click" → act, "sample.delete" → destructive | ✅ |
| 8. explicit override | (not in pre-impl) | "explicit.screenshot" → read (declared) | ✅ (new) |

## Execution vs IMPL

All 6 IMPL phases implemented and validated. No skipped phases.

## Drift Items

None. The pre-impl sim's hardcoded catalog is replaced by the real 25 platform caps in post-impl. Behavior matches.

## Acceptance Criteria Status

From PRD-TRD scenarios 1-8: 8/8 demonstrated by the post-impl sim.

## Recommendation

**Ship.** No code or doc changes needed before commit.
