/*
 * Code Map: registerPlatformCapabilities — the single registration seam for all 25 platform caps
 * - registerPlatformCapabilities: 4-call migration that registers 25 caps under their real owners
 *
 * CID Index:
 * CID:register-001 -> registerPlatformCapabilities
 *
 * Quick lookup: rg -n "CID:register-" packages/platform-capabilities/src/register.ts
 */

import type { CapabilityRegistry } from "@platform/capability-registry";
import { CAPABILITY_CAPS, GATEWAY_CAPS, PLUGIN_CAPS, SESSION_CAPS } from "./caps.js";

// CID:register-001 - registerPlatformCapabilities
// Purpose: registers all 25 platform-cap records under their real owners.
//   The 4-call structure is required by the registry's cross-owner collision check
//   (see TRD-platform-capabilities.md §4.2 Migration Strategy).
//   Phase 1 re-installs "gateway" with only its 12 caps — the registry's diff
//   removes the 7 legacy caps under "gateway" whose owners have moved
//   (5 session.* + 2 capability.*). Phase 2 then registers the remaining 13
//   caps under session-manager, capability-registry, and plugin-manager.
// Used by: @platform/gateway-core/src/factory.ts (the only caller in v1)
// Idempotent: safe to call on every startup; the diff is empty after the first run.
export async function registerPlatformCapabilities(registry: CapabilityRegistry): Promise<void> {
  // Phase 1: re-register "gateway" with only the 12 caps it legitimately owns.
  // On a fresh install, this adds 12. On an upgrade from pre-BI[6], this removes 7
  // (session.* + capability.*) from the global store under "gateway".
  await registry.register("gateway", {
    owner: "gateway",
    capabilities: [...GATEWAY_CAPS],
  });

  // Phase 2: register the migrated + new caps under their real owners.
  await registry.register("session-manager", {
    owner: "session-manager",
    capabilities: [...SESSION_CAPS],
  });

  await registry.register("capability-registry", {
    owner: "capability-registry",
    capabilities: [...CAPABILITY_CAPS],
  });

  await registry.register("plugin-manager", {
    owner: "plugin-manager",
    capabilities: [...PLUGIN_CAPS],
  });
}
