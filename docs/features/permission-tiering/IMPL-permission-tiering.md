# IMPL: Permission Tiering

**Slug:** permission-tiering
**Status:** Draft
**Date:** 2026-07-28

## Phase Plan

**No new external dependencies.** All work uses existing packages.

### Phase 1: tier field in capability-registry types + validator

**Build:**
- `packages/capability-registry/src/types.ts`: add `CapabilityTier` union type and `tier?: CapabilityTier | null` field on both `CapabilityRecord` and `CapabilityCard`
- `packages/capability-registry/src/validate.ts`: enforce rules from PRD-TRD Scenario 5 + 6 — runtime tier required, business tier must be null; allow platform to omit
- `packages/capability-registry/src/validate.ts`: when tier is unset for non-runtime, derive from `permissions[0]`'s last segment; reject unknown values

**Verify:**
- [ ] Unit tests: runtime cap with no tier → `TIER_REQUIRED`
- [ ] Unit tests: runtime cap with tier `"write"` → `INVALID_TIER_FOR_RUNTIME`
- [ ] Unit tests: business cap with tier `"read"` → `INVALID_TIER_FOR_TYPE`
- [ ] Unit tests: platform cap without tier → derived correctly
- [ ] Unit tests: derivation uses last segment of `permissions[0]`
- [ ] All existing capability-registry tests still pass

**Blocked by:** nothing

### Phase 2: tier-convention in plugin-manager + manifest support

**Build:**
- `packages/plugin-manager/src/tier-convention.ts` (new): export `READ_VERBS`, `ACT_VERBS`, `DESTRUCTIVE_VERBS`, and `tierFromConvention(name: string): CapabilityTier | null`
- `packages/plugin-manager/src/types.ts`: extend manifest cap entry to accept `{ name, tier? } | string`
- `packages/plugin-manager/src/lifecycle.ts`: in the install algorithm, compute tier per cap — explicit `tier:` if given, else `tierFromConvention(name)`; throw `TIER_REQUIRED` if null
- `packages/plugin-manager/src/errors.ts`: add `TIER_REQUIRED` error code

**Verify:**
- [ ] Unit tests: `tierFromConvention("browser.navigate")` → `"act"`
- [ ] Unit tests: `tierFromConvention("browser.delete")` → `"destructive"`
- [ ] Unit tests: `tierFromConvention("browser.screenshot")` → `null`
- [ ] Unit tests: install manifest with `name: "browser.screenshot", tier: "read"` registers `tier: "read"`
- [ ] Unit tests: install manifest with `name: "browser.unknown"` and no explicit tier throws `TIER_REQUIRED`
- [ ] All existing plugin-manager tests still pass

**Blocked by:** Phase 1 (validator must accept `tier` before plugin-manager can write it)

### Phase 3: refactor platform-capabilities to declare tiers

**Build:**
- `packages/platform-capabilities/src/caps.ts` (or equivalent): update each of the 25 existing platform caps to pass `tier:` explicitly via the `cap()` helper — 1-line change per cap. Tier comes from the GRILL Decision 5 mapping (read = read-only, write = otherwise)

**Verify:**
- [ ] All 25 caps have explicit `tier:` in the source
- [ ] `capability list` (via pre-impl sim or unit test) shows `tier: "read"` for read-tier caps and `tier: "write"` for write-tier caps
- [ ] All existing platform-capabilities tests still pass

**Blocked by:** Phase 1 (registry must accept `tier`)

### Phase 4: tier-aware capability.list in gateway-core

**Build:**
- `packages/gateway-core/src/factory.ts`: replace the v1 placeholder in the `capability.list` handler with the coverage filter from PRD-TRD Scenario 2
- `packages/gateway-core/src/factory.ts`: pass `caller.scope` from the request to the handler; iterate `ctx.registry.list()` and run `checkAuthz(caller.scope, cap.permissions)` per card
- `packages/gateway-core/src/authz.ts`: no change — `tierCovers` already supports the wildcards needed

**Verify:**
- [ ] Integration test: token scope `runtime.browser.read` → only read-tier browser caps in `capability.list` response
- [ ] Integration test: token scope `*` → all 25 caps
- [ ] Integration test: token scope `[]` (empty) → empty list
- [ ] Integration test: malformed scope (e.g. `"xyzzy"`) → empty list, no crash
- [ ] Integration test: union of two scopes (e.g. `["runtime.*.read", "platform.*.read"]`) → union of covered caps
- [ ] All existing gateway-core tests still pass

**Blocked by:** Phase 1 (registry must expose `tier`), Phase 3 (caps must have tiers)

### Phase 5: agentide CLI prints tier

**Build:**
- `packages/agentide/src/commands/capability.ts` (or equivalent): update `capability list` print format to show the `tier` column
- No new flags

