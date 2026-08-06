import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// P4: pure renderers + backoff live in assets/app.js (browser-only by default).
// These tests load the file as text, eval the renderer + backoff declarations
// in an isolated scope, and assert their behavior. The browser-only `boot()`
// (DOM + WebSocket) is exercised by the integration tests in P5/P6.
const appJs = readFileSync(join(__dirname, "..", "assets", "app.js"), "utf8");
// Strip ESM `export` statements; the browser doesn't need them at runtime,
// and stripping lets the iso-function pick up the bare declarations.
const stripped = appJs
  .replace(/^export\s+/gm, "")
  .replace(/^if \(typeof window !== "undefined"\) boot\(\);\s*$/m, "/* boot skipped in test */");
const iso = new Function(stripped + "\n;return { renderSessions, renderPlugins, renderCaps, renderHealth, computeBackoff, STATES };");
const { renderSessions, renderPlugins, renderCaps, renderHealth, computeBackoff, STATES } = iso();

describe("P4 renderers + backoff (app.js pure modules)", () => {
  it("renderSessions draws the table with status colors", () => {
    const html = renderSessions([
      { id: "abc12345-x", status: "active", owner: "alice", createdAt: "10:00" },
      { id: "def67890-y", status: "suspended", owner: "bob", createdAt: "10:01" },
    ]);
    expect(html).toContain("table");
    expect(html).toContain('class="s"'); // active
    expect(html).toContain('class="sus"'); // suspended
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain("data-kind=\"session\"");
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

  it("computeBackoff doubles to the 30s cap with ±20% jitter", () => {
    // attempt 1 → ~1s ± 200ms
    expect(computeBackoff(1)).toBeGreaterThanOrEqual(800);
    expect(computeBackoff(1)).toBeLessThanOrEqual(1200);
    // attempt 3 → ~4s ± 800ms
    expect(computeBackoff(3)).toBeGreaterThanOrEqual(3200);
    expect(computeBackoff(3)).toBeLessThanOrEqual(4800);
    // attempt 10 → capped at 30s ± 6s
    expect(computeBackoff(10)).toBeGreaterThanOrEqual(24000);
    expect(computeBackoff(10)).toBeLessThanOrEqual(36000);
  });

  it("exposes the four state names (Q9 lifecycle)", () => {
    expect(STATES).toEqual({
      CONNECTING: "connecting",
      CONNECTED: "connected",
      DOWN: "down",
      TERMINAL: "terminal",
    });
  });
});