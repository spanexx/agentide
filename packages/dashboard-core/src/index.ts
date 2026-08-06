/*
 * Code Map: dashboard-core public surface (BI[13] — Tier 5 Visibility).
 *
 * Exports (added per phase; composition root in @platform/agentide imports
 * only what it needs):
 *   - DASHBOARD_CAPS              (P1) four dashboard.view.* CapabilityRecords
 *   - DASHBOARD_BACKING           (P1) view-name → backing read-cap name
 *   - DASHBOARD_CAPSESSION_LESS   (P1) the four names — for the factory seam
 *   - createDashboardHandlers     (P2) thin passthrough wrappers
 *   - mintDashboardToken          (P3) origin-bound operator token for the page
 *   - createDashboardServer       (P3) static server (127.0.0.1, GET / + /assets/*)
 *   - DASHBOARD_DEFAULT_PORT      (P3) 7200
 *
 * CID Index:
 *   CID:dash-001 -> DASHBOARD_CAPS (in caps.ts)
 *   CID:dash-002 -> DASHBOARD_BACKING (in caps.ts)
 *   CID:dash-003 -> DASHBOARD_CAPSESSION_LESS (in caps.ts)
 *   CID:handlers-001 -> createDashboardHandlers (in handlers.ts)
 *
 * Quick lookup: rg -n "CID:dash-" packages/dashboard-core/src/
 */

export {
  DASHBOARD_BACKING,
  DASHBOARD_CAPS,
  DASHBOARD_CAPSESSION_LESS,
} from "./caps.js";
export {
  createDashboardHandlers,
  type DashboardBotToken,
  type DashboardHandlerContext,
} from "./handlers.js";