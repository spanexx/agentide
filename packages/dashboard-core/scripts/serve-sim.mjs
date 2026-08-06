#!/usr/bin/env node
/*
 * serve-sim.mjs — local server for the dashboard-core post-impl simulation.
 *
 * Bundles docs/features/dashboard-core/simulate.ts with esbuild (browser
 * IIFE), copies the served HTML + assets dir into a tmp dir, and serves
 * everything on a free port. The operator opens the printed URL, pastes
 * a dashboard-bot token, and watches S1-S11 run live against their real
 * adapter-websocket.
 *
 * Usage:
 *   pnpm --filter @spanexx/dashboard-core sim
 *   # or:  node packages/dashboard-core/scripts/serve-sim.mjs
 *
 * Env (optional):
 *   SIM_PORT     — preferred port (default: OS-assigned)
 *   SIM_GATEWAY  — ws:// URL injected into the page (?gateway= override)
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/ is at packages/dashboard-core/scripts/, so REPO_ROOT is two levels up
// from __dirname, then add ".." once more (the script lives inside packages/).
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SIM_DIR = join(REPO_ROOT, "docs", "features", "dashboard-core");

// Step 1: bundle simulate.ts into a browser IIFE that lives next to the
// HTML page. Output goes to a temp dir we serve from.
const stageDir = join(tmpdir(), `ag-sim-dashboard-${Date.now()}`);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

console.log("[sim] bundling simulate.ts ...");
try {
  // esbuild's CLI is the native `bin/esbuild` (Go binary); the JS lib in
  // lib/main.js is the API. Invoke the CLI directly.
  const esbuildBin = join(REPO_ROOT, "node_modules", ".pnpm", "esbuild@0.28.1", "node_modules", "esbuild", "bin", "esbuild");
  execSync(
    `${JSON.stringify(esbuildBin)} ` +
      `${JSON.stringify(join(SIM_DIR, "simulate.ts"))} ` +
      `--bundle --platform=browser --target=es2022 --format=iife --sourcemap ` +
      `--outfile=${JSON.stringify(join(stageDir, "simulate.js"))}`,
    { stdio: "inherit", cwd: REPO_ROOT },
  );
} catch (err) {
  console.error("[sim] esbuild failed:", err.message);
  process.exit(1);
}

// Step 2: copy the page shell + dashboard assets.
function copyDir(src, dst) {
  execSync(`cp -R -- "${src}/." "${dst}/"`, { stdio: "inherit" });
}
mkdirSync(join(stageDir, "assets"), { recursive: true });
copyDir(join(REPO_ROOT, "packages/dashboard-core/src/assets"), join(stageDir, "assets"));
// Also copy the HTML and rewrite the script src to ./simulate.js.
const html = readFileSync(join(SIM_DIR, "simulate.html"), "utf8")
  .replace("/assets/app.js", "./assets/app.js") // serve-relative
  .replace("./simulate.js", "./simulate.js");
writeFileSync(join(stageDir, "simulate.html"), html);
console.log("[sim] staged at", stageDir);

// Step 3: serve over HTTP. Pick a port (env SIM_PORT or OS-assigned).
const preferredPort = Number.parseInt(process.env.SIM_PORT ?? "0", 10);
const server = createServer(async (req, res) => {
  // Reshape URL to stage dir.
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${preferredPort || 0}`);
  const fs = await import("node:fs/promises");
  let filePath = join(stageDir, url.pathname === "/" ? "/simulate.html" : url.pathname);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = filePath.split(".").pop() ?? "";
  const ct = ext === "html" ? "text/html; charset=utf-8"
    : ext === "js" ? "application/javascript"
    : ext === "css" ? "text/css"
    : "text/plain";
  res.writeHead(200, { "content-type": ct });
  res.end(await fs.readFile(filePath));
});

server.listen(preferredPort || 0, "127.0.0.1", () => {
  const { port } = server.address();
  const gw = process.env.SIM_GATEWAY ?? "ws://127.0.0.1:7300/ws";
  console.log(`\n  >>>  http://127.0.0.1:${port}/simulate.html?gateway=${gw}  <<<\n`);
  console.log("  Paste a dashboard-bot token in the prompt.");
  console.log("  Mint one with: agentide token issue --caller sim --scope platform.dashboard.read --origin http://127.0.0.1:7200");
});