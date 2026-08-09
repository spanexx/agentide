// CID:cli-002 - runCli
// Purpose: parse argv, dispatch to subcommand handlers, return a structured CliResult.
//   This file is the slim entry: global error handlers, version/help/shell
//   early-outs, then the shared tree dispatcher (dispatcher.ts). Handlers
//   live in commands.ts, CLI plumbing in cli-utils.ts, the interactive shell
//   in shell.ts (cli-restructure split, D-68).
// Used by: bin entry point, integration tests, future programmatic CLI consumers.
import type { CliOptions, CliResult } from "./cli-types.js";
import { parseArgs, getFlag, result, buildHelp, cliVersion } from "./cli-utils.js";
import { dispatchTokens } from "./dispatcher.js";
import { defaultDataDir } from "./data-dir.js";
import { homedir } from "node:os";

let globalHandlersInstalled = false;

export type ErrorSink = (line: string) => void;

const defaultErrorSink: ErrorSink = (line) => {
  process.stderr.write(`${line}\n`);
};

export function installGlobalErrorHandlers(sink: ErrorSink = defaultErrorSink): boolean {
  if (globalHandlersInstalled) return false;
  globalHandlersInstalled = true;
  process.on("uncaughtException", (err) => {
    sink(`CRITICAL UNCAUGHT EXCEPTION: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    sink(`UNHANDLED PROMISE REJECTION: ${msg}`);
  });
  return true;
}

export async function runCli(argv: readonly string[], opts: CliOptions): Promise<CliResult> {
  const raw = await runCliInner(argv, opts);
  // CID:cli-014 - D-113: every exit path ends stdout with a trailing
  // newline. Without this, the shell prompt glues to the last output line
  // (visually indistinguishable from a hang). One guarantee point covers
  // every command and every error path.
  if (raw.stdout !== "" && !raw.stdout.endsWith("\n")) {
    return result(`${raw.stdout}\n`, raw.stderr, raw.exitCode);
  }
  return raw;
}

async function runCliInner(argv: readonly string[], opts: CliOptions): Promise<CliResult> {
  installGlobalErrorHandlers();
  // CID:cli-tree-013 - `cmd`/`positional` are mutable: the OLD_NAME_NEW
  //   rewrite in dispatchTokens re-targets legacy top-level names to their
  //   mapped group path.
  let { positional, flags } = parseArgs(argv);
  let cmd = positional[0];

  // --version / -v: short-circuit before command routing so it works even
  // without a data-dir / gateway. Note: parseArgs turns "--version" into
  // flags.version + cmd=undefined, so this must come BEFORE the help check.
  if (cmd === "-v" || flags["version"] === true) {
    return result(`${cliVersion()}\n`);
  }

  if (cmd === undefined || cmd === "--help" || cmd === "-h" || (flags["help"] === true && cmd === undefined)) {
    // CID:shell-010 - bare `agentide` on a TTY opens the interactive shell
    // (PRD-TRD S1); bare on a script/pipe prints help and exits 0 (S2).
    // The stdin seam makes both branches unit-testable.
    const isTTY = opts.stdin !== undefined ? opts.stdin.isTTY === true : process.stdin.isTTY === true;
    if (cmd === undefined && isTTY) {
      const { runShell } = await import("./shell.js");
      return await runShell(process.cwd(), opts, {
        input: opts.stdin ?? process.stdin,
        output: opts.stdout ?? process.stdout,
      });
    }
    return result(buildHelp());
  }

  // CID:data-dir-008 - ONE resolver for the ambient data dir (surgical change
  //   2026-08-09): flag > env > config (repo|global) > global per-repo store.
  //   The old default ("./.agentide/data") is now opt-in via config data_dir="repo".
  const dataDir = await defaultDataDir(process.cwd(), {
    env: opts.env ?? process.env,
    home: opts.home ?? homedir(),
    argv,
    configOverride: getFlag(flags, "config", ""),
  });

  return await dispatchTokens(argv, opts, dataDir);
}
