// CID:data-dir-003 - global data-dir resolver (surgical change 2026-08-09)
// Purpose: ONE function resolves the ambient data dir for the CLI and the
//   shell (previously duplicated in cli.ts + shell.ts with "./.agentide/data").
//   Priority: --data-dir flag > AGENTIDE_DATA_DIR env > config file
//   (data_dir = "repo" | "global") > default "global".
//
// Global = per-repo isolation WITHOUT polluting the repo: each git root gets
//   a stable key (sha256 of the repo root path, first 12 hex) and its state
//   lives under <home>/.local/share/agentide/<key>/data. No git root → the
//   cwd itself is the key (scratch dirs stay isolated from each other).
//   "repo" mode restores the legacy per-directory ./.agentide/data.
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { parseArgs } from "./cli-utils.js";
import { readDataDirSetting } from "./config.js";

function flagValue(flags: Record<string, string | boolean | string[]>): string | undefined {
  const v = flags["data-dir"];
  return typeof v === "string" ? v : undefined;
}

// CID:data-dir-004 - repoRoot: nearest ancestor (cwd included) that contains
//   a .git entry (dir, file for worktrees/submodules). null outside any repo.
export async function repoRoot(start: string): Promise<string | null> {
  let cur = resolve(start);
  for (;;) {
    try {
      await access(join(cur, ".git"));
      return cur;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// CID:data-dir-005 - repoKey: stable short hash of the repo root (or cwd when
//   not in a repo). Same repo from any subdirectory → same key; two repos →
//   different keys.
export async function repoKey(start: string): Promise<string> {
  const root = await repoRoot(start);
  return createHash("sha256").update(root ?? resolve(start)).digest("hex").slice(0, 12);
}

export interface DataDirOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly configOverride?: string;
}

// CID:data-dir-006 - the single resolution point (see header). Async: repo
//   detection + config read are filesystem probes (cheap, best-effort).
export async function defaultDataDir(cwd: string, opts: DataDirOptions): Promise<string> {
  const flag = flagValue(parseArgs(opts.argv).flags);
  if (flag !== undefined && flag !== "") return resolve(cwd, flag);
  const envVal = opts.env["AGENTIDE_DATA_DIR"];
  if (envVal !== undefined && envVal !== "") return resolve(cwd, envVal);
  const mode = readDataDirSetting({ home: opts.home, cwd: opts.cwd ?? process.cwd(), configOverride: opts.configOverride });
  if (mode === "repo") return resolve(cwd, ".agentide/data");
  // default: the shared per-repo store
  const key = await repoKey(cwd);
  return join(opts.home, ".local", "share", "agentide", key, "data");
}