/*
 * Code Map: tests for mirror-cjs-versions.mjs.
 *
 * The script runs in release.yml's publish job to keep CJS variants
 * aligned with their ESM counterparts. It reads the release-please
 * manifest (flat string form: `{ "packages/sdk-node": "0.1.0" }`),
 * and for each ESM↔CJS pair:
 *   - bumps the CJS package.json version to the ESM version
 *   - mirrors the manifest entry
 *   - appends a CHANGELOG.md pointer
 *
 * The script accepts `AGENTIDE_REPO_ROOT` env var so a fixtures dir
 * can be used in tests.
 *
 * CID Index:
 * CID:cjs-mirror-001 -> bumps CJS package.json to ESM version
 * CID:cjs-mirror-002 -> updates manifest in flat-string form
 * CID:cjs-mirror-003 -> idempotent (no change when already aligned)
 * CID:cjs-mirror-004 -> CHANGELOG pointer line written
 * CID:cjs-mirror-005 -> skips pairs whose ESM entry is missing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const SCRIPT = path.resolve(REPO_ROOT, "packages/agentide/scripts/mirror-cjs-versions.mjs");

function setupFixtures(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-cjs-"));
  const githubDir = path.join(root, ".github");
  fs.mkdirSync(githubDir, { recursive: true });
  const packagesDir = path.join(root, "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  // .github/release-please-manifest.json (flat string form)
  fs.writeFileSync(
    path.join(githubDir, "release-please-manifest.json"),
    JSON.stringify({
      "packages/sdk-node": "0.1.0",
      "packages/sdk-node-cjs": "0.0.1",
      "packages/event-bus": "0.1.0",
      "packages/event-bus-cjs": "0.0.1",
      "packages/sdk-browser": "0.1.0",
      "packages/agentide": "0.1.0",
    }, null, 2) + "\n",
    "utf-8",
  );

  // packages/<name>/package.json for each pair
  const pairDefs: Array<[string, string, string]> = [
    ["sdk-node", "sdk-node-cjs", "0.0.1"],
    ["event-bus", "event-bus-cjs", "0.0.1"],
    ["sdk-browser", "sdk-browser-cjs", "0.0.1"],
    ["agentide", "agentide-cjs", "0.0.3"],
  ];
  for (const [esmName, cjsName, cjsVersion] of pairDefs) {
    fs.mkdirSync(path.join(packagesDir, esmName), { recursive: true });
    fs.writeFileSync(
      path.join(packagesDir, esmName, "package.json"),
      JSON.stringify({ name: `@spanexx/${esmName}`, version: "0.1.0" }, null, 2) + "\n",
      "utf-8",
    );
    fs.mkdirSync(path.join(packagesDir, cjsName), { recursive: true });
    fs.writeFileSync(
      path.join(packagesDir, cjsName, "package.json"),
      JSON.stringify({ name: `@spanexx/${cjsName}`, version: cjsVersion }, null, 2) + "\n",
      "utf-8",
    );
  }
  return root;
}

function runMirror(root: string): { stdout: string; stderr: string; status: number | null } {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf-8",
    env: { ...process.env, AGENTIDE_REPO_ROOT: root },
  });
}

function readJson(p: string): { version: string } {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as { version: string };
}

describe("mirror-cjs-versions.mjs", () => {
  let root: string;

  beforeEach(() => {
    root = setupFixtures();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("CID:cjs-mirror-001 — bumps CJS package.json versions to ESM versions", () => {
    const r = runMirror(root);
    expect(r.status).toBe(0);
    expect(readJson(path.join(root, "packages/sdk-node-cjs/package.json")).version).toBe("0.1.0");
    expect(readJson(path.join(root, "packages/event-bus-cjs/package.json")).version).toBe("0.1.0");
    expect(readJson(path.join(root, "packages/sdk-browser-cjs/package.json")).version).toBe("0.1.0");
    expect(readJson(path.join(root, "packages/agentide-cjs/package.json")).version).toBe("0.1.0");
  });

  it("CID:cjs-mirror-002 — updates manifest in flat-string form", () => {
    runMirror(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".github/release-please-manifest.json"), "utf-8")) as Record<string, string>;
    expect(manifest["packages/sdk-node-cjs"]).toBe("0.1.0");
    expect(manifest["packages/event-bus-cjs"]).toBe("0.1.0");
    expect(manifest["packages/sdk-browser-cjs"]).toBe("0.1.0");
    expect(manifest["packages/agentide-cjs"]).toBe("0.1.0");
  });

  it("CID:cjs-mirror-003 — idempotent: re-running changes nothing", () => {
    const r1 = runMirror(root);
    expect(r1.status).toBe(0);
    const r2 = runMirror(root);
    expect(r2.status).toBe(0);
    // Second run should report "already at" for all packages
    expect(r2.stdout).toMatch(/sdk-node-cjs: already at 0\.1\.0/);
    expect(r2.stdout).toMatch(/event-bus-cjs: already at 0\.1\.0/);
    expect(r2.stdout).toMatch(/agentide-cjs: already at 0\.1\.0/);
  });

  it("CID:cjs-mirror-004 — writes CHANGELOG pointer for each CJS package", () => {
    runMirror(root);
    const changelog = fs.readFileSync(path.join(root, "packages/sdk-node-cjs/CHANGELOG.md"), "utf-8");
    expect(changelog).toMatch(/^# @spanexx\/sdk-node-cjs/);
    expect(changelog).toMatch(/## 0\.1\.0 \(mirror of @spanexx\/sdk-node@0\.1\.0\)/);
    expect(changelog).toMatch(/https:\/\/github\.com\/spanexx\/agentide\/releases\/tag\/v0\.1\.0/);
  });

  it("CID:cjs-mirror-005 — skips pairs whose ESM entry is missing", () => {
    const manifestPath = path.join(root, ".github/release-please-manifest.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, string>;
    delete m["packages/sdk-browser"];
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf-8");
    const r = runMirror(root);
    expect(r.status).toBe(0);
    // The script emits the skip message via console.warn (stderr).
    expect(r.stderr).toMatch(/no manifest entry for packages\/sdk-browser — skipping pair \(sdk-browser, sdk-browser-cjs\)/);
    // sdk-browser-cjs version should NOT be touched
    expect(readJson(path.join(root, "packages/sdk-browser-cjs/package.json")).version).toBe("0.0.1");
  });
});
