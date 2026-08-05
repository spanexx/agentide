/*
 * Code Map: tests for the release.yml workflow structure.
 *
 * The publish job must:
 *   - run on tag pushes (v*, *-v*) or workflow_dispatch
 *   - mirror CJS versions BEFORE pnpm install (so install sees the new versions)
 *   - build the 14 ESM packages + sdk-node-cjs + event-bus-cjs (Phase 2/3)
 *   - publish the same set (Phase 3)
 *
 * Drift in this file means either the mirror runs after install (CI breaks),
 * or a CJS sibling is missing from the publish filter (the example app
 * can't install the new version), or a step is misnamed.
 *
 * CID Index:
 * CID:cjs-release-yml-001 -> mirror runs before install
 * CID:cjs-release-yml-002 -> build filter includes sdk-node-cjs and event-bus-cjs
 * CID:cjs-release-yml-003 -> publish filter includes sdk-node-cjs and event-bus-cjs
 * CID:cjs-release-yml-004 -> publish filter does NOT include broken CJS siblings
 *                            (sdk-browser-cjs, agentide-cjs — D-75, D-76)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_YML = path.resolve(HERE, "../../../../.github/workflows/release.yml");

interface ReleaseYml {
  jobs: {
    publish: {
      steps: Array<{
        name?: string;
        run?: string;
      }>;
    };
  };
}

describe("release.yml publish workflow", () => {
  const yml = fs.readFileSync(RELEASE_YML, "utf-8");

  it("exists and is non-empty", () => {
    expect(yml.length).toBeGreaterThan(100);
  });

  it("CID:cjs-release-yml-001 — mirror step runs before install step", () => {
    const mirrorIdx = yml.indexOf("Mirror CJS variants");
    const installIdx = yml.indexOf("pnpm install --frozen-lockfile");
    expect(mirrorIdx).toBeGreaterThan(0);
    expect(installIdx).toBeGreaterThan(mirrorIdx);
  });

  it("CID:cjs-release-yml-002 — build step includes sdk-node-cjs and event-bus-cjs", () => {
    // Find the build step (the one with --filter and `build` not `publish`)
    const buildIdx = yml.indexOf("Build all publishable packages");
    expect(buildIdx).toBeGreaterThan(0);
    const buildChunk = yml.slice(buildIdx, yml.indexOf("Write .npmrc", buildIdx));
    expect(buildChunk).toMatch(/packages\/sdk-node-cjs/);
    expect(buildChunk).toMatch(/packages\/event-bus-cjs/);
  });

  it("CID:cjs-release-yml-003 — publish step includes sdk-node-cjs and event-bus-cjs", () => {
    const publishIdx = yml.indexOf("Publish to npm");
    expect(publishIdx).toBeGreaterThan(0);
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    expect(publishChunk).toMatch(/packages\/sdk-node-cjs/);
    expect(publishChunk).toMatch(/packages\/event-bus-cjs/);
  });

  it("CID:cjs-release-yml-004 — broken CJS siblings are NOT in the publish filter", () => {
    // sdk-browser-cjs and agentide-cjs have broken build chains (D-75, D-76).
    // Their publish filters must be absent until the chains are fixed.
    const publishIdx = yml.indexOf("Publish to npm");
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    expect(publishChunk).not.toMatch(/packages\/sdk-browser-cjs/);
    expect(publishChunk).not.toMatch(/packages\/agentide-cjs/);
  });

  it("publish filter is the same list as build filter (parity)", () => {
    const buildIdx = yml.indexOf("Build all publishable packages");
    const publishIdx = yml.indexOf("Publish to npm");
    const buildChunk = yml.slice(buildIdx, yml.indexOf("Write .npmrc", buildIdx));
    const publishChunk = yml.slice(publishIdx, yml.indexOf("Revert prepare-publish", publishIdx));
    const buildFilters = (buildChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? []).sort();
    const publishFilters = (publishChunk.match(/--filter '\.\/packages\/[^']+'/g) ?? []).sort();
    expect(publishFilters).toEqual(buildFilters);
  });
});
