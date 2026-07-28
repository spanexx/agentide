/*
 * Code Map: 25 platform-capability records
 * - GATEWAY_CAPS: 12 caps under owner="gateway" (4 tenant.* + 3 gateway.* + 2 auth.token.* + 3 system.*)
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

import type { CapabilityRecord } from "@platform/capability-registry";

// CID:caps-005 - cap
// Purpose: capability-record constructor. All 25 caps share version 1.0.0 and type "platform".
function cap(
  name: string,
  owner: string,
  permissions: readonly string[],
  description: string,
): CapabilityRecord {
  return {
    name,
    version: "1.0.0",
    type: "platform",
    permissions,
    owner,
    description,
  };
}

// CID:caps-001 - GATEWAY_CAPS
// 12 caps under owner="gateway": 4 tenant.* + 3 gateway.* + 2 auth.token.* + 3 system.*
export const GATEWAY_CAPS: readonly CapabilityRecord[] = [
  cap("tenant.create", "gateway", ["platform.tenant.write"], "Create a tenant and bootstrap token"),
  cap("tenant.list", "gateway", ["platform.tenant.read"], "List tenants visible to the caller"),
  cap("tenant.suspend", "gateway", ["platform.tenant.write"], "Suspend a tenant (block new calls)"),
  cap("tenant.delete", "gateway", ["platform.tenant.write"], "Delete a tenant (purge records)"),
  cap("gateway.status", "gateway", ["platform.gateway.read"], "Gateway runtime status"),
  cap("gateway.metrics", "gateway", ["platform.gateway.read"], "Gateway counters and metrics"),
  cap("gateway.configuration", "gateway", ["platform.gateway.read"], "Effective configuration (with secrets redacted)"),
  cap("auth.token.issue", "gateway", ["platform.token.write"], "Mint a JWT for a caller"),
  cap("auth.token.revoke", "gateway", ["platform.token.write"], "Revoke a JWT (no-op in v1)"),
  cap("system.info", "gateway", ["platform.system.read"], "Platform name and version"),
  cap("system.version", "gateway", ["platform.system.read"], "Platform version (semver + nullable buildHash)"),
  cap("system.health", "gateway", ["platform.system.read"], "Platform health status (always ok in v1)"),
];

// CID:caps-002 - SESSION_CAPS
// 5 caps under owner="session-manager" (migrated from gateway-core)
export const SESSION_CAPS: readonly CapabilityRecord[] = [
  cap("session.create", "session-manager", ["platform.session.write"], "Create a session"),
  cap("session.resume", "session-manager", ["platform.session.write"], "Resume a session"),
  cap("session.destroy", "session-manager", ["platform.session.write"], "Destroy a session and cleanup resources"),
  cap("session.touch", "session-manager", ["platform.session.write"], "Reset a session's idle timer"),
  cap("session.list", "session-manager", ["platform.session.read"], "List sessions in the caller's tenant"),
];

// CID:caps-003 - CAPABILITY_CAPS
// 2 caps under owner="capability-registry" (migrated from gateway-core)
export const CAPABILITY_CAPS: readonly CapabilityRecord[] = [
  cap("capability.list", "capability-registry", ["platform.capability.read"], "List registered capabilities"),
  cap("capability.describe", "capability-registry", ["platform.capability.read"], "Describe one capability by name"),
];

// CID:caps-004 - PLUGIN_CAPS
// 6 caps under owner="plugin-manager" (new in BI[6])
export const PLUGIN_CAPS: readonly CapabilityRecord[] = [
  cap("plugin.install", "plugin-manager", ["platform.plugin.write"], "Install a plugin from local source"),
  cap("plugin.uninstall", "plugin-manager", ["platform.plugin.write"], "Uninstall a plugin and cleanup resources"),
  cap("plugin.enable", "plugin-manager", ["platform.plugin.write"], "Enable a previously disabled plugin"),
  cap("plugin.disable", "plugin-manager", ["platform.plugin.write"], "Disable a plugin (in-flight finish)"),
  cap("plugin.reload", "plugin-manager", ["platform.plugin.write"], "Re-read a plugin's source from disk"),
  cap("plugin.list", "plugin-manager", ["platform.plugin.read"], "List installed plugins"),
];

// Total: 12 + 5 + 2 + 6 = 25 caps across 4 owners.
