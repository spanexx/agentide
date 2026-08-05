/*
 * Code Map: tests for the built artifact of @platform/agentide.
 * - start.test.ts and cli.test.ts cover the source (`src/`); this file
 *   covers the *built* artifact (`dist/`). The dev bootstrap script
 *   (`scripts/start-gateway.mjs`) and the published `agentide` binary
 *   both import from `dist/index.js`, so the tests here exercise the
 *   real loading path.
 *
 * Why this file exists: the previous design had `const HELP = ...${CLI_VERSION}...`
 * at the top of cli.ts, which evaluates at module load time. The CLI_VERSION
 * symbol is replaced at define time (esbuild `--define` for the bundled
 * binary, vitest's `define` for tests) — but plain `tsc`-built dist/ has
 * no define, so importing dist/index.js directly from Node crashes with
 * `ReferenceError: CLI_VERSION is not defined`. We test the dist by
 * spawning a real Node child process (NOT through Vite), because Vite's
 * loader would hide the issue. The dist is what `pnpm run gateway` and
 * `npm install -g @spanexx/agentide` actually load.
 *
 * CID Index:
 * CID:dist-001 -> dist/index.js loads in raw Node without ReferenceError
 * CID:dist-002 -> dist resolves runCli(['--version']) to the package version
 * CID:dist-003 -> dist resolves runCli(['--help']) without crashing
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.resolve(HERE, "../../dist/index.js");
const PACKAGE_VERSION = (await import("../../package.json", { with: { type: "json" } })).default.version as string;

function runDist(snippet: string): { stdout: string; stderr: string; status: number | null } {
  const script = `import(${JSON.stringify(DIST_INDEX)}).then((m) => { ${snippet} }).catch((e) => { console.error("FAIL:", e.message); process.exit(1); });`;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf-8" });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe("dist artifact (raw Node, no Vite)", () => {
  it("CID:dist-001 — dist/index.js loads without ReferenceError", () => {
    const r = runDist(`console.log("LOADED: keys=", Object.keys(m).join(","));`);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/CLI_VERSION is not defined/);
    expect(r.stdout).toMatch(/LOADED:.*runCli/);
  });

  it("CID:dist-002 — runCli(['--version']) from dist returns the package version", () => {
    const fsAdapters = `const fs = { exists: async () => true, readFile: async () => "", writeFile: async () => {} };`;
    const r = runDist(`${fsAdapters} m.runCli(["--version"], { fs }).then((res) => { console.log("STDOUT:", JSON.stringify(res.stdout)); console.log("EXIT:", res.exitCode); });`);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/CLI_VERSION is not defined/);
    // The dist version comes from package.json at runtime (the fallback path);
    // JSON.stringify embeds the value as a JSON string, including any trailing
    // newline that runCli emits via result().
    expect(r.stdout).toContain(`STDOUT: "${PACKAGE_VERSION}`);
  });

  it("CID:dist-003 — runCli(['--help']) from dist returns help without ReferenceError", () => {
    const fsAdapters = `const fs = { exists: async () => true, readFile: async () => "", writeFile: async () => {} };`;
    const r = runDist(`${fsAdapters} m.runCli(["--help"], { fs }).then((res) => { console.log("HELP_LEN:", res.stdout.length); console.log("EXIT:", res.exitCode); });`);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/CLI_VERSION is not defined/);
    expect(r.stdout).toMatch(/HELP_LEN: \d+/);
    expect(r.stdout).toMatch(/EXIT: 0/);
  });
});
