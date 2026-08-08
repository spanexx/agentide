// CID:cli-001 - CliOptions
// Purpose: input seam for runCli(); tests pass an in-memory FileSystem; production uses node:fs/promises via createPlatform() defaults.
// discovery/issues: the second argument to runCli is optional — when omitted, we use the node FS seam built into createPlatform().
// Uses: types
// Used by: tests + cli-002 -> runCli
import type { FileSystem } from "@spanexx/gateway-core";

export interface CliOptions {
  readonly fs: FileSystem;
  // CID:cli-013 - home seam for config persistence (D-112). The token-save
  // path writes ~/.config/platform/config.toml; tests pass a temp HOME so
  // the real operator file is never touched. Defaults to os.homedir().
  readonly home?: string;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}