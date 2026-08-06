// Cap records + backing map (CID:dash-001/002/003). See index.ts.
import type { CapabilityRecord } from "@spanexx/capability-registry";

export const DASHBOARD_BACKING: Readonly<Record<string, string>> = {
  "dashboard.view.sessions": "session.list",
  "dashboard.view.plugins": "plugin.list",
  "dashboard.view.capabilities": "capability.list",
  "dashboard.view.health": "system.health",
} as const;

export const DASHBOARD_CAPSESSION_LESS: readonly string[] = [
  "dashboard.view.sessions",
  "dashboard.view.plugins",
  "dashboard.view.capabilities",
  "dashboard.view.health",
] as const;

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