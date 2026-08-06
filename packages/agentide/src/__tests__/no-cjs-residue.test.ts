/*
 * Code Map: pin that the four CJS sibling trees + the mirror script
 * chain are gone.
 *
 * The drop-cjs-siblings pack deletes the CJS siblings entirely:
 *
 *   - packages/sdk-node-cjs/    (deleted)
 *   - packages/event-bus-cjs/   (deleted)
 *   - packages/sdk-browser-cjs/ (was broken; deleted)
 *   - packages/agentide-cjs/    (was broken; deleted)
 *   - packages/agentide/scripts/mirror-cjs-versions.mjs (deleted)
 *   - per-package scripts/build.sh files inside the CJS trees
 *     (deleted with their parents)
 *   - mirror-cjs-versions / cjs-mirror-build test files
 *     (deleted because they tested the deleted behavior)
 *
 * These tests pin all four invariants. If any test fails, the
 * drop regressed.
 *
 * CID Index:
 * CID:drop-cjs-residue-001 -> no -cjs workspace trees exist
 * CID:drop-cjs-residue-002 -> mirror-cjs-versions.mjs is gone
 * CID:drop-cjs-residue-003 -> release.yml has no --filter './packages/*-cjs'
 * CID:drop-cjs-residue-004 -> release-please-manifest has no *-cjs entries
 * CID:drop-cjs-residue-005 -> release-please-config has no *-cjs entries
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../packages");

// Packages dir is the first upward point with a "packages" subdir.
// From packages/agentide/src/__tests__/, 4 ups reaches inner repo root.
const PACKAGES_DIR = REPO_ROOT;
const DOCS_WORKFLOWS = path.resolve(HERE, "../../../../.github");
const PACKAGES_AGENTIDE = path.resolve(HERE, "../../../");
void PACKAGES_AGENTIDE;
const AGENTIDE_SCRIPTS = path.resolve(HERE, "../../../scripts");

const CJS_DIRS = ["sdk-node-cjs", "event-bus-cjs", "sdk-browser-cjs", "agentide-cjs"];
const CJS_MANIFEST_KEYS = ["packages/sdk-node-cjs", "packages/event-bus-cjs", "packages/sdk-browser-cjs", "packages/agentide-cjs"];

describe("no CJS residue (drop-cjs-siblings)", () => {
  it("CID:drop-cjs-residue-001 — no -cjs workspace trees exist", () => {
    for (const dir of CJS_DIRS) {
      const p = path.join(PACKAGES_DIR, dir);
      expect(fs.existsSync(p), `expected ${dir} to be deleted`).toBe(false);
    }
  });

  it("CID:drop-cjs-residue-002 — mirror-cjs-versions.mjs is gone", () => {
    const p = path.join(AGENTIDE_SCRIPTS, "mirror-cjs-versions.mjs");
    expect(fs.existsSync(p), "mirror-cjs-versions.mjs must be deleted").toBe(false);
  });

  it("CID:drop-cjs-residue-003 — release.yml has no --filter './packages/*-cjs'", () => {
    const p = path.join(DOCS_WORKFLOWS, "workflows/release.yml");
    const txt = fs.readFileSync(p, "utf-8");
    expect(txt, "release.yml must not have -cjs --filter entries").not.toMatch(/--filter '\.\/packages\/[a-z-]+-cjs'/);
  });

  it("CID:drop-cjs-residue-004 — release-please-manifest has no *-cjs entries", () => {
    const p = path.join(DOCS_WORKFLOWS, "release-please-manifest.json");
    const txt = fs.readFileSync(p, "utf-8");
    for (const key of CJS_MANIFEST_KEYS) {
      expect(txt, `manifest must not contain ${key}`).not.toContain(`"${key}":`);
    }
  });

  it("CID:drop-cjs-residue-005 — release-please-config has no *-cjs entries", () => {
    const p = path.join(DOCS_WORKFLOWS, "release-please-config.json");
    const txt = fs.readFileSync(p, "utf-8");
    for (const key of CJS_MANIFEST_KEYS) {
      expect(txt, `config must not contain ${key}`).not.toContain(`"${key}":`);
    }
  });
});
