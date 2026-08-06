/*
 * Code Map: end-to-end test for the detached `agentide start` lifecycle —
 * the bug fixed in this pack (handoff 2026-08-05): the detached child
 * re-entered runDetachedStart, read its own PID from the pid file, and
 * killed itself with "gateway already running (PID <itself>)" before the
 * gateway ever booted.
 *
 * These tests spawn the REAL bundled CLI (dist/bin.bundled.cjs) as a
 * detached process and verify the whole lifecycle:
 *   1. `start` exits 0 with "Detached. PID:", the pid file is written,
 *      and the child actually boots the gateway (log reaches "platform up").
 *   2. A second `start` while one is alive is refused (exit 2).
 *   3. `stop` terminates the gateway and clears the pid file.
 *
 * CID Index:
 * CID:detach-001 -> detached start boots the gateway (the bug repro)
 * CID:detach-002 -> second start refused while one is alive
 * CID:detach-003 -> stop kills the detached gateway + clears pid file
 *
 * Ports: MCP on 27100 (unique — avoids parallel-file collisions with
 * dev-bootstrap.test.ts which uses 7100/7300/7350); WS disabled because
 * the WS adapter port is hardcoded to 7300 in v1 (no --port-ws).
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "../../dist/bin.bundled.cjs");
const MCP_PORT = "27100";

function runCli(args: string[], timeoutMs = 15_000): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile: string): number | null {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    // D-81: pid file is now JSON {"pid":…,"dataDir":…,…}; legacy plain-number
    // files still parse.
    const pid = raw.startsWith("{")
      ? Number.parseInt(String(JSON.parse(raw).pid), 10)
      : Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function waitForLog(logFile: string, needle: string, timeoutMs = 10_000): Promise<string> {
  const start = Date.now();
  let log = "";
  while (Date.now() - start < timeoutMs) {
    try {
      log = fs.readFileSync(logFile, "utf8");
    } catch {
      log = "";
    }
    if (log.includes(needle)) return log;
    await new Promise((r) => setTimeout(r, 100));
  }
  return log;
}

describe("detached agentide start (real CLI)", () => {
  let tmpDir = "";

  afterEach(() => {
    // Kill any gateway child left behind (detached children get their own
    // process group, so SIGTERM the group). Best-effort.
    const pidFile = path.join(tmpDir, "agentide.pid");
    const pid = readPid(pidFile);
    if (pid !== null && isAlive(pid)) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    tmpDir = "";
  });

  it("CID:detach-001 — detached start boots the gateway (bug repro)", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentide-detach-test-"));
    const pidFile = path.join(tmpDir, "agentide.pid");
    const logFile = path.join(tmpDir, "agentide.log");

    const parent = runCli(["start", "--data-dir", tmpDir, "--pid-file", pidFile, "--log-file", logFile, "--no-ws", "--port-mcp", MCP_PORT]);

    // Parent returns immediately with the Detached banner.
    expect(parent.status).toBe(0);
    expect(parent.stdout).toMatch(/Detached\. PID: \d+/);

    // Pid file written and the child is alive.
    const childPid = readPid(pidFile);
    expect(childPid).not.toBeNull();
    expect(isAlive(childPid!)).toBe(true);

    // The gateway actually boots (pre-fix: log shows "already running" and
    // the child exits — this is where the bug repro fails).
    const log = await waitForLog(logFile, "platform up");
    expect(log).toMatch(/platform up — mcp :27100, ws \(disabled\)/);
    expect(log).not.toMatch(/already running/);
    expect(isAlive(childPid!)).toBe(true);
  }, 20_000);

  it("CID:detach-002 — second start refused while one is alive", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentide-detach-test-"));
    const pidFile = path.join(tmpDir, "agentide.pid");
    const logFile = path.join(tmpDir, "agentide.log");

    const parent = runCli(["start", "--data-dir", tmpDir, "--pid-file", pidFile, "--log-file", logFile, "--no-ws", "--port-mcp", MCP_PORT]);
    expect(parent.status).toBe(0);
    expect(await waitForLog(logFile, "platform up")).toMatch(/platform up/);

    const second = runCli(["start", "--data-dir", tmpDir, "--pid-file", pidFile, "--log-file", logFile, "--no-ws", "--port-mcp", MCP_PORT]);
    expect(second.status).toBe(2);
    expect(second.stderr).toMatch(/gateway already running/);
  }, 20_000);

  it("CID:detach-003 — stop kills the detached gateway and clears the pid file", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentide-detach-test-"));
    const pidFile = path.join(tmpDir, "agentide.pid");
    const logFile = path.join(tmpDir, "agentide.log");

    const parent = runCli(["start", "--data-dir", tmpDir, "--pid-file", pidFile, "--log-file", logFile, "--no-ws", "--port-mcp", MCP_PORT]);
    expect(parent.status).toBe(0);
    expect(await waitForLog(logFile, "platform up")).toMatch(/platform up/);
    const childPid = readPid(pidFile);
    expect(childPid).not.toBeNull();
    expect(isAlive(childPid!)).toBe(true);

    const stop = runCli(["stop", "--pid-file", pidFile]);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toMatch(/Gateway stopped/);
    expect(isAlive(childPid!)).toBe(false);
    expect(readPid(pidFile)).toBeNull();
  }, 20_000);
});
