/*
 * Code Map: agentide CLI capability list tier column tests (BI[7])
 * - tier column appears in each row
 * - read tier filters by tier
 * - write tier filters by tier
 * - business caps (null tier) show "-" in the column
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../cli.js";

class InMemoryFs {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

describe("CLI capability list — tier column (BI[7])", () => {
  const opts = { fs: new InMemoryFs(), home: "/tmp/opencode/cli-tier-home" };
  beforeEach(() => { opts.fs = new InMemoryFs(); });
  it("each row includes a tier column", async () => {
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], opts);
    const r = await runCli(["capability", "list", "--data-dir", "/data"], opts);
    expect(r.exitCode).toBe(0);
    // Each row should match: name, version, tier, description (4 tab-separated fields after the "- ")
    const rows = r.stdout.trim().split("\n").filter((l) => l.startsWith("- "));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cols = row.split("\t");
      expect(cols.length).toBeGreaterThanOrEqual(4);
      // Tier column is one of the valid tiers OR "-" (business caps)
      expect(["read", "write", "act", "destructive", "-"]).toContain(cols[2]);
    }
  });

  it("`capability list --tier read` only shows read-tier caps", async () => {
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], opts);
    const r = await runCli(["capability", "list", "--tier", "read", "--data-dir", "/data"], opts);
    expect(r.exitCode).toBe(0);
    const rows = r.stdout.trim().split("\n").filter((l) => l.startsWith("- "));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cols = row.split("\t");
      expect(cols[2]).toBe("read");
    }
  });

  it("`capability list --tier write` shows write-tier caps (session.create, plugin.install)", async () => {
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], opts);
    const r = await runCli(["capability", "list", "--tier", "write", "--data-dir", "/data"], opts);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.create/);
    expect(r.stdout).toMatch(/plugin\.install/);
    expect(r.stdout).not.toMatch(/session\.list/); // read-tier excluded
  });

  it("`capability list --tier act` returns empty (no runtime caps registered by default)", async () => {
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], opts);
    const r = await runCli(["capability", "list", "--tier", "act", "--data-dir", "/data"], opts);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});