**Verify:**
- [ ] Manual: `agentide capability list` shows tier per row
- [ ] Format consistent with existing column-aligned output
- [ ] All existing agentide tests still pass

**Blocked by:** Phase 4 (gateway must return tier)

### Phase 6: post-impl simulation

**Build:**
- `docs/features/permission-tiering/simulate.sh` (or `.ts` if TypeScript is the chosen language) — mirrors the real implementation, not the design
- Reads from real packages via the integration test harness or the public API
- Demonstrates every scenario from PRD-TRD

**Verify:**
- [ ] All 8 scenarios produce the same outcome as the pre-impl sim
- [ ] The post-impl sim exercises real package code, not hardcoded data

**Blocked by:** Phase 5 (CLI must work end-to-end)

### Phase 7: drift check

**Build:**
- Spawn sub-agent via `feature-pipeline-review` skill
- Compare PRD-TRD scenarios vs actual code behavior
- Compare IMPL phases vs what got built
- Output `.reports/<timestamp>-drift-permission-tiering.md`

**Verify:**
- [ ] Drift report shows zero gaps (or accepted drift items)
- [ ] User signs off on the report

**Blocked by:** Phase 6

### Phase 8: reconcile simulations

**Build:**
- Read `simulate-pre.ts` and `simulate.sh` (or whichever post-impl file exists)
- For each scenario, pick the most accurate version
- Where they agree: simplify
- Where they disagree: implementation wins
- Delete or archive `simulate-pre.ts`
- Keep the reconciled script as canonical

**Verify:**
- [ ] One simulation file remains
- [ ] Reconciled script is shorter than either predecessor
- [ ] No scenario contradicts PRD-TRD Behavioral Spec

**Blocked by:** Phase 7

## Phase Dependencies

```
Phase 1 (registry types/validator)
  ├── Phase 2 (plugin-manager tier convention)
  │     └── Phase 3 (platform-capabilities refactor)
  │           └── Phase 4 (gateway tier filter)
  │                 └── Phase 5 (agentide CLI)
  │                       └── Phase 6 (post-impl sim)
  │                             └── Phase 7 (drift check)
  │                                   └── Phase 8 (reconcile)
```

Each phase depends on the previous; no parallel work.

## Test Strategy

- **Per-package unit tests** live in `packages/<pkg>/src/__tests__/`. Every new function gets a test in the same PR.
- **Integration tests** for the gateway tier filter in `packages/gateway-core/src/__tests__/` (or `packages/cateway-core/test/integration/` if that pattern exists).
- **End-to-end check** via the pre-impl sim first (design feedback), then the post-impl sim (reality check).
- **Run commands:** from repo root, `pnpm -r test` for all packages, `pnpm -C packages/<pkg> test` for one.

## Dependency Analysis (opensrc)

**No new external dependencies.** All work uses existing packages (`capability-registry`, `plugin-manager`, `platform-capabilities`, `gateway-core`, `agentide`). Each was already vetted when those packages shipped.

If Phase 2 needs additional runtime type information from a registry layer (e.g. to detect runtime caps at install time without parsing the manifest), the existing `plugin-manager` already imports `CapabilityRegistry` — no new package boundary needed.

## Rollout

No flag flip — this is dev. New runtime plugins MUST declare tier; the registry rejects missing. The 25 existing platform caps get explicit tiers in the same commit.

Migration story is "no migration." Pre-production. Refactor of `cap()` helper is a 1-line change per cap.

## Risk Notes

- **Validator strictness risk.** If the validator rejects an existing cap that was previously accepted, downstream packages may break. Mitigation: ship Phase 1 with `--no-strict` flag (or check `process.env.NODE_ENV === 'production'`), tighten in Phase 3 after the 25 caps are updated. Actually: do all three phases (1+2+3) in the same release so the constraint is consistent from day one.
- **Tier convention risk.** A new verb not in any list will throw `TIER_REQUIRED` at install. Plugin authors will see the error and add `tier:` explicitly. This is the desired outcome.
- **Filter regression risk.** The new `capability.list` filter could break existing CLI/SDK callers that expect the full catalog. Mitigation: only callers with a scope token see the filter. The bootstrap `*` scope returns everything — operators are unaffected.

## Status Updates

Mark each phase inline as it completes:

```
### Phase 1: types + validator — ⏳ Pending
### Phase 2: tier convention — ⏳ Pending
### Phase 3: caps refactor — ⏳ Pending
### Phase 4: gateway filter — ⏳ Pending
### Phase 5: CLI print — ⏳ Pending
### Phase 6: post-impl sim — ⏳ Pending
### Phase 7: drift check — ⏳ Pending
### Phase 8: reconcile — ⏳ Pending
```

Then update `docs/Feature_Backlog.md` and run `update-backlog` skill after each phase completes.