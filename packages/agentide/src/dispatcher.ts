// CID:dispatcher-001 - tree dispatcher (cli-restructure split, D-68)
// Purpose: the shared parse → old-name rewrite → world-gated tree dispatch
//   core. Used by the one-shot CLI (cli.ts runCliInner) and the interactive
//   shell (shell.ts) — one argv array in, one CliResult out.
import { homedir } from "node:os";
import type { CliOptions, CliResult } from "./cli-types.js";
import { parseArgs, getFlag, result, buildHelp } from "./cli-utils.js";
import { GROUPS, OLD_NAME_NEW, groupHelp, worldOf } from "./cli-tree.js";
import { hasUrlSource } from "./config.js";
import { runConsumer } from "./consumer.js";
import { runStop, runDetachedStart } from "./start.js";
import { DEFAULT_PID_FILE, readPidFile, isAlive } from "./lifecycle.js";
import {
  runInit,
  runTenant,
  runToken,
  runClient,
  runCapability,
  runPlugin,
} from "./commands.js";

// CID:cli-tree-014 - dispatchTokens: parse → old-name rewrite → dispatchTree.
//   Old-name deprecation routing (IMPL Phase 4, PRD-TRD S4): legacy top-level
//   names rewrite to their mapped group path so dispatchTree is the single
//   router; the one-release stderr note is emitted exactly once per
//   invocation, prepended to the result, naming the new tree command. Old
//   names die in the release after this one.
export async function dispatchTokens(
  argv: readonly string[],
  opts: CliOptions,
  dataDir: string,
): Promise<CliResult> {
  const parsed = parseArgs(argv);
  const { flags } = parsed;
  let { positional } = parsed;
  let cmd = positional[0];
  let deprecationNote: string | undefined;
  {
    const mapped = OLD_NAME_NEW[cmd ?? ""];
    if (mapped !== undefined) {
      const oldName = cmd!;
      cmd = mapped.group;
      positional = [mapped.group, mapped.sub, ...positional.slice(1)];
      deprecationNote = `note: 'agentide ${oldName}' is deprecated — use 'agentide ${mapped.group} ${mapped.sub}' (removed next release)\n`;
    }
  }

  const r = await dispatchTree(argv, opts, dataDir, flags, positional, cmd);
  return deprecationNote === undefined ? r : { ...r, stderr: `${deprecationNote}${r.stderr}` };
}

