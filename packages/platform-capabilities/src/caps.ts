/*
 * Code Map: 29 platform-capability records
 * - GATEWAY_CAPS: 16 caps under owner="gateway" (4 tenant.* + 4 client.* + 3 gateway.* + 2 auth.token.* + 3 system.*)
 * - SESSION_CAPS: 5 caps under owner="session-manager"
 * - CAPABILITY_CAPS: 2 caps under owner="capability-registry"
 * - PLUGIN_CAPS: 6 caps under owner="plugin-manager"
 *
 * CID Index:
 * CID:caps-001 -> GATEWAY_CAPS
 * CID:caps-002 -> SESSION_CAPS
 * CID:caps-003 -> CAPABILITY_CAPS
 * CID:caps-004 -> PLUGIN_CAPS
 * CID:caps-005 -> cap
 *
 * Quick lookup: rg -n "CID:caps-" packages/platform-capabilities/src/caps.ts
 */

import type { CapabilityRecord, CapabilityTier } from "@spanexx/capability-registry";

// CID:caps-005 - cap
// Purpose: capability-record constructor. All 25 caps share version 1.0.0 and type "platform".
// BI[7]: explicit `tier` is now required per the BI[7] Decision 5 convention — derived
// from the permission's last segment (read → read, write → write).
function cap(
  name: string,
  owner: string,
  permissions: readonly string[],
  description: string,
  tier: CapabilityTier,
): CapabilityRecord {
  return {
    name,
    version: "1.0.0",
    type: "platform",
    permissions,
    owner,
    description,
    tier,
  };
}

// CID:caps-001 - GATEWAY_CAPS
// 16 caps under owner="gateway": 4 tenant.* + 4 client.* + 3 gateway.* + 2 auth.token.* + 3 system.*
// client.* (BI[29] CID:cap-001..004): operator-facing service/app identity lifecycle
//   — create/revoke/rotate are write-tier; list is read-tier (BI[7] tier convention).
export const GATEWAY_CAPS: readonly CapabilityRecord[] = [
  cap("tenant.create", "gateway", ["platform.tenant.write"], "Create a tenant and bootstrap token", "write"),
  cap("tenant.list", "gateway", ["platform.tenant.read"], "List tenants visible to the caller", "read"),
  cap("tenant.suspend", "gateway", ["platform.tenant.write"], "Suspend a tenant (block new calls)", "write"),
  cap("tenant.delete", "gateway", ["platform.tenant.write"], "Delete a tenant (purge records)", "write"),
  // CID:cap-001 -> client.create
  cap("client.create", "gateway", ["platform.client.write"], "Create a client and return its secret once (5/hour per operator)", "write"),
  // CID:cap-002 -> client.list
  cap("client.list", "gateway", ["platform.client.read"], "List clients in the caller's tenant", "read"),
  // CID:cap-003 -> client.revoke
  cap("client.revoke", "gateway", ["platform.client.write"], "Revoke a client (blocks future token minting)", "write"),
  // CID:cap-004 -> client.rotate
  cap("client.rotate", "gateway", ["platform.client.write"], "Rotate a client secret (old secret valid for 5 min grace)", "write"),
  cap("gateway.status", "gateway", ["platform.gateway.read"], "Gateway runtime status", "read"),
  cap("gateway.metrics", "gateway", ["platform.gateway.read"], "Gateway counters and metrics", "read"),
  cap("gateway.configuration", "gateway", ["platform.gateway.read"], "Effective configuration (with secrets redacted)", "read"),
  cap("auth.token.issue", "gateway", ["platform.token.write"], "Mint a JWT for a caller", "write"),
  cap("auth.token.revoke", "gateway", ["platform.token.write"], "Revoke a JWT (no-op in v1)", "write"),
  cap("system.info", "gateway", ["platform.system.read"], "Platform name and version", "read"),
  cap("system.version", "gateway", ["platform.system.read"], "Platform version (semver + nullable buildHash)", "read"),
  cap("system.health", "gateway", ["platform.system.read"], "Platform health status (always ok in v1)", "read"),
];

// CID:caps-002 - SESSION_CAPS
// 5 caps under owner="session-manager" (migrated from gateway-core)
export const SESSION_CAPS: readonly CapabilityRecord[] = [
  cap("session.create", "session-manager", ["platform.session.write"], "Create a session", "write"),
  cap("session.resume", "session-manager", ["platform.session.write"], "Resume a session", "write"),
  cap("session.destroy", "session-manager", ["platform.session.write"], "Destroy a session and cleanup resources", "write"),
  cap("session.touch", "session-manager", ["platform.session.write"], "Reset a session's idle timer", "write"),
  cap("session.list", "session-manager", ["platform.session.read"], "List sessions (active + archived; D-45 closeout 2026-08-06 — real snapshot)", "read"),
];

// CID:caps-003 - CAPABILITY_CAPS
// 2 caps under owner="capability-registry" (migrated from gateway-core)
export const CAPABILITY_CAPS: readonly CapabilityRecord[] = [
  cap("capability.list", "capability-registry", ["platform.capability.read"], "List registered capabilities", "read"),
  cap("capability.describe", "capability-registry", ["platform.capability.read"], "Describe one capability by name", "read"),
];

// CID:caps-004 - PLUGIN_CAPS
// 6 caps under owner="plugin-manager" (new in BI[6])
export const PLUGIN_CAPS: readonly CapabilityRecord[] = [
  cap("plugin.install", "plugin-manager", ["platform.plugin.write"], "Install a plugin from local source", "write"),
  cap("plugin.uninstall", "plugin-manager", ["platform.plugin.write"], "Uninstall a plugin and cleanup resources", "write"),
  cap("plugin.enable", "plugin-manager", ["platform.plugin.write"], "Enable a previously disabled plugin", "write"),
  cap("plugin.disable", "plugin-manager", ["platform.plugin.write"], "Disable a plugin (in-flight finish)", "write"),
  cap("plugin.reload", "plugin-manager", ["platform.plugin.write"], "Re-read a plugin's source from disk", "write"),
  cap("plugin.list", "plugin-manager", ["platform.plugin.read"], "List installed plugins", "read"),
];

// Total: 12 + 5 + 2 + 6 = 25 caps across 4 owners.
