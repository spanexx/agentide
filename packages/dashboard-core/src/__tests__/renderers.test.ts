import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// P4: pure renderers + backoff live in assets/render.js. We eval the
// file in an isolated scope that injects a fake `window` so the IIFE
// installs AgentideRender there. The test asserts on the resulting
// exports.
function loadRender() {
  const renderJs = readFileSync(join(__dirname, "..", "assets", "render.js"), "utf8");
  const fakeWindow: Record<string, unknown> = {};
  const fakeSelf: Record<string, unknown> = {};
  const fn = new Function("window", "globalThis", renderJs);
  fn(fakeWindow, fakeSelf);
  return fakeWindow.AgentideRender as {
    renderSessions: (s: unknown) => string;
    renderPlugins: (s: unknown) => string;
    renderCaps: (s: unknown) => string;
    renderHealth: (s: unknown) => string;
    renderError: (msg: string) => string;
    computeBackoff: (attempt: number) => number;
    renderDetailRows: (rec: Record<string, unknown>) => string;
  };
}

const R = loadRender();
const { renderSessions, renderPlugins, renderCaps, renderHealth,
        renderError, computeBackoff } = R;

describe("P4 renderers + backoff (render.js)", () => {
  it("renderSessions draws the table with status colors", () => {
    const html = renderSessions([
      { id: "abc12345-x", status: "active", owner: "alice", createdAt: "10:00" },
      { id: "def67890-y", status: "suspended", owner: "bob", createdAt: "10:01" },
    ]);
    expect(html).toContain("table");
    expect(html).toContain('class="s"');
    expect(html).toContain('class="sus"');
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain('data-kind="session"');
  });

  it("renderSessions shows the empty text for zero records", () => {
    expect(renderSessions([])).toContain("no sessions");
    expect(renderSessions(undefined)).toContain("no sessions");
  });

  it("renderPlugins draws enabled/disabled states", () => {
    const html = renderPlugins([
      { id: "p1", version: "1.0", enabled: true },
      { id: "p2", version: "0.4", enabled: false },
    ]);
    expect(html).toContain("enabled");
    expect(html).toContain("disabled");
    expect(html).toContain('class="en"');
    expect(html).toContain('class="dis"');
  });

  it("renderCaps shows tier badges (read vs business)", () => {
    const html = renderCaps([
      { name: "session.list", tier: "read" },
      { name: "product.list", tier: null },
    ]);
    expect(html).toContain('class="tier read"');
    expect(html).toContain('class="tier biz"');
  });

  it("renderHealth shows status, uptime, tenant+plugin counts", () => {
    const html = renderHealth({ status: "ok", uptimeMs: 5000, tenantCount: 2, pluginCount: 3 });
    expect(html).toContain("ok");
    expect(html).toContain("5s");
    expect(html).toContain("2");
    expect(html).toContain("3");
  });

  it("renderHealth shows the empty text when down", () => {
    expect(renderHealth({ status: "down" })).toContain("unreachable");
    expect(renderHealth(null)).toContain("unreachable");
  });

  it("renderError wraps the verbatim GATEWAY_* message", () => {
    expect(renderError("GATEWAY_INTERNAL_ERROR: no backing store")).toContain("error-msg");
    expect(renderError("GATEWAY_INTERNAL_ERROR: no backing store")).toContain("no backing store");
  });

  it("computeBackoff doubles to the 30s cap with ±20% jitter", () => {
    expect(computeBackoff(1)).toBeGreaterThanOrEqual(800);
    expect(computeBackoff(1)).toBeLessThanOrEqual(1200);
    expect(computeBackoff(3)).toBeGreaterThanOrEqual(3200);
    expect(computeBackoff(3)).toBeLessThanOrEqual(4800);
    expect(computeBackoff(10)).toBeGreaterThanOrEqual(24000);
    expect(computeBackoff(10)).toBeLessThanOrEqual(36000);
  });
});