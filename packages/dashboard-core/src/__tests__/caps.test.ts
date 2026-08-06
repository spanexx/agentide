import { describe, expect, it } from "vitest";
import { DASHBOARD_BACKING, DASHBOARD_CAPS } from "../index.js";

// P1 dashboard-core (D2 lock): the four dashboard.view.* capability records.
// Shape is locked in wayfinder ticket D2:
//   type platform, owner dashboard, permissions ["platform.dashboard.read"],
//   tier read, session-less (joins the kernel session-less set via the
//   extraSessionLessCapabilities seam).
describe("DASHBOARD_CAPS (P1)", () => {
  it("defines exactly the four locked view caps in order", () => {
    expect(DASHBOARD_CAPS.map((c) => c.name)).toEqual([
      "dashboard.view.sessions",
      "dashboard.view.plugins",
      "dashboard.view.capabilities",
      "dashboard.view.health",
    ]);
  });

  it("binds every cap to the D2 contract", () => {
    for (const cap of DASHBOARD_CAPS) {
      expect(cap.type).toBe("platform");
      expect(cap.owner).toBe("dashboard");
      expect(cap.tier).toBe("read");
      expect(cap.permissions).toEqual(["platform.dashboard.read"]);
      expect(cap.version).toBe("1.0.0");
      expect(cap.description.length).toBeGreaterThan(0);
    }
  });

  it("maps each view to its backing read cap", () => {
    expect(DASHBOARD_BACKING).toEqual({
      "dashboard.view.sessions": "session.list",
      "dashboard.view.plugins": "plugin.list",
      "dashboard.view.capabilities": "capability.list",
      "dashboard.view.health": "system.health",
    });
  });
});