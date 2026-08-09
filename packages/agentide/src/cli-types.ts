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
  // CID:cli-split-002 - pid-file seam (IMPL Phase 2). The live-world
  // "gateway not running" check reads the pid file; tests pass a temp/missing
  // path so the check is deterministic (the real /tmp/agentide.pid may hold
  // a leftover gateway). Defaults to lifecycle's DEFAULT_PID_FILE.
  readonly pidFile?: string;
  // CID:shell-009 - stdin/stdout/env seams (IMPL Phase 5). The shell (bare
  // agentide on a TTY) reads lines from stdin and writes to stdout; tests
  // pass scripted streams. isTTY detection: opts.stdin.isTTY when provided,
  // else process.stdin. env defaults to process.env.
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WritableStream;
  readonly env?: NodeJS.ProcessEnv;
  // CID:shell-009b - cwd seam: the shell dispatches consumer commands from
  // its own directory after `cd`; defaults to process.cwd().
  readonly cwd?: string;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}