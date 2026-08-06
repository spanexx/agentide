// Phase 3 (D-83): agentide stop exits 0 in BOTH "nothing running" branches.
// Previously: pid-missing → rc 1; pid-present+dead → rc 0. Now both are 0 so
// `agentide stop && next` works in shell scripts.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStop } from "../start.js";

describe("agentide stop (D-83)", () => {
  it("exits 0 when no pid file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentide-stop-"));
    try {
      const r = await runStop("", { "pid-file": join(dir, "missing.pid") }, {} as never);
      expect(r.exitCode).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/no gateway running/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when the pid file exists but the pid is dead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentide-stop-"));
    const pidFile = join(dir, "gateway.pid");
    try {
      // Write a pid that is certainly dead (2^22 max pid on Linux is huge but
      // 999999 is a safe "almost certainly not running" on default proc limits).
      writeFileSync(pidFile, "999999999\n", "utf8");
      const r = await runStop("", { "pid-file": pidFile }, {} as never);
      expect(r.exitCode).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/was already not running|no pid file/);
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});