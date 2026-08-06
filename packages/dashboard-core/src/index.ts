/*
 * Code Map: dashboard-core public surface (BI[13] — Tier 5 Visibility).
 *
 * Exports (added per phase; composition root in @platform/agentide imports
 * only what it needs):
 *   - DASHBOARD_CAPS          (P1) four dashboard.view.* CapabilityRecords
 *   - DASHBOARD_BACKING       (P1) view-name → backing read-cap name
 *   - DASHBOARD_CAPSESSION_LESS (P1) the four names — for the factory seam
 *   - createDashboardHandlers (P2) thin passthrough wrappers
 *   - mintDashboardToken      (P3) origin-bound operator token for the page
 *   - createDashboardServer   (P3) static server (127.0.0.1, GET / + /assets/*)
 *   - DASHBOARD_DEFAULT_PORT  (P3) 7200
 *
 * CID Index:
 *   CID:dash-001 -> DASHBOARD_CAPS
 *   CID:dash-002 -> DASHBOARD_BACKING
 *   CID:dash-003 -> DASHBOARD_CAPSESSION_LESS
 *
 * Quick lookup: rg -n "CID:dash-" packages/dashboard-core/src/
 */

import type { CapabilityRecord } from "@spanexx/capability-registry";

// CID:dash-002 - DASHBOARD_BACKING
// Source of truth for which read cap backs each view. Keep aligned with
// the locked GRILL Q5 + map D5.
export const DASHBOARD_BACKING: Readonly<Record<string, string>> = {
  "dashboard.view.sessions": "session.list",
  "dashboard.view.plugins": "plugin.list",
  "dashboard.view.capabilities": "capability.list",
  "dashboard.view.health": "system.health",
} as const;

// CID:dash-003 - DASHBOARD_CAPSESSION_LESS
// Joined to the kernel session-less set via GatewayConfig.extraSessionLessCapabilities.
export const DASHBOARD_CAPSESSION_LESS: readonly string[] = [
  "dashboard.view.sessions",
  "dashboard.view.plugins",
  "dashboard.view.capabilities",
  "dashboard.view.health",
] as const;

// CID:dash-001 - DASHBOARD_CAPS
// Locked D2 contract: type platform, owner dashboard, tier read,
// permissions ["platform.dashboard.read"], session-less. Each cap is a thin
// passthrough wrapper over its backing read cap (P2 implements the handler).
export const DASHBOARD_CAPS: readonly CapabilityRecord[] = [
  {
    name: "dashboard.view.sessions",
    version: "1.0.0",
    type: "platform",
    description: "Snapshot of sessions (active + archived) for the dashboard.",
    permissions: ["platform.dashboard.read"],
    owner: "dashboard",
    tier: "read",
  },
  {
    name: "dashboard.view.plugins",
    version: "1.0.0",
    type: "platform",
    description: "Snapshot of installed plugins for the dashboard.",
    permissions: ["platform.dashboard.read"],
    owner: "dashboard",
    tier: "read",
  },
  {
    name: "dashboard.view.capabilities",
    version: "1.0.0",
    type: "platform",
    description: "Snapshot of registered capabilities for the dashboard.",
    permissions: ["platform.dashboard.read"],
    owner: "dashboard",
    tier: "read",
  },
  {
    name: "dashboard.view.health",
    version: "1.0.0",
    type: "platform",
    description: "Snapshot of runtime health for the dashboard.",
    permissions: ["platform.dashboard.read"],
    owner: "dashboard",
    tier: "read",
  },
] as const;