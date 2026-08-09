// CID:cli-split-001 - world refusal tests (IMPL Phase 2, PRD-TRD S5)
// Purpose: lock the local-vs-remote split. Offline commands refuse
//   --url/--token; live commands refuse --data-dir and, without an explicit
//   --url, require a running gateway via the pid file ("gateway not running"
//   — never a raw ECONNREFUSED). These tests are the spec: wording changes
//   only with the PRD-TRD.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../index.js";
import type { CliOptions } from "../cli-types.js";

// Minimal FileSystem: dispatch-time refusals never touch the fs; consumer
// paths (live checks) may read the pid file via node:fs (real), so live
// tests force the seam.
function makeFs(): CliOptions["fs"] {
  return {
    async readFile(): Promise<string> { throw new Error("ENOENT"); },
    async writeFile(): Promise<void> {},
    async exists(): Promise<boolean> { return false; },
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentide-split-"));
}

describe("cli-split: offline world refuses --url/--token (PRD-TRD S5)", () => {
  it("`tenant list --url ws://x` → refused, exit 1", async () => {
    const r = await runCli(["tenant", "list", "--url", "ws://x"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is offline \(data-dir only\)/);
  });

  it("`tenant list --token t` → refused, exit 1", async () => {
    const r = await runCli(["tenant", "list", "--token", "t"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is offline \(data-dir only\)/);
  });

  it("`client list --url ws://x` → refused, exit 1", async () => {
    const r = await runCli(["client", "list", "--url", "ws://x"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is offline \(data-dir only\)/);
  });

  it("`token issue --url ws://x` → refused, exit 1", async () => {
    const r = await runCli(["token", "issue", "--url", "ws://x"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is offline \(data-dir only\)/);
  });

  it("`init --url ws://x` (top-level offline) → refused, exit 1", async () => {
    const r = await runCli(["init", "--url", "ws://x"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/init is offline \(data-dir only\)/);
  });

  it("`capability describe --url ws://x` → refused (describe runs on the in-process registry in v1)", async () => {
    const r = await runCli(["capability", "describe", "--name", "x", "--url", "ws://x"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is offline \(data-dir only\)/);
  });
});

describe("cli-split: live world refuses --data-dir (PRD-TRD S5)", () => {
  it("`gateway status --data-dir /data` → refused, exit 1", async () => {
    const r = await runCli(["gateway", "status", "--data-dir", "/data"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is live \(remote gateway\)/);
  });

  it("`session list --data-dir /data` → refused, exit 1", async () => {
    const r = await runCli(["session", "list", "--data-dir", "/data"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is live \(remote gateway\)/);
  });

  it("`invoke product.list --data-dir /data` (top-level live) → refused, exit 1", async () => {
    const r = await runCli(["invoke", "product.list", "--data-dir", "/data"], { fs: makeFs() });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/invoke is live \(remote gateway\)/);
  });
});

describe("cli-split: live without --url requires a running gateway (PRD-TRD S5/S6)", () => {
  it("`gateway status` with no pid file → 'gateway not running', exit 1", async () => {
    const dir = tempDir();
    try {
      const r = await runCli(["gateway", "status"], { fs: makeFs(), pidFile: join(dir, "nope.pid") });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/gateway not running \(start it with: agentide gateway start\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("old name `status` with no pid file → 'gateway not running', exit 1", async () => {
    const dir = tempDir();
    try {
      const r = await runCli(["status"], { fs: makeFs(), pidFile: join(dir, "nope.pid") });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/gateway not running/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`gateway status` with a live pid file → proceeds (not 'gateway not running')", async () => {
    const dir = tempDir();
    try {
      const pidFile = join(dir, "alive.pid");
      writeFileSync(pidFile, JSON.stringify({ pid: process.pid, dataDir: "/tmp" }));
      // No --url and no config → the consumer path errors with "gateway URL
      // required" (exit 2) rather than the pid-file message (exit 1).
      const r = await runCli(["gateway", "status"], { fs: makeFs(), pidFile });
      expect(r.exitCode).not.toBe(1);
      expect(r.stderr).not.toMatch(/gateway not running/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`gateway status --url ws://...` skips the pid-file check entirely", async () => {
    const dir = tempDir();
    try {
      // Dead endpoint + explicit --url: the consumer connect fails (exit != 0),
      // NOT the "gateway not running" message — the operator pointed at a URL.
      const r = await runCli(
        ["gateway", "status", "--url", "ws://127.0.0.1:1/ws", "--token", "t"],
        { fs: makeFs(), pidFile: join(dir, "nope.pid") },
      );
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).not.toMatch(/gateway not running/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
