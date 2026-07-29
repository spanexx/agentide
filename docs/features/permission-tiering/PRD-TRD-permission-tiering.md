# PRD-TRD: Permission Tiering

**Slug:** permission-tiering
**Status:** Draft
**Date:** 2026-07-28

## Why This Exists

The platform documents a `read`/`act`/`destructive` tier convention for runtime capabilities (`docs/architecture/Runtime_Capabilities.md` §Permissions and Risk Tiers). Today the convention is only partially enforced:

- The tier is implicit — parsed from `permissions[0]` on every check.
- `capability.list` returns the full catalog regardless of caller scope.
- Wildcard scope tests that prove the tier hierarchy are missing.

The cost: a token scoped to `runtime.browser.read` can still see `customer.delete` in the catalog it gets back. The catalog becomes an info-leak. Agents and operators must remember what they can invoke instead of being shown only what they can.

This pack makes the convention real: tier is a first-class field, the catalog is filtered by the caller's scope, and the tier hierarchy is proven by tests that exercise wildcards across kinds and namespaces.

## Behavioral Spec

### Scenario 1: tier is part of the catalog response

**Given** a capability is registered
**When** the operator runs `capability.list` (or any caller hits the gateway)
**Then** each card includes a `tier` field: `"read" | "act" | "destructive" | "write" | null`

### Scenario 2: capability.list is filtered by caller's scope

**Given** an active token with scope `runtime.browser.read`
**When** the caller hits `capability.list`
**Then** the response includes only caps whose permissions are covered by the scope. Caps that would require `act` or `destructive` permission are absent.

### Scenario 3: bootstrap token sees everything

**Given** an active token with scope `*`
**When** the caller hits `capability.list`
**Then** the response includes all 25 existing caps regardless of tier.

### Scenario 4: tier is derived from permissions when not explicit (hybrid)

**Given** a platform cap registered without an explicit tier
**When** the registry stores it
**Then** the tier is computed from `permissions[0]`'s last segment (`read`/`act`/`destructive`/`write`). If the computed tier doesn't match a known tier value, the tier is set to `null` (silent fallback — the operator is responsible for declaring an explicit tier on runtime caps via the verb convention). Platform caps with unknown permission verbs simply show `tier: null` in the catalog.

### Scenario 5: tier is required for runtime caps

**Given** a runtime cap registered without an explicit tier AND with a verb not in the convention list
**When** `validateRecord` runs
**Then** validation fails with `TIER_REQUIRED`. The cap is not registered.

### Scenario 6: tier must be null for business caps

**Given** a business cap registered with `tier: "read"` (or any non-null)
**When** `validateRecord` runs
**Then** validation fails with `INVALID_TIER_FOR_TYPE`. The cap is not registered.

### Scenario 7: tier inferred by verb convention at install time

**Given** a runtime plugin manifest declares `browser.navigate` (verb in ACT_VERBS)
**When** the plugin manager installs it
**Then** the registry records `tier: "act"` without explicit declaration. Plugin authors only declare `tier:` when the verb is ambiguous (e.g. `browser.screenshot`).

### Scenario 8: explicit tier overrides convention

**Given** a runtime plugin manifest declares `name: browser.screenshot, tier: read` (screenshot not in any verb list)
**When** the plugin manager installs it
**Then** the registry records `tier: "read"`.

## Simulation Contract

The pre-impl sim (`docs/features/permission-tiering/simulate-pre.ts`) demonstrates each scenario via 8 stages. The post-impl sim will mirror the real implementation — every stage should produce the same outcome, but driven by the real package code.

| Scenario | Pre-impl stage | What it shows |
|---|---|---|
| 1, 2 | `filter` | `capability list` returns tier field; filtered by scope |
| 3 | `filter` (with bootstrap token) | All caps visible |
| 4 | `tier` | Tier derived when missing |
| 5, 6 | `validate` | Validator rejects missing/invalid tier |
| 7, 8 | `tier` | Verb convention + explicit override |

The user runs `npx tsx docs/features/permission-tiering/simulate-pre.ts stage scenario` to see the full 7-step demo end-to-end.

## Technical Design

### Data Models

**`CapabilityRecord` (in `packages/capability-registry/src/types.ts`)** gains:

```typescript
readonly tier?: CapabilityTier | null;
```

`CapabilityTier` is a union: `"read" | "act" | "destructive" | "write"`.

