/*
 * Tests for BI[7] permission-tiering tier convention.
 * Covers IMPL Phase 2 Verify checklist (6 items) plus exhaustive lookup.
 */

import { describe, expect, it } from "vitest";
import { ERROR_CODES, PluginManagerError, type PluginManifest } from "../index.js";
import { buildCapabilityRecords } from "../lifecycle-helpers.js";
import { tierFromConvention } from "../tier-convention.js";

function runtimeManifest(capabilities: ReadonlyArray<string>): PluginManifest {
  return {
    runtime: { id: "browser" },
    version: "1.0.0",
    capabilities: [...capabilities],
  };
}

function runtimeManifestWithExplicit(
  entries: ReadonlyArray<{ name: string; tier: "read" | "act" | "destructive" }>,
): PluginManifest {
  return {
    runtime: { id: "browser" },
    version: "1.0.0",
    capabilities: entries.map((e) => ({ name: e.name, tier: e.tier })),
  };
}

describe("tierFromConvention", () => {
  it("maps ACT_VERBS like 'browser.navigate' to 'act'", () => {
    expect(tierFromConvention("browser.navigate")).toBe("act");
  });

  it("maps DESTRUCTIVE_VERBS like 'browser.delete' to 'destructive'", () => {
    expect(tierFromConvention("browser.delete")).toBe("destructive");
  });

  it("returns null for verbs outside the convention lists (e.g. 'browser.screenshot')", () => {
    expect(tierFromConvention("browser.screenshot")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(tierFromConvention("browser.NAVIGATE")).toBe("act");
    expect(tierFromConvention("browser.Delete")).toBe("destructive");
    expect(tierFromConvention("browser.READ")).toBe("read");
  });

  it("handles deeper capability names by looking at the final segment only", () => {
    expect(tierFromConvention("fs.file.read")).toBe("read");
    expect(tierFromConvention("git.branch.delete")).toBe("destructive");
    expect(tierFromConvention("git.commit.commit")).toBe("destructive");
  });

  it("returns null when there is no verb segment", () => {
    expect(tierFromConvention("browser")).toBeNull();
    expect(tierFromConvention("")).toBeNull();
  });

  it("covers every READ_VERBS, ACT_VERBS, DESTRUCTIVE_VERBS entry", () => {
    const readVerbs = ["read", "list", "get", "view", "show", "describe", "fetch", "query", "count", "is", "has"];
    for (const v of readVerbs) {
      expect(tierFromConvention(`ns.${v}`)).toBe("read");
    }
    const actVerbs = [
      "write", "set", "put", "create", "update", "edit", "patch", "append",
      "push", "post", "send", "open", "close", "start", "stop", "restart",
      "pause", "resume", "navigate", "goto", "click", "doubleclick", "hover",
      "type", "press", "select", "scroll", "wait", "upload", "download",
      "run", "exec", "execute", "install", "enable", "disable", "reload",
      "touch", "move", "copy", "rename",
    ];
    for (const v of actVerbs) {
      expect(tierFromConvention(`ns.${v}`)).toBe("act");
    }
    const destructiveVerbs = [
      "delete", "remove", "drop", "destroy", "purge", "wipe", "reset",
      "clear", "truncate", "commit", "merge", "rebase", "checkout",
    ];
    for (const v of destructiveVerbs) {
      expect(tierFromConvention(`ns.${v}`)).toBe("destructive");
    }
    // "push" lives in BOTH ACT_VERBS and DESTRUCTIVE_VERBS. ACT wins
    // because tierFromConvention checks ACT before DESTRUCTIVE.
    expect(tierFromConvention("ns.push")).toBe("act");
  });
});

describe("buildCapabilityRecords (install manifest tier handling)", () => {
  it("registers an explicit tier when the manifest entry is {name, tier}", () => {
    const manifest = runtimeManifestWithExplicit([
      { name: "browser.screenshot", tier: "act" },
    ]);
    const records = buildCapabilityRecords(manifest, "runtime", "plugin:browser");
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toBe("browser.screenshot");
    expect(records[0]!.tier).toBe("act");
  });

  it("explicit tier overrides convention-inferred tier", () => {
    const manifest = runtimeManifestWithExplicit([
      { name: "browser.delete", tier: "act" },
    ]);
    const records = buildCapabilityRecords(manifest, "runtime", "plugin:browser");
    expect(records[0]!.tier).toBe("act");
  });

  it("infers tier from verb when manifest entry is a string", () => {
    const manifest = runtimeManifest(["browser.navigate"]);
    const records = buildCapabilityRecords(manifest, "runtime", "plugin:browser");
    expect(records[0]!.tier).toBe("act");
  });

  it("throws TIER_REQUIRED when verb is unknown and no explicit tier is given", () => {
    const manifest = runtimeManifest(["browser.screenshot"]);
    expect(() => buildCapabilityRecords(manifest, "runtime", "plugin:browser")).toThrow(PluginManagerError);
    try {
      buildCapabilityRecords(manifest, "runtime", "plugin:browser");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginManagerError);
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.TIER_REQUIRED);
    }
  });
});