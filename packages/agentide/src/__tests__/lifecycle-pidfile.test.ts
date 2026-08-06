// Phase 2 (D-81): pid file carries the gateway's data-dir so `agentide status`
// can recover it from any cwd. Format becomes JSON
//   {"pid": 1234, "dataDir": "/tmp/x", "startedAt": "2026-08-06T..."}
// with a legacy fallback for old-format plain-number pid files.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPidFile, removePidFile, writePidFile } from "../lifecycle.js";

let DIR = "";
function freshDir(): string {
  DIR = mkdtempSync(join(tmpdir(), "agentide-pid-"));
  return DIR;
}
afterEach(() => {
  if (DIR && existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
});

describe("pid file (D-81)", () => {
  it("writes and reads a JSON pid file with dataDir + startedAt", async () => {
    const dir = freshDir();
    const path = join(dir, "gateway.pid");
    await writePidFile(path, 4242, "/var/lib/agentide", "2026-08-06T10:00:00.000Z");
    const info = await readPidFile(path);
    expect(info).not.toBeNull();
    if (info === null) return;
    expect(info.pid).toBe(4242);
    expect(info.dataDir).toBe("/var/lib/agentide");
    expect(info.startedAt).toBe("2026-08-06T10:00:00.000Z");
  });

  it("falls back to plain-number pid files (legacy format)", async () => {
    const dir = freshDir();
    const path = join(dir, "legacy.pid");
    writeFileSync(path, "7777\n", "utf8");
    const info = await readPidFile(path);
    expect(info).not.toBeNull();
    if (info === null) return;
    expect(info.pid).toBe(7777);
    // Legacy pid files have no dataDir — undefined is expected.
    expect(info.dataDir).toBeUndefined();
  });

  it("returns null for a malformed pid file", async () => {
    const dir = freshDir();
    const path = join(dir, "bad.pid");
    writeFileSync(path, "not-a-pid\n", "utf8");
    expect(await readPidFile(path)).toBeNull();
  });

  it("returns null when the pid file is missing", async () => {
    const dir = freshDir();
    expect(await readPidFile(join(dir, "missing.pid"))).toBeNull();
  });

  it("removePidFile is idempotent", async () => {
    const dir = freshDir();
    const path = join(dir, "tmp.pid");
    await writePidFile(path, 1, "/data", "2026-08-06T00:00:00.000Z");
    expect(existsSync(path)).toBe(true);
    await removePidFile(path);
    expect(existsSync(path)).toBe(false);
    await removePidFile(path); // no throw
  });
});