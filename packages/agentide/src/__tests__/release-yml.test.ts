/*
 * Code Map: tests for the release.yml workflow structure (drop-cjs-siblings).
 *
 * The publish job must:
 *   - run on tag pushes (v*, *-v*) or workflow_dispatch
 *   - install pnpm, then build the 15 ESM packages, then publish
 *   - have no Mirror CJS step (CJS siblings are gone)
 *   - have no --filter './packages/*-cjs' in build OR publish
 *
 * Drift in this file means either:
 *   - a Mirror CJS step crept back (script is gone; CI breaks)
 *   - a -cjs --filter slipped into the publish list (the publish
 *     command will error trying to build a directory that
 *     doesn't exist)
 *
 * CID Index:
 * CID:release-yml-001 -> trigger is tag push (v*, *-v*) or workflow_dispatch
 * CID:release-yml-002 -> no "Mirror CJS variants" step
 * CID:release-yml-003 -> no --filter './packages/*-cjs' anywhere
 * CID:release-yml-004 -> build filter list === publish filter list (parity)
 * CID:release-yml-005 -> exactly 14 --filter entries
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_YML = path.resolve(HERE, "../../../../.github/workflows/release.yml");

describe("release.yml publish workflow (post-drop-cjs-siblings)", () => {
  const yml = fs.readFileSync(RELEASE_YML, "utf-8");

  it("CID:release-yml-001 — trigger list still pins v* + *-v* tag patterns", () => {
    expect(yml).toMatch(/tags:\s*\n\s*-\s*'v\*'/);
    expect(yml).toMatch(/-\s*'\*-v\*'/);
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

  it("CID:release-yml-005 — exactly 15 ESM packages in the publish filter", () => {
    const publishIdx = yml.indexOf("Publish to npm");
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    const filters = publishChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? [];
    // 14 → 15 after dashboard-core was added in BI[13] (2026-08-06).
    expect(filters.length).toBe(15);
    // spot-check: every ESM published package is present
    for (const pkg of [
      "errors", "event-bus", "origin", "session-manager",
      "capability-registry", "plugin-manager", "backend-runtime",
      "platform-capabilities", "gateway-core", "sdk-node",
      "sdk-browser", "adapter-mcp", "adapter-websocket", "agentide",
    ]) {
      expect(publishChunk).toMatch(new RegExp(`packages/${pkg}\\b`));
    }
  });
});
