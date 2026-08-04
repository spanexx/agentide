// CID:cli-001 - CliOptions
// Purpose: input seam for runCli(); tests pass an in-memory FileSystem; production uses node:fs/promises via createPlatform() defaults.
// discovery/issues: the second argument to runCli is optional — when omitted, we use the node FS seam built into createPlatform().
// Uses: types
// Used by: tests + cli-002 -> runCli
import type { FileSystem } from "@spanexx/gateway-core";

export interface CliOptions {
  readonly fs: FileSystem;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}