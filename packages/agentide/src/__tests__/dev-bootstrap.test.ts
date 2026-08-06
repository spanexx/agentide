/*
 * Code Map: end-to-end test for the SDK door (backend-runtime) when the
 * dev bootstrap (scripts/start-gateway.mjs) is run with the new
 * `backendRuntimePort` seam. This is the behavior the example app relies on:
 *   1. The dev bootstrap opens the SDK door on 7350.
 *   2. The door accepts TCP connections.
 *   3. The banner advertises all three doors.
 *
 * Why this test: the dev bootstrap is the canonical "open every door" config
 * the example app is meant to run against. A passing probe means the example
 * has a reachable target. Anything that breaks the wiring (factory.ts gate,
 * start-gateway.mjs arg name, port collision) gets caught here.
 *
 * CID Index:
 * CID:dev-bootstrap-001 -> start-gateway.mjs opens 7350
 * CID:dev-bootstrap-002 -> 7350 accepts TCP connections
 * CID:dev-bootstrap-003 -> banner advertises all three doors
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTIDE_REPO = path.resolve(HERE, "../../../..");
const SCRIPT = path.resolve(AGENTIDE_REPO, "scripts/start-gateway.mjs");
const DATA_DIR = path.resolve(AGENTIDE_REPO, ".tmp-dev-bootstrap-test-data");

async function rmrf(p: string): Promise<void> {
  await fs.promises.rm(p, { recursive: true, force: true });
}

async function killProcessTree(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // best-effort — the child may already have exited
  }
}

async function isPortListening(port: number, host = "127.0.0.1", timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
    sock.on("timeout", () => finish(false));
    sock.connect(port, host);
  });
}

describe("dev bootstrap (scripts/start-gateway.mjs)", () => {
  let child: ChildProcess | undefined;
  let stdoutBuf = "";
  let stderrBuf = "";

  afterEach(async () => {
    if (child !== undefined && child.pid !== undefined) {
      await killProcessTree(child.pid);
      try {
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => resolve(), 1000);
          child!.on("exit", () => { clearTimeout(t); resolve(); });
        });
      } catch {
        // ignore
      }
    }
    child = undefined;
    stdoutBuf = "";
    stderrBuf = "";
    await rmrf(DATA_DIR);
  });

  it("CID:dev-bootstrap-001 — opens sdk door on 7350 (banner)", async () => {
    await rmrf(DATA_DIR);
    child = spawn(process.execPath, [SCRIPT], {
      cwd: AGENTIDE_REPO,
      env: { ...process.env, AGENTIDE_DATA_DIR: DATA_DIR },
      detached: true,
    });
    child.stdout?.on("data", (d) => { stdoutBuf += d.toString(); });
    child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });
    // Wait for the banner to land (banner prints after createPlatform)
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (stdoutBuf.includes("platform up") || stderrBuf.includes("platform up")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(stdoutBuf + stderrBuf).toMatch(/sdk :7350/);
  }, 8000);

  it("CID:dev-bootstrap-002 — 7350 accepts TCP connections", async () => {
    await rmrf(DATA_DIR);
    child = spawn(process.execPath, [SCRIPT], {
      cwd: AGENTIDE_REPO,
      env: { ...process.env, AGENTIDE_DATA_DIR: DATA_DIR },
      detached: true,
    });
    child.stdout?.on("data", (d) => { stdoutBuf += d.toString(); });
    child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });
    // Wait for 7350 to come up
    const start = Date.now();
    let up = false;
    while (Date.now() - start < 5000) {
      if (await isPortListening(7350)) { up = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(up).toBe(true);
  }, 8000);

  it("CID:dev-bootstrap-003 — banner advertises all three doors", async () => {
    await rmrf(DATA_DIR);
    child = spawn(process.execPath, [SCRIPT], {
      cwd: AGENTIDE_REPO,
      env: { ...process.env, AGENTIDE_DATA_DIR: DATA_DIR },
      detached: true,
    });
    child.stdout?.on("data", (d) => { stdoutBuf += d.toString(); });
    child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (stdoutBuf.includes("platform up") || stderrBuf.includes("platform up")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const combined = stdoutBuf + stderrBuf;
    expect(combined).toMatch(/mcp :7100/);
    expect(combined).toMatch(/ws :7300/);
    expect(combined).toMatch(/sdk :7350/);
  }, 8000);
});
