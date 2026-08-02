/*
 * Code Map: browser-runtime manifest tests (self-contained — must NOT
 * import plugin-manager; browser-runtime is an independent feature pack).
 *
 * YAML is parsed directly; explicit tiers are read from the YAML shape;
 * inferred tiers are computed with the locally exported tierFromName
 * (mirror of the plugin-manager verb tables).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { tierFromName } from "../tier.js";

const manifestPath = fileURLToPath(new URL("../../manifest.yaml", import.meta.url));

type ManifestCap = string | { name: string; tier?: "read" | "act" | "destructive" };

interface ManifestShape {
  runtime?: { id?: string };
  version?: string;
  capabilities?: ManifestCap[];
}

const manifest = parse(readFileSync(manifestPath, "utf8")) as ManifestShape;

describe("browser-runtime manifest", () => {
  it("parses with runtime id browser and version 1.0", () => {
    expect(manifest.runtime?.id).toBe("browser");
    expect(manifest.version).toBe("1.0");
  });

  it("declares all 12 capabilities", () => {
    expect(manifest.capabilities).toHaveLength(12);
    const names = (manifest.capabilities ?? []).map((c) =>
      typeof c === "string" ? c : c.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "browser.launch",
        "browser.navigate",
        "browser.click",
        "browser.type",
        "browser.scroll",
        "browser.wait",
        "browser.screenshot",
        "browser.query",
        "browser.close",
        "browser.tab.open",
        "browser.tab.switch",
        "browser.tab.close",
      ]),
    );
  });

  it("explicit tiers: launch/screenshot/close/tab.switch/tab.close (audit Finding 9)", () => {
    const tiers = Object.fromEntries(
      (manifest.capabilities ?? []).map((c) => [
        typeof c === "string" ? c : c.name,
        typeof c === "string" ? null : c.tier ?? null,
      ]),
    );
    expect(tiers["browser.launch"]).toBe("act");
    expect(tiers["browser.screenshot"]).toBe("read");
    expect(tiers["browser.close"]).toBe("destructive");
    expect(tiers["browser.tab.switch"]).toBe("act");
    expect(tiers["browser.tab.close"]).toBe("destructive");
    // navigate/query are NOT declared explicitly (convention-inferred)
    expect(tiers["browser.navigate"]).toBeNull();
    expect(tiers["browser.query"]).toBeNull();
  });

  it("inferred tiers match tierFromName verb tables", () => {
    const names = (manifest.capabilities ?? []).map((c) =>
      typeof c === "string" ? c : c.name,
    );
    const expected: Record<string, string> = {
      "browser.navigate": "act",
      "browser.click": "act",
      "browser.type": "act",
      "browser.scroll": "act",
      "browser.wait": "act",
      "browser.query": "read",
      "browser.tab.open": "act",
      "browser.tab.switch": "act",
    };
    for (const [name, tier] of Object.entries(expected)) {
      expect(names).toContain(name);
      expect(tierFromName(name)).toBe(tier);
    }
  });
});
