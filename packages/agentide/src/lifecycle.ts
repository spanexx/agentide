/*
 * Code Map: Lifecycle plumbing for the `agentide init / start / stop / status`
 * commands. The init command prints a bootstrap token to stdout then
 * auto-clears it on Enter or after a 30-second timer; the start command
 * detaches into the background and writes a pid file to /tmp; the stop
 * command reads the pid file and sends SIGTERM (with force kill fallback);
 * status reports the pid + alive state.
 *
 * CID Index:
 * CID:lc-001 - printTokenWithClear (init helper)
 * CID:lc-002 - detach (start helper, fork via process.spawn)
 * CID:lc-003 - readPidFile / writePidFile / isAlive
 * CID:lc-004 - stopByPid (signals SIGTERM, falls back to SIGKILL after 10s)
 *
 * Quick lookup: rg -n "CID:lc-" packages/agentide/src/lifecycle.ts
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fss from "node:fs";

export const DEFAULT_PID_FILE = "/tmp/agentide.pid";
export const DEFAULT_LOG_FILE = "/tmp/agentide.log";
export const DETACH_CHILD_FLAG = "--detach-child";
export const TOKEN_CLEAR_MS = 30_000;

/**
 * CID:lc-001 - printTokenWithClear
 * Print the JWT to stdout, then clear it once the operator presses Enter
 * or after TOKEN_CLEAR_MS, whichever comes first. Non-interactive stdin
 * (e.g. piped or detached) skips the wait and exits immediately.
 */
export async function printTokenWithClear(token: string): Promise<void> {
  // ANSI helpers (kept inline to avoid a chrome dep).
  const CLEAR = "\x1b[2J\x1b[H";
  const REVERSE = "\x1b[7m";
  const RESET = "\x1b[0m";

  const banner =
    `${REVERSE}Copy this bootstrap token. It will disappear in ` +
    `30 seconds or when you press Enter.${RESET}\n\n` +
    `${token}\n\n` +
    `${REVERSE}(press Enter now to clear it)${RESET}`;
  process.stdout.write(banner);
  process.stdout.write("\n");

  // Skip the wait when stdin isn't a TTY (CI, pipe, capture).
  if (!process.stdin.isTTY) return;

  let cleared = false;
  const clearNow = (): void => {
    if (cleared) return;
    cleared = true;
    process.stdout.write(`${CLEAR}`);
    process.stdout.write("Token cleared from scrollback.\n");
  };

  return await new Promise<void>((resolve) => {
    const timer = setTimeout(clearNow, TOKEN_CLEAR_MS);

    const onData = (): void => {
      clearNow();
      cleanup();
      resolve();
    };
    const onSigint = (): void => {
      clearNow();
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("SIGINT", onSigint);
      try { process.stdin.setRawMode?.(false); } catch { /* noop */ }
      try { process.stdin.pause(); } catch { /* noop */ }
    };

    try {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
      process.stdin.on("SIGINT", onSigint);
    } catch {
      cleanup();
      resolve();
    }
  });
}

/**
 * CID:lc-003 - pid file helpers
 * Sid: these touch /tmp which is OS-volatile, so reboots wipe them — exactly
 * what we want (no stale pids survive a restart).
 */
export async function writePidFile(path: string, pid: number): Promise<void> {
  await fs.writeFile(path, String(pid), { mode: 0o644 });
}

export async function readPidFile(path: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function removePidFile(path: string): Promise<void> {
  try { await fs.unlink(path); } catch { /* not found is fine */ }
}

/**
 * CID:lc-004 - stopByPid
 * Send SIGTERM, wait up to 10s for graceful exit, then SIGKILL if still alive.
 */
export async function stopByPid(pid: number, timeoutMs = 10_000): Promise<"graceful" | "forced" | "already-gone"> {
  if (!isAlive(pid)) return "already-gone";
  try { process.kill(pid, "SIGTERM"); } catch { return "already-gone"; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return "graceful";
    await new Promise((r) => setTimeout(r, 100));
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  return "forced";
}

/**
 * CID:lc-002 - detach
 * Spawn the same agentide binary as a detached child with --detach-child,
 * redirect stdio to the log file, write the child's pid, return immediately.
 *
 * Re-execs the current node process with the same argv + the child flag + the
 * stdio redirects. The child sees its argv[2] === '--detach-child' and skips
 * the detach logic (it just runs the gateway normally).
 */
export function detachChild(opts: {
  logFile: string;
  pidFile: string;
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
}): { childPid: number } | { error: string } {
  const logFd = fss.openSync(opts.logFile, "a");
  const child = spawn(
    process.execPath,
    [process.argv[1], ...opts.argv, DETACH_CHILD_FLAG],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: opts.env ?? process.env,
    },
  );
  fss.closeSync(logFd);
  child.unref();
  if (typeof child.pid !== "number") return { error: "spawn failed: no pid returned" };
  return { childPid: child.pid };
}

/**
 * Detect whether we're the detached child. Called at the very top of the
 * CLI entry to decide whether to enter detach mode or run normally.
 */
export function isDetachChild(argv: readonly string[]): boolean {
  return argv.includes(DETACH_CHILD_FLAG);
}
