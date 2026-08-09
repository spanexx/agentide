// CID:shell-001 - interactive shell (IMPL Phase 5, PRD-TRD S1/S7/S8)
// Purpose: bare `agentide` on a TTY opens this readline loop. Each line is
//   one argv array dispatched through the same tree dispatcher as one-shot
//   commands (dispatchTokens in cli.ts) — shell and one-shot share 100% of
//   the command surface. Mirrors the user-approved pre-impl sim
//   (simulate-pre.sh) for: prompt `agentide (<dataDir>)> `, prefix tolerance
//   (`agentide gateway status` works; bare `agentide` is a friendly message),
//   per-directory history (shell-history next to the data dir), Tab
//   completion (tree words + tenant names from tenants.json — no live
//   round-trip, no filesystem paths, per PRD-TRD S7 locks), Ctrl-C clears
//   the line (does not exit), Ctrl-D/EOF exits.
// Risk Note 2 resolution: tenants complete from <dataDir>/tenants.json (the
//   real store — the sim's tenants.txt was sim-only). Capability names have
//   NO disk artifact in v1, so completion is tree-only for them; state-name
//   completion arrives with the artifact that ships them.
import { createInterface } from "node:readline";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as os from "node:os";
import type { CliOptions, CliResult } from "./cli-types.js";
import { dispatchTokens } from "./dispatcher.js";
import { GROUPS } from "./cli-tree.js";
import { defaultDataDir } from "./data-dir.js";
import { tokenizeArgs } from "./cli-utils.js";

