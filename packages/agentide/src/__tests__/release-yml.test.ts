/*
 * Code Map: tests for the release.yml workflow structure (drop-cjs-siblings).
 *
 * The publish job must:
 *   - run on tag pushes (v*, *-v*) or workflow_dispatch
 *   - install pnpm, then build the 17 ESM packages, then publish
 *   - have no Mirror CJS step (CJS siblings are gone)
 *   - have no --filter './packages/*-cjs' in build OR publish
 *
 * Drift in this file means either:
 *   - a Mirror CJS step crept back (script is gone; CI breaks)
 *   - a -cjs --filter slipped into the publish list (the publish
 *     command will error trying to build a directory that
 *     doesn't exist)
 *
 * AUTO-SYNC (2026-08-09): CID:release-yml-005 no longer hardcodes a package
 * count — it derives the expected set from .github/release-please-manifest.json
 * (the published set, maintained by release-please itself) and asserts the
 * workflow's build+publish filter is EXACTLY that set (count + full
 * membership). Adding a package to the manifest forces the workflow to match;
 * if a package is added to one side and not the other, this fails with a
 * clear message instead of a mysterious count mismatch. CID:release-yml-006
 * pins config/manifest parity so a package can't be tracked by one but not
 * the other (the dashboard-core gap this suite caught in 2026-08).
 *
 * CID Index:
 * CID:release-yml-001 -> trigger is tag push (v*, *-v*) or workflow_dispatch
 * CID:release-yml-002 -> no "Mirror CJS variants" step
 * CID:release-yml-003 -> no --filter './packages/*-cjs' anywhere
 * CID:release-yml-004 -> build filter list === publish filter list (parity)
 * CID:release-yml-005 -> manifest-derived package set === build+publish filter
 * CID:release-yml-006 -> release-please config keys === manifest keys
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");
const RELEASE_YML = path.resolve(ROOT, ".github/workflows/release.yml");

// The set release-please actually manages (source of truth — release-please
// writes this file on every release). Keys look like "packages/<name>" —>
// the exact names the workflow --filter entries must target.
const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(ROOT, ".github/release-please-manifest.json"), "utf-8")) as Record<string, unknown>;
// Keys look like "packages/<name>" — the exact strings the workflow --filter
// entries target. This is the auto-sync source of truth for CID:release-yml-005.
const EXPECTED_PACKAGES = Object.keys(MANIFEST).sort();

describe("release.yml publish workflow (post-drop-cjs-siblings)", () => {
  const yml = fs.readFileSync(RELEASE_YML, "utf-8");

  it("CID:release-yml-001 — trigger list still pins v* + *-v* tag patterns", () => {
    expect(yml).toMatch(/tags:\s*\n\s*-\s*'v\*'/);
    expect(yml).toMatch(/\-\s*'\*-v\*'/);
  });

  it("CID:release-yml-002 — no 'Mirror CJS variants' step exists", () => {
    expect(yml).not.toContain("Mirror CJS variants");
  });

  it("CID:release-yml-003 — no --filter './packages/*-cjs' anywhere", () => {
    expect(yml).not.toMatch(/--filter '\.\/packages\/[a-z-]+-cjs'/);
  });

  it("CID:release-yml-004 — build filter list === publish filter list (parity)", () => {
    const buildIdx = yml.indexOf("Build all publishable packages");
    const publishIdx = yml.indexOf("Publish to npm");
    expect(buildIdx).toBeGreaterThan(0);
    expect(publishIdx).toBeGreaterThan(0);
    const buildChunk = yml.slice(buildIdx, yml.indexOf("Write .npmrc", buildIdx));
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    const buildFilters = (buildChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? []).sort();
    const publishFilters = (publishChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? []).sort();
    expect(publishFilters).toEqual(buildFilters);
  });

  it("CID:release-yml-005 — manifest-derived package set == workflow filter (auto-synced)", () => {
    const publishIdx = yml.indexOf("Publish to npm");
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    const filters = (publishChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? [])
      .map((f) => f.slice("--filter '".length, -1)) // "--filter './packages/x'" -> "./packages/x"
      .map((p) => p.replace(/^\.\//, "")) // -> "packages/x" (manifest key form)
      .sort();
    // Every manifest package must be filtered — adding to one side without the
    // other fails here with the explicit diff, not a mysterious count mismatch.
    expect(filters).toEqual(EXPECTED_PACKAGES);
  });

  it("CID:release-yml-006 — release-please config keys === manifest package set (config parity)", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, ".github/release-please-config.json"), "utf-8")) as { packages: Record<string, object> };
    // Every package the workflow publishes must be tracked by BOTH release-
    // please files; this caught dashboard-core missing from the config while
    // being published (2026-08).
    expect(Object.keys(config.packages).sort()).toEqual(Object.keys(MANIFEST).sort());
  });
});
