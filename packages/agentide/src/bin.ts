/*
 * Code Map: CLI binary entry point.
 * - runCli runs in-process; we surface stdout/stderr and exit with the
 *   result.exitCode so `npm install -g @spanexx/agentide && agentide <cmd>`
 *   behaves like a normal CLI tool.
 * - This file is the bundling root for esbuild (src/cli.ts is a library
 *   export; bin.ts is the side-effect-only entry).
 * - The bundled output is dist/bin.bundled.js with a #!/usr/bin/env node
 *   shebang so it works as a Unix executable too.
 *
 * CID Index:
 * CID:bin-001 -> main(): invokes runCli and exits with the right code.
 *
 * Quick lookup: rg -n "CID:bin-" packages/agentide/src/bin.ts
 */

import { runCli } from "./cli.js";
import * as fsPromises from "node:fs/promises";
import type { FileSystem } from "@spanexx/gateway-core";

/**
 * Default FileSystem adapter for the bundled CLI. createGateway has its own
 * internal fallback for in-process commands; this is passed for cli.ts's
 * pre-gateway checks (e.g. checking tenants.json existence in runStart).
 */
const defaultFs: FileSystem = {
  readFile: (path) => fsPromises.readFile(path, "utf8"),
  writeFile: (path, content, mode) => fsPromises.writeFile(path, content, { encoding: "utf8", mode }),
  exists: async (path) => {
    try { await fsPromises.access(path); return true; } catch { return false; }
  },
};

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), { fs: defaultFs });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

// CID:bin-001 - main
void main();
