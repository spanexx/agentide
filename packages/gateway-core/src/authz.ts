/*
 * Code Map: tier-hierarchy permission check
 * - checkAuthz: caller.scope vs capability.permissions; higher-tier scopes cover lower-tier ones (runtime + platform); business caps exact-match
 *   The wildcard scope "*" covers every required permission (used by the bootstrap operator token).
 *   Tier hierarchy is namespace-scoped for runtime permissions (per GRILL Q4): "runtime.demo.act" covers "runtime.demo.read"
 *   but does NOT cover "platform.demo.write" or "runtime.other.read".
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
//   Wildcard: a scope of "*" covers every required permission (bootstrap operator token).
//   Namespace wildcard: a scope of "platform.*.<tier>" covers every read/write cap in the platform
//     namespace (e.g. "platform.*.read" covers "platform.session.read", "platform.tenant.read", etc.)
//     The wildcard does NOT cross kind (platform.*.read does NOT cover runtime.*.read).
//   Runtime caps: read < act < destructive (higher covers lower); namespace-scoped.
//   Platform caps: read < write (higher covers lower); namespace-scoped (the "namespace" for platform
//     is the next segment, e.g., "plugin" in "platform.plugin.write"; "platform.plugin.write" does NOT
//     cover "platform.tenant.read").
//   Business caps: exact match (each capability is its own action).
// Returns true if the caller's scope covers ANY of the capability's declared permissions.
// Used by: handleInvocation pipeline (after rate-limit + session checks, before dispatch)
export function checkAuthz(callerScope: readonly string[], requiredPermissions: readonly string[]): boolean {
  for (const required of requiredPermissions) {
    for (const granted of callerScope) {
      // Wildcard covers everything.
      if (granted === "*") return true;
      // Both rank-null → exact string match (business caps, anything not in runtime/platform tier system).
      const requiredRank = rank(required);
      const grantedRank = rank(granted);
      if (requiredRank === null && grantedRank === null) {
        if (granted === required) return true;
        continue;
      }
      // Both have a tier rank → same kind + same namespace + caller rank >= required rank.
      if (requiredRank !== null && grantedRank !== null && tierCovers(granted, required)) {
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
  const grantedParts = grantedScope.split(".");
  const requiredParts = requiredScope.split(".");
  if (grantedParts.length < 2 || requiredParts.length < 2) return false;
  // Same kind (runtime vs platform) — first segment must match.
  if (grantedParts[0] !== requiredParts[0]) return false;
  // Namespace wildcard: grantedParts[1] === "*" matches any required namespace.
  // This is what makes "platform.*.read" cover "platform.session.read", "platform.tenant.read", etc.
  if (grantedParts[1] === "*") {
    return gr >= req;
  }
  // For both runtime and platform, scope the comparison to (kind, namespace):
  //   runtime: kind="runtime", namespace=parts[1], tier=last
  //   platform: kind="platform", namespace=parts[1], tier=last  (e.g., "platform.plugin.write" → ns="plugin", tier="write")
  // Same kind + same namespace + caller's tier rank >= required's tier rank → covers.
  if (grantedParts[1] !== requiredParts[1]) return false;
  return gr >= req;
}

// Suppress unused — RUNTIME_TIERS / PLATFORM_TIERS are documentation; tierCovers() uses TIER_RANK.
void RUNTIME_TIERS;
void PLATFORM_TIERS;