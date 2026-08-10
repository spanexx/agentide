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
import { DETACH_CHILD_FLAG } from "./lifecycle.js";
import * as fsPromises from "node:fs/promises";
import { homedir } from "node:os";
import { nodeFileSystem } from "@spanexx/gateway-core";
import type { FileSystem } from "@spanexx/gateway-core";

/**
 * Default FileSystem adapter for the bundled CLI. Reuses gateway-core's
 * nodeFileSystem — the ONE contract-correct implementation (writeFile appends
 * without mode, writes with mode). D-128: the previous inline writeFile used
 * fs.promises.writeFile (TRUNCATES), silently destroying the audit log.
 */
const defaultFs: FileSystem = {
  ...nodeFileSystem(),
  // CID:bin-002 - D-78: recursive mkdir for `agentide init --data-dir <fresh>`.
  mkdir: async (path, options): Promise<void> => { await fsPromises.mkdir(path, { recursive: options?.recursive ?? true }); },
};

/**
 * Strip the internal --detach-child flag from argv before runCli sees it.
 * The flag is a vestigial marker: the actual "you are the gateway child"
 * signal is the AGENTIDE_DETACH_CHILD env var (lifecycle.ts detachChild,
 * checked by runDetachedStart CID:start-013). The argv flag is kept for
 * debuggability but must not reach runCli — cli.ts doesn't recognize it
 * and would error otherwise.
 */
function stripDetachFlag(argv: readonly string[]): string[] {
  return argv.filter((a) => a !== DETACH_CHILD_FLAG);
}

async function main(): Promise<void> {
  const argv = stripDetachFlag(process.argv.slice(2));
  const result = await runCli(argv, {
    fs: defaultFs,
    home: homedir(),
    stdin: process.stdin,
    stdout: process.stdout,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

// CID:bin-001 - main
void main();
