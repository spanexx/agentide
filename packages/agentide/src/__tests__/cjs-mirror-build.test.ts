/*
 * Code Map: tests for the CJS mirror build.sh scripts.
 *
 * Each CJS mirror (sdk-node-cjs, event-bus-cjs, sdk-browser-cjs,
 * agentide-cjs) has a scripts/build.sh that:
 *   1. Copies the ESM source from packages/<esm>/src → packages/<cjs>/src
 *   2. Strips `.js` extensions from relative imports (CJS doesn't need them)
 *   3. Rewrites `@spanexx/event-bus` imports to `@spanexx/event-bus-cjs`
 *   4. Compiles the resulting TS source to CJS via `tsc`
 *
 * The example app depends on the CJS siblings, so when the ESM SDK
 * changes (e.g. a new protocol), the CJS mirror must be re-mirrored
 * before publish. These tests pin the contract: the mirror preserves
 * the source, the rewrites are correct, and the resulting dist exports
 * the same surface as the ESM source.
 *
 * CID Index:
 * CID:cjs-mirror-build-001 -> source is copied from packages/<esm>/src
 * CID:cjs-mirror-build-002 -> relative ".js" imports get stripped
 * CID:cjs-mirror-build-003 -> @spanexx/event-bus rewrites to -cjs variant
 * CID:cjs-mirror-build-004 -> dist exports match ESM source (parity)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface MirrorFixture {
  root: string;
  esmPackage: string;
  cjsPackage: string;
  esmName: string;
  cjsName: string;
}

function setupFixture(esmName: string, cjsName: string, buildSrc: string): MirrorFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-mirror-"));
  // Top-level repo structure: {root}/packages/<esm>/src + {root}/packages/<cjs>/scripts/build.sh
  const esmDir = path.join(root, "packages", esmName);
  const cjsDir = path.join(root, "packages", cjsName);
  fs.mkdirSync(path.join(esmDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(cjsDir, "scripts"), { recursive: true });

  // Create the ESM source (a tiny with-event-bus SDK)
  fs.writeFileSync(
    path.join(esmDir, "src", "index.ts"),
    `import { SdkEventPublisher } from "@spanexx/event-bus";\n` +
    `export function createSdk() { return new SdkEventPublisher(); }\n` +
    `export { SdkEventPublisher };\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(esmDir, "package.json"),
    JSON.stringify({ name: `@spanexx/${esmName}`, version: "0.1.0", main: "dist/index.js" }, null, 2) + "\n",
    "utf-8",
  );

  // Create the CJS mirror build.sh (modeled on the real one)
  fs.writeFileSync(path.join(cjsDir, "scripts", "build.sh"), buildSrc, { mode: 0o755 });

  // Create the CJS package.json with @spanexx/event-bus-cjs dep
  fs.writeFileSync(
    path.join(cjsDir, "package.json"),
    JSON.stringify({
      name: `@spanexx/${cjsName}`,
      version: "0.1.0",
      main: "dist/index.js",
      dependencies: { "@spanexx/event-bus-cjs": "^0.1.0" },
    }, null, 2) + "\n",
    "utf-8",
  );

  // CJS tsconfig that compiles to CommonJS
  fs.writeFileSync(
    path.join(cjsDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        target: "ES2022",
        outDir: "./dist",
        strict: false,
        esModuleInterop: true,
        declaration: true,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    }, null, 2) + "\n",
    "utf-8",
  );

  // Stub @spanexx/event-bus-cjs so the CJS code can resolve it during tsc.
  fs.mkdirSync(path.join(cjsDir, "node_modules", "@spanexx", "event-bus-cjs"), { recursive: true });
  fs.writeFileSync(
    path.join(cjsDir, "node_modules", "@spanexx", "event-bus-cjs", "package.json"),
    JSON.stringify({ name: "@spanexx/event-bus-cjs", version: "0.1.0", main: "index.js" }, null, 2) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(cjsDir, "node_modules", "@spanexx", "event-bus-cjs", "index.d.ts"),
    `export class SdkEventPublisher {}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(cjsDir, "node_modules", "@spanexx", "event-bus-cjs", "index.js"),
    `class SdkEventPublisher {}\nmodule.exports = { SdkEventPublisher };\n`,
    "utf-8",
  );

  return { root, esmPackage: esmDir, cjsPackage: cjsDir, esmName, cjsName };
}

const STANDARD_BUILD_SH = `#!/usr/bin/env bash
# Mirror ESM source from sibling package, rewrite imports, compile to CJS.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ESM_NAME="\${ESM_NAME:?ESM_NAME env var required (e.g. sdk-node)}"
SRC_ESM="$HERE/../$ESM_NAME/src"
DEST="$HERE/src"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC_ESM/." "$DEST/"
find "$DEST" -name '*.ts' -exec sed -i 's|from "\\(\\.[^"]*\\)\\.js"|from "\\1"|g' {} +
find "$DEST" -name '*.ts' -exec sed -i 's|"@spanexx/event-bus"|"@spanexx/event-bus-cjs"|g' {} +
cd "$HERE"
# Use the tsc on PATH (set by the test fixture to repo's node_modules/.bin).
# In production, pnpm puts tsc on PATH automatically.
tsc -p tsconfig.json
`;

function runMirrorBuild(fx: MirrorFixture): { stdout: string; stderr: string; status: number | null } {
  // The agentide monorepo has tsc in its root node_modules/.bin. The test
  // fixtures live in a temp dir, so npx wouldn't find it. Use pnpm exec
  // from the repo root to get the right tsc, OR install tsc locally in the
  // fixture. The simplest path: prepend the repo's node_modules/.bin to PATH.
  const repoBin = path.resolve(import.meta.dirname, "../../../../node_modules/.bin");
  return spawnSync("bash", [path.join(fx.cjsPackage, "scripts/build.sh")], {
    cwd: fx.cjsPackage,
    encoding: "utf-8",
    env: {
      ...process.env,
      ESM_NAME: fx.esmName,
      PATH: `${repoBin}:${process.env.PATH ?? ""}`,
    },
  });
}

describe("CJS mirror build.sh", () => {
  describe("sdk-node-cjs mirror", () => {
    let fx: MirrorFixture;

    beforeEach(() => {
      fx = setupFixture("sdk-node", "sdk-node-cjs", STANDARD_BUILD_SH);
    });

    afterEach(() => {
      fs.rmSync(fx.root, { recursive: true, force: true });
    });

    it("CID:cjs-mirror-build-001 — copies source from packages/<esm>/src", () => {
      const r = runMirrorBuild(fx);
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(fx.cjsPackage, "src/index.ts"))).toBe(true);
      const content = fs.readFileSync(path.join(fx.cjsPackage, "src/index.ts"), "utf-8");
      expect(content).toMatch(/createSdk/);
    });

    it("CID:cjs-mirror-build-003 — rewrites @spanexx/event-bus to -cjs variant", () => {
      const r = runMirrorBuild(fx);
      expect(r.status).toBe(0);
      const content = fs.readFileSync(path.join(fx.cjsPackage, "src/index.ts"), "utf-8");
      expect(content).toMatch(/@spanexx\/event-bus-cjs/);
      expect(content).not.toMatch(/@spanexx\/event-bus"/);
    });

    it("CID:cjs-mirror-build-004 — produces dist with CJS exports", () => {
      const r = runMirrorBuild(fx);
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(fx.cjsPackage, "dist/index.js"))).toBe(true);
      const distContent = fs.readFileSync(path.join(fx.cjsPackage, "dist/index.js"), "utf-8");
      // CJS exports land in the module.exports object
      expect(distContent).toMatch(/createSdk/);
      expect(distContent).toMatch(/SdkEventPublisher/);
    });
  });

  describe("relative import .js stripping", () => {
    let fx: MirrorFixture;

    beforeEach(() => {
      fx = setupFixture("sdk-node", "sdk-node-cjs", STANDARD_BUILD_SH);
    });

    afterEach(() => {
      fs.rmSync(fx.root, { recursive: true, force: true });
    });

    it("CID:cjs-mirror-build-002 — strips .js from relative imports", () => {
      // Plant an ESM source with a relative .js import
      fs.writeFileSync(
        path.join(fx.esmPackage, "src", "index.ts"),
        `export { createSdk } from "./client.js";\n`,
        "utf-8",
      );
      const r = runMirrorBuild(fx);
      // The script's tsc step will fail because the fixture doesn't have a
      // client.ts to resolve (that would be a separate test for the
      // package as a whole). What we care about here is the source-level
      // .js stripping, which happens BEFORE the tsc step. Verify the
      // rewritten source regardless of the build's exit code.
      const content = fs.readFileSync(path.join(fx.cjsPackage, "src/index.ts"), "utf-8");
      expect(content).toMatch(/from "\.\/client"/);
      expect(content).not.toMatch(/from "\.\/client\.js"/);
      // The script SHOULD have completed the source-mirror phase (the
      // cp + sed steps) before the tsc step. The cjs-mirror-build-001
      // test verifies the full happy path.
      expect(r.status).toBeDefined();
    });
  });
});
