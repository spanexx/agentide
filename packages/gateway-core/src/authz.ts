/*
 * Code Map: tier-hierarchy permission check
 * - checkAuthz: caller.scope vs capability.permissions; higher-tier scopes cover lower-tier ones (runtime + platform); business caps exact-match
 *
 * CID Index:
 * CID:authz-001 -> checkAuthz
 * CID:authz-002 -> TIER_RANK
 *
 * Quick lookup: rg -n "CID:authz-" packages/gateway-core/src/authz.ts
 */

const RUNTIME_TIERS = ["read", "act", "destructive"] as const;
const PLATFORM_TIERS = ["read", "write"] as const;

// CID:authz-002 - TIER_RANK
// Purpose: numeric rank for tier hierarchy; higher tier covers lower.
// Runtime tier shape: "runtime.<namespace>.<tier>"  (tier is the LAST segment).
// Platform tier shape: "platform.<tier>"             (tier is the LAST segment).
// Business tier shape: a string that doesn't match the runtime/platform prefix — no tier; exact match only.
// (Documentation only; no `any` type in code.)
function rank(scope: string): number | null {
  const parts = scope.split(".");
  if (parts.length < 2) return null;
  const kind = parts[0];
  const tier = parts[parts.length - 1];
  if (kind === "runtime") {
    if (tier === "read") return 1;
    if (tier === "act") return 2;
    if (tier === "destructive") return 3;
    return null;
  }
  if (kind === "platform") {
    if (tier === "read") return 1;
    if (tier === "write") return 2;
    return null;
  }
  return null;
}

// CID:authz-001 - checkAuthz
// Purpose: tier-hierarchy permission check (Q4 decision)
//   Runtime caps: read < act < destructive (higher covers lower)
//   Platform caps: read < write (higher covers lower)
//   Business caps: exact match (each capability is its own action)
// Returns true if the caller's scope covers ANY of the capability's declared permissions.
// Used by: handleInvocation pipeline (after rate-limit + session checks, before dispatch)
export function checkAuthz(callerScope: readonly string[], requiredPermissions: readonly string[]): boolean {
  for (const required of requiredPermissions) {
    const requiredRank = rank(required);
    for (const granted of callerScope) {
      // Business caps + other exact-match permissions: rank() returns null → exact-string match.
      if (rank(required) === null && rank(granted) === null) {
        if (granted === required) return true;
        continue;
      }
      // Both have a tier rank → same namespace AND caller rank >= required rank.
      if (requiredRank !== null && rank(granted) !== null && tierCovers(granted, required)) {
        return true;
      }
    }
  }
  return false;
}

function tierCovers(grantedScope: string, requiredScope: string): boolean {
  const gr = rank(grantedScope);
  const req = rank(requiredScope);
  if (gr === null || req === null) return false;
  // Same kind (runtime vs platform) — first segment must match.
  const grantedKind = grantedScope.split(".")[0];
  const requiredKind = requiredScope.split(".")[0];
  if (grantedKind !== requiredKind) return false;
  // For runtime: the namespace (parts[1]) must also match. For platform: there is no namespace.
  if (grantedKind === "runtime") {
    const grantedNs = grantedScope.split(".")[1];
    const requiredNs = requiredScope.split(".")[1];
    if (grantedNs !== requiredNs) return false;
  }
  // Higher tier covers lower tier (e.g., "runtime.demo.act" covers "runtime.demo.read").
  return gr >= req;
}

// Suppress unused — RUNTIME_TIERS / PLATFORM_TIERS are documentation; tierCovers() uses TIER_RANK.
void RUNTIME_TIERS;
void PLATFORM_TIERS;