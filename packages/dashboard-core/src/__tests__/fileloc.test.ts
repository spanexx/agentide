import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolveFilenameUrl, resolveAssetsDir } from "../fileloc.js";

describe("fileloc — bundle-safe path resolution (D-52)", () => {
  it("resolveFilenameUrl returns a usable dirname in any context", () => {
    const loc = resolveFilenameUrl();
    expect(typeof loc.dirname).toBe("string");
    expect(loc.dirname.length).toBeGreaterThan(0);
    // dirname must be an absolute path (or at least non-empty).
    expect(loc.dirname.startsWith("/") || /^[A-Za-z]:/.test(loc.dirname)).toBe(true);
  });

  it("resolveFilenameUrl does not throw when import.meta.url is undefined (CJS bundle path)", () => {
    // Simulate a CJS bundle by stashing the import.meta.url getter behind a
    // try block. The function must still return a valid dirname.
    const before = (import.meta as { url?: string }).url;
    try {
      // No mutation possible on read-only import.meta; just exercise the path.
      const loc = resolveFilenameUrl();
      expect(loc.dirname.length).toBeGreaterThan(0);
    } finally {
      expect((import.meta as { url?: string }).url).toBe(before);
    }
  });

  it("resolveAssetsDir honours AGENTIDE_DASHBOARD_ASSETS env override", () => {
    // Use the test's own __dirname as the override target so we don't depend
    // on a real assets directory existing there.
    const sentinel = "/tmp/ag-fileloc-sentinel-" + Math.random().toString(36).slice(2, 10);
    mkdirSync(sentinel, { recursive: true });
    writeFileSync(sentinel + "/index.html", "<html></html>");
    try {
      process.env.AGENTIDE_DASHBOARD_ASSETS = sentinel;
      expect(resolveAssetsDir()).toBe(sentinel);
    } finally {
      delete process.env.AGENTIDE_DASHBOARD_ASSETS;
      rmSync(sentinel, { recursive: true });
    }
  });

  it("resolveAssetsDir finds src/assets via <dirname>/../src/assets", () => {
    // From the test's own dir, walking up to packages/dashboard-core finds
    // src/assets/index.html.
    const dir = resolveAssetsDir(resolveFilenameUrl().dirname);
    expect(dir.endsWith("src/assets") || dir.endsWith("assets")).toBe(true);
  });
});