**`CapabilityCard`** (the compact form returned by `list()`) gains the same field.

### API Contracts

**`packages/capability-registry/src/validate.ts`** — `validateRecord` enforces:

| Cap type | tier requirement |
|---|---|
| `runtime` | REQUIRED, one of `read`/`act`/`destructive` |
| `platform` | OPTIONAL, derived if missing |
| `business` | MUST be null/undefined |

If unset for runtime, derivation uses `permissions[0]`'s last segment.

**`packages/plugin-manager/src/tier-convention.ts`** (new file) — the verb list:

```
READ_VERBS = {read, list, get, view, show, describe, fetch, query, count, is, has}
ACT_VERBS  = {write, set, put, create, update, edit, patch, append, push, post,
              send, open, close, start, stop, restart, pause, resume,
              navigate, goto, click, doubleclick, hover, type, press, select,
              scroll, wait, upload, download, run, exec, execute,
              install, enable, disable, reload, touch, move, copy, rename}
DESTRUCTIVE_VERBS = {delete, remove, drop, destroy, purge, wipe, reset, clear,
                     truncate, commit, merge, rebase, push, checkout}
```

The install algorithm (in `lifecycle.ts`): for each cap, prefer explicit `tier:` if given, else `tierFromConvention(name)`. If still null, throw `TIER_REQUIRED`.

**`packages/gateway-core/src/factory.ts`** — `capability.list` handler:

1. Read `caller.scope` from the request.
2. For each card in `ctx.registry.list()`:
   - Run `checkAuthz(caller.scope, card.permissions)`.
   - If covered, include the card.
3. Return the filtered array with `tier` field populated.

This replaces the v1 placeholder ("return the full catalog").

**`packages/agentide`** — CLI's `capability list` formatting prints the new `tier` column. Note: the `--tier <read|write|act|destructive>` filter flag was added by BI[6] (platform-capabilities pack) — it filters by the `card.tier` field via `card.tier === tierFilter`. `--owner` filter flag was also added by BI[6] alongside `--tier`.

### Dependencies

**No new external dependencies.** All work lives in existing packages:
- `packages/capability-registry` — schema + validator
- `packages/plugin-manager` — install algorithm + tier convention
- `packages/platform-capabilities` — 1-line change per existing cap (pass `tier:` explicitly)
- `packages/gateway-core` — capability.list filter
- `packages/agentide` — print formatting

Run `opensrc` skill on each package's existing dependencies — no new ones introduced, so this section is empty by design.

### Architecture Notes

The tier is metadata that callers and the registry both need to read. Storing it explicitly avoids the parsing-twice problem (authz checks the permission, the catalog filter checks the tier; both need the same value). The hybrid carry (derive when missing, accept explicit override) means the 25 existing platform caps get explicit tiers in one BI[7] commit, not churned through a migration.

The gateway is the authz authority. The filter is a one-line walk per cap. The registry stays decoupled from policy.

## Non-Goals

- **Tenant-scoped listing.** Deferred to BI[14] (Tenant design). Drift log #11.
- **Per-cap tier override at invocation time.** Tier is set at registration; it cannot be relaxed per call. A scope-elevation flow could be a future feature.
- **Tier-based UI gating in agentide.** The CLI prints the tier; no decision UIs.
- **Runtime re-tagging.** Once a cap is registered with a tier, the tier is fixed (no `setTier` API).
- **Cross-tier policy rules** (e.g. "destructive caps require a confirmation step"). Out of scope.

## Out of Scope (Future)

- BI[14] (Tenant design) — per-tenant install records + per-tenant capability visibility.
- Tier-change audit (who changed a cap's tier, when).
- Per-tenant wildcard scope tests.
- Operator-facing tier-change workflow in the CLI.

## References

- GRILL-permission-tiering.txt — locked decisions
- GRILL_QUESTIONS.md — the question pattern used to lock them
- docs/architecture/Runtime_Capabilities.md — convention source
- docs/architecture/Capability_System.md — capability schema
- docs/drift-issue-log.md item #11 — tenant-scoping defer trail
- packages/capability-registry/src/types.ts — current CapabilityRecord
- packages/gateway-core/src/factory.ts — current capability.list (v1 placeholder)
- packages/plugin-manager/src/lifecycle.ts — install algorithm
- data/sim-state.json — pre-impl sim state file
- docs/features/permission-tiering/simulate-pre.ts — pre-impl simulation