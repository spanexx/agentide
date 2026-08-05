#!/usr/bin/env node
// mirror-cjs-versions.mjs — runs from release.yml's publish job,
// AFTER release-please has opened/merged its Release PR.
//
// Purpose: prevent CJS variants from drifting behind their ESM counterparts.
// release-please's default behavior touches a package only when its scope
// has a release-worthy commit. CJS variants share source with ESM; the
// triggering commit scope is rarely their own. Without this script, CJS
// versions stay stale.
//
// What it does for each ESM↔CJS pair:
//   1. Reads the new ESM version from .github/release-please-manifest.json.
//   2. If CJS package.json version != ESM version, updates CJS package.json.
//   3. Appends a 1-line pointer entry to CJS/CHANGELOG.md (Q23).
//
// Run path: node packages/agentide/scripts/mirror-cjs-versions.mjs
// (no args; paths are relative to the inner monorepo root).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONOREPO_ROOT = resolve(__dirname, "..", "..", "..");

const PAIRS = [
  ["sdk-node", "sdk-node-cjs"],
  ["sdk-browser", "sdk-browser-cjs"],
  ["event-bus", "event-bus-cjs"],
  ["agentide", "agentide-cjs"],
];

const MANIFEST_PATH = resolve(MONOREPO_ROOT, ".github/release-please-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function packageDir(name) {
  return resolve(MONOREPO_ROOT, "packages", name);
}

function readPackageVersion(name) {
  const pkgPath = resolve(packageDir(name), "package.json");
  const pkg = readJson(pkgPath);
  return { pkg, pkgPath };
}

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[mirror-cjs] manifest not found at ${MANIFEST_PATH}`);
    console.error("  release-please hasn't run yet — nothing to do.");
    process.exit(0);
  }

  const manifest = readJson(MANIFEST_PATH);
  let touched = 0;

  for (const [esmName, cjsName] of PAIRS) {
    const esmKey = `packages/${esmName}`;
    const cjsKey = `packages/${cjsName}`;
    const esmVersion = manifest[esmKey]?.version;
    const cjsVersion = manifest[cjsKey]?.version;
    if (!esmVersion) {
      console.warn(`[mirror-cjs] no manifest entry for ${esmKey} — skipping pair (${esmName}, ${cjsName})`);
      continue;
    }

    let { pkg: cjsPkg, pkgPath } = readPackageVersion(cjsName);
    let changed = false;

    if (cjsVersion !== esmVersion) {
      console.log(`[mirror-cjs] ${cjsName}: ${cjsPkg.version} -> ${esmVersion}`);
      cjsPkg.version = esmVersion;
      writeJson(pkgPath, cjsPkg);
      manifest[cjsKey] = { ...manifest[cjsKey], version: esmVersion };
      changed = true;
    } else {
      console.log(`[mirror-cjs] ${cjsName}: already at ${esmVersion}`);
    }

    const changelogPath = resolve(packageDir(cjsName), "CHANGELOG.md");
    const pointerLine = `## ${esmVersion} (mirror of @spanexx/${esmName}@${esmVersion})`;
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, "utf-8") : "";
    if (existing.includes(pointerLine)) {
      console.log(`[mirror-cjs] ${cjsName}: CHANGELOG already has pointer for ${esmVersion}`);
    } else {
      const header = existing.trim() === "" ? `# @spanexx/${cjsName}\n` : "";
      const body = `\n${pointerLine}\n\nMirrors @spanexx/${esmName} — see https://github.com/spanexx/agentide/releases/tag/v${esmVersion}.\n`;
      writeFileSync(changelogPath, header + existing + body, "utf-8");
      console.log(`[mirror-cjs] ${cjsName}: CHANGELOG pointer added for ${esmVersion}`);
      changed = true;
    }

    if (changed) touched += 1;
  }

  writeJson(MANIFEST_PATH, manifest);

  if (touched === 0) {
    console.log("[mirror-cjs] no CJS variants needed mirroring.");
  } else {
    console.log(`[mirror-cjs] ${touched} CJS variant(s) mirrored.`);
  }
}

main();