export interface ShellIO {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

const HISTORY_FILE = "shell-history";
const BUILTINS = ["help", "exit", "quit", "history", "pwd", "cd", "clear"];
const TOP_LEVEL = ["init", "invoke", "watch"];

// CID:shell-002 - dataDir comes from the ONE resolver (data-dir.ts, surgical
//   change 2026-08-09): flag > env > config (repo|global) > global per-repo
//   store. Re-resolved after `cd` so switching repos switches the store; the
//   legacy per-directory ./.agentide/data is the opt-in "repo" mode.
async function resolveDataDir(cwd: string, env: NodeJS.ProcessEnv, home?: string): Promise<string> {
  return await defaultDataDir(cwd, { env, home: home ?? os.homedir(), argv: [] });
}

// CID:shell-003 - history file: <dataDir>/shell-history, one command per
//   line, consecutive dedupe (PRD-TRD S8). Loaded at shell start + after
//   `cd`; appended per line. Best-effort: a read/write failure never kills
//   the shell.
async function loadHistory(dataDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(dataDir, HISTORY_FILE), "utf8");
    return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function appendHistory(dataDir: string, line: string): Promise<void> {
  try {
    const h = await loadHistory(dataDir);
    if (h.length > 0 && h[h.length - 1] === line) return; // consecutive dedupe
    await mkdir(dataDir, { recursive: true });
    await appendFile(join(dataDir, HISTORY_FILE), `${line}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

// CID:shell-004 - tenant names for completion (PRD-TRD S7). Real source is
//   <dataDir>/tenants.json — the store the gateway persists (Risk Note 2).
async function tenantNames(dataDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(dataDir, "tenants.json"), "utf8");
    // Tenant ids are strings in the persisted store (factory.ts tenantsPath).
    const tenants = JSON.parse(raw) as Array<{ id?: string }>;
    return tenants.map((t) => String(t?.id ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

// CID:shell-005 - readline completer (PRD-TRD S7). Completes the CURRENT
//   word only, from: builtins + top-level + group names (position 0), a
//   group's subcommands (position 1), tenant ids after `tenant delete|suspend`
//   (position 2). No live round-trip, no filesystem paths (S7 locks).
export function makeCompleter(dataDir: string) {
  return async (line: string): Promise<[string[], string]> => {
    const words = line.split(/\s+/).filter(Boolean);
    const current = words[words.length - 1] ?? "";
    let candidates: string[] = [];
    if (words.length <= 1) {
      candidates = [...BUILTINS, ...TOP_LEVEL, ...Object.keys(GROUPS)];
    } else if (words.length === 2) {
      const g = GROUPS[words[0]!];
      if (g !== undefined) candidates = Object.keys(g.subs);
    } else if (words.length === 3 && words[0] === "tenant" && (words[1] === "delete" || words[1] === "suspend")) {
      candidates = await tenantNames(dataDir);
    }
    const matches = [...new Set(candidates)].filter((w) => w !== "" && w.startsWith(current) && w !== current);
    return [matches, current];
  };
}

function shellHelp(): string {
  return `agentide interactive shell

Commands:
  help                    this text
  exit | quit             leave the shell
  history                 show this directory's command history
  pwd                     print the working directory
  cd <dir>                switch the shell's data-dir context (reloads history)
  clear                   clear the screen

Everything else is an agentide command — the tree surface, exactly as one-shot:
  ${[...TOP_LEVEL, ...Object.keys(GROUPS)].join(", ")}

The binary prefix is tolerated: 'agentide gateway status' works here too.
Tab completes commands, subcommands and tenant ids (no live round-trip).
`;
}

function shellBanner(): string {
  return "agentide interactive shell — type 'help', Tab to complete, exit to quit\n";
}

// CID:shell-006 - runShell: the interactive loop. One line in, one dispatch
//   through dispatchTokens (same dispatcher as one-shot). Returns a CliResult
//   (exit 0 on exit/quit; Ctrl-D/EOF also exits 0).
export async function runShell(
  cwd: string,
  opts: CliOptions,
  io?: ShellIO,
): Promise<CliResult> {
  const input = io?.input ?? process.stdin;
  const output = io?.output ?? process.stdout;
  const env = opts.env ?? process.env;
  // CID:shell-012 - the shell runs IN its cwd (like the sim): `pwd` and `cd`
  // are relative to it, and dataDir re-resolves from it. For the real CLI
  // this is a no-op (process.cwd() already); tests pass a temp dir.
  process.chdir(cwd);
  const write = (text: string): void => { output.write(text); };

  // CID:shell-013 - process-level SIGINT no-op (D-120, surgical 2026-08-09).
  // readline's own SIGINT listener is rl-scoped: while a dispatched command
  // runs (e.g. watch), its once() SIGINT handler fires on the first Ctrl-C
  // and detaches — a SECOND Ctrl-C would then hit the process default and
  // kill the whole shell. A shell-lifetime process listener keeps the S8
  // semantics (Ctrl-C clears the line, never exits) no matter the command.
  const keepAlive = (): void => {};
  process.on("SIGINT", keepAlive);
  try {
    return await shellLoop(cwd, opts, env, input, output, write);
  } finally {
    process.removeListener("SIGINT", keepAlive);
  }
}

async function shellLoop(
  cwd: string,
  opts: CliOptions,
  env: NodeJS.ProcessEnv,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  write: (t: string) => void,
): Promise<CliResult> {
  let dataDir = await resolveDataDir(cwd, env, opts.home);

  for (;;) {
    const history = await loadHistory(dataDir);
    const rl = createInterface({
      input,
      output,
      prompt: `agentide (${dataDir})> `,
      history,
      historySize: 1000,
      completer: makeCompleter(dataDir),
    });

    // CID:shell-007 - Ctrl-C clears the line, does NOT exit (PRD-TRD S8).
    // The no-op listener keeps readline alive; readline itself redraws the
    // cleared line. Ctrl-D / EOF ends the async iteration → exit.
    rl.on("SIGINT", () => {});
    write(shellBanner());

    let restart = false;
    rl.prompt();
    // CID:shell-011 - async iteration: each line is FULLY processed before
    // the next is read (no close-vs-handler race on scripted input).
    for await (const rawLine of rl) {
      const outcome = await processLine(rawLine, { opts, env, dataDir, home: opts.home ?? os.homedir(), write });
      if (outcome === "exit") break;
      if (outcome === "restart") {
        restart = true;
        break;
      }
      rl.prompt();
    }
    rl.close();
    if (!restart) break;
    // restart after `cd`: dataDir re-resolves from the NEW cwd (S1/S8).
    // Scripted input (tests, pipes) may already be exhausted — a restart
    // over an ended stream would hang the for-await, so exit instead.
    if ((input as { readableEnded?: boolean }).readableEnded === true) break;
    dataDir = await resolveDataDir(process.cwd(), env, opts.home);
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

type LineOutcome = "continue" | "exit" | "restart";

async function processLine(
  rawLine: string,
  ctx: { opts: CliOptions; env: NodeJS.ProcessEnv; dataDir: string; home: string; write: (t: string) => void },
): Promise<LineOutcome> {
  const { opts, env, dataDir, write } = ctx;
  const line = rawLine.trim();
  if (line === "") return "continue";
  // CID:shell-008 - prefix tolerance (PRD-TRD S8): 'agentide gateway status'
  // works; bare 'agentide' gets the friendly message.
  const stripped = line.startsWith("agentide ") ? line.slice("agentide ".length) : line;
  if (stripped === "agentide") {
    write("(you are already in the agentide shell — type help)\n");
    return "continue";
  }
  await appendHistory(dataDir, stripped);
  let argv: string[];
  try {
    argv = tokenizeArgs(stripped);
  } catch (err) {
    write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return "continue";
  }
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "exit":
    case "quit":
    case "q":
      return "exit";
    case "help":
      write(shellHelp());
      return "continue";
    case "clear":
      write("\x1b[2J\x1b[H");
      return "continue";
    case "pwd":
      write(`${process.cwd()}\n`);
      return "continue";
    case "history": {
      const h = await loadHistory(dataDir);
      write(h.map((l, i) => `  ${i + 1}  ${l}`).join("\n") + (h.length > 0 ? "\n" : "(empty)\n"));
      return "continue";
    }
    case "cd": {
      const target = rest[0];
      if (target === undefined) return "continue";
      try {
        process.chdir(resolve(process.cwd(), target));
        write(`context: ${await resolveDataDir(process.cwd(), env, ctx.home)}
`);
        return "restart";
      } catch (err) {
        write(`cd: ${err instanceof Error ? err.message : String(err)}\n`);
        return "continue";
      }
    }
    default: {
      const r = await dispatchTokens([cmd!, ...rest], opts, dataDir);
      if (r.stdout !== "") write(r.stdout);
      if (r.stderr !== "") write(r.stderr);
      return "continue";
    }
  }
}