// CID:cli-tree-012 - tree-driven dispatch (IMPL Phase 1/4/5, PRD-TRD S3).
//   Every group in GROUPS routes here: bare/--help → groupHelp exit 0;
//   unknown sub → error + group list exit 2; known sub → the group's handler.
//   Sub commands with no v1 handler (session create|resume|destroy|touch,
//   plugin install|uninstall|enable|disable|reload) fail with a clear
//   "not implemented in v1" error (exit 1).
async function dispatchTree(
  argv: readonly string[],
  opts: CliOptions,
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  positional: readonly string[],
  cmd: string | undefined,
): Promise<CliResult> {
  try {
    const group = GROUPS[cmd ?? ""];
    if (group !== undefined) {
      const sub = positional[1];
      // bare group (no sub) or `agentide <group> --help` → group help.
      // `agentide <group> <sub> --help` falls through to the handler,
      // which owns its per-subcommand flag help (D-84).
      if (sub === undefined) {
        return result(groupHelp(cmd!));
      }
      if (group.subs[sub] === undefined) {
        return result("", `error: unrecognized subcommand: ${sub}\n\n${groupHelp(cmd!)}`, 2);
      }
      // CID:cli-split-002 - world refusal gate (IMPL Phase 2, PRD-TRD S5).
      // Wraps executable handler dispatch: offline refuses --url/--token,
      // live refuses --data-dir and requires a running gateway (pid-file
      // check) unless an explicit --url is given. Declared-but-unimplemented
      // subs (session/plugin mutators) bypass the gate — they keep the
      // "not implemented in v1" message, which is the better signal.
      const gated = async (fn: () => Promise<CliResult>): Promise<CliResult> => {
        const refused = await refuseForWorld(cmd!, sub, flags, opts);
        return refused ?? (await fn());
      };
      switch (cmd) {
        case "gateway":
          // start|stop stay in the offline world (pid-file / spawn ops);
          // status|health|metrics|version are live-only per PRD-TRD S6
          // and route to the consumer path.
          if (sub === "start") return await gated(() => runDetachedStart(dataDir, flags, opts));
          if (sub === "stop") return await gated(() => runStop(dataDir, flags, opts));
          return await gated(() => runConsumer(argv, consumerOptions(argv, opts)));
        case "tenant":
          return await gated(() => runTenant(positional.slice(1), dataDir, flags, opts));
        case "client":
          return await gated(() => runClient(positional.slice(1), dataDir, flags, opts));
        case "token":
          return await gated(() => runToken(positional.slice(1), dataDir, flags, opts));
        case "capability":
          // `capability list` is dual-mode (PRD-TRD S5): remote when
          // --url/env/config supplies a URL, disk otherwise. describe
          // runs on the in-process registry in v1 (IMPL delivery note 4).
          if (sub === "list" && (await hasUrlSource(argv, opts.env ?? process.env, { home: opts.home }))) {
            return await gated(() => runConsumer(argv, consumerOptions(argv, opts)));
          }
          return await gated(() => runCapability(positional.slice(1), dataDir, flags, opts));
        case "plugin":
          if (sub === "list" && (await hasUrlSource(argv, opts.env ?? process.env, { home: opts.home }))) {
            return await gated(() => runConsumer(argv, consumerOptions(argv, opts)));
          }
          if (sub === "list") return await gated(() => runPlugin(positional.slice(1), dataDir, opts));
          // PRD-TRD S3 declares the full surface; v1 ships only plugin list.
          return result("", `error: plugin ${sub} is not implemented in v1 (surface: plugin list)\n`, 1);
        case "session":
          if (sub === "list") return await gated(() => runConsumer(argv, consumerOptions(argv, opts)));
          // PRD-TRD S3 declares the full surface; v1 ships only session
          // list (the consumer "sessions" alias).
          return result("", `error: session ${sub} is not implemented in v1 (surface: session list)\n`, 1);
        default:
          // unreachable: every GROUPS key has a case above
          return result("", `unknown command: ${cmd}\n\n${buildHelp()}`, 2);
      }
    }

    switch (cmd) {
      case "init":
        // CID:cli-split-003 - init is offline (data-dir only, PRD-TRD S5).
        if (flags["url"] !== undefined || flags["token"] !== undefined) {
          return result("", "error: init is offline (data-dir only) — remove --url/--token\n", 1);
        }
        return await runInit(dataDir, flags, opts);
      // remote consumer commands (GRILL Q2) that live outside the tree
      case "invoke":
      case "watch":
        // CID:cli-split-004 - invoke/watch are live (PRD-TRD S5): refuse
        // --data-dir and require a running gateway unless an explicit --url
        // is given (the pid-file message, never a raw ECONNREFUSED).
        if (flags["data-dir"] !== undefined) {
          return result("", `error: ${cmd} is live (remote gateway) — remove --data-dir\n`, 1);
        }
        if (flags["url"] === undefined) {
          const pidFile = getFlag(flags, "pid-file", opts.pidFile ?? DEFAULT_PID_FILE);
          const info = await readPidFile(pidFile);
          if (info === null || !isAlive(info.pid)) {
            return result("", "error: gateway not running (start it with: agentide gateway start)\n", 1);
          }
        }
        return await runConsumer(argv, consumerOptions(argv, opts));
      default:
        return result("", `unknown command: ${cmd}\n\n${buildHelp()}`, 2);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return result("", `error: ${msg}\n`, 1);
  }
}

function consumerOptions(argv: readonly string[], opts: CliOptions) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  return {
    argv,
    env,
    isTTY: opts.stdin !== undefined ? opts.stdin.isTTY === true : process.stdout.isTTY === true,
    width: typeof process !== "undefined" ? process.stdout.columns : undefined,
    cwd,
    home: opts.home ?? homedir(),
  };
}

// CID:cli-split-001 - world refusal (IMPL Phase 2, PRD-TRD S5).
// Offline commands are data-dir only; live commands are gateway-only and,
// without an explicit --url, require a running gateway via the pid file —
// never a raw ECONNREFUSED. Dual commands (capability list / plugin list)
// take neither refusal: disk by default, --url switches to the live gateway.
// Returns a CliResult when refused, null when the command may proceed.
async function refuseForWorld(
  cmd: string,
  sub: string | undefined,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult | null> {
  const name = sub === undefined ? cmd : `${cmd} ${sub}`;
  const world = worldOf(cmd, sub ?? "");
  if (world === "offline") {
    if (flags["url"] !== undefined || flags["token"] !== undefined) {
      return result("", `error: ${name} is offline (data-dir only) — remove --url/--token\n`, 1);
    }
    return null;
  }
  if (world === "live") {
    if (flags["data-dir"] !== undefined) {
      return result("", `error: ${name} is live (remote gateway) — remove --data-dir\n`, 1);
    }
    if (flags["url"] === undefined) {
      const pidFile = getFlag(flags, "pid-file", opts.pidFile ?? DEFAULT_PID_FILE);
      const info = await readPidFile(pidFile);
      if (info === null || !isAlive(info.pid)) {
        return result("", "error: gateway not running (start it with: agentide gateway start)\n", 1);
      }
    }
    return null;
  }
  return null; // dual — no refusal
}
