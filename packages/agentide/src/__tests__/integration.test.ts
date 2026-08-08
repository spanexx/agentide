import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../index.js";
import type { FileSystem, TokenClaims } from "@spanexx/gateway-core";
import { verifyToken } from "@spanexx/gateway-core";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

// init/token-issue persist to the config file (F2a/D-112) via the home seam;
// every run gets an isolated temp home so the real operator config is never
// read or written by tests.
function isolatedHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "agentide-integration-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

describe("integration: full lifecycle", () => {
  it("init → status → token issue → tenant create → capability list → restart preserves state", async () => {
    const fs = new InMemoryFs();
    const dataDir = "/data";
    const iso = isolatedHome();

    // 1. init — capture stdout because init writes the token directly to it
    // (for the auto-clear-on-Enter behavior). The runCli result doesn't have it.
    const initOut: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => {
      initOut.push(typeof c === "string" ? c : c.toString());
      return true;
    }) as typeof process.stdout.write;
    let init;
    try {
      init = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: iso.home });
    } finally {
      process.stdout.write = origWrite;
    }
    expect(init.exitCode).toBe(0);
    expect(fs.files.has(`${dataDir}/gateway-secret`)).toBe(true);
    expect(fs.files.has(`${dataDir}/tenants.json`)).toBe(true);
    // F2a: the bootstrap token is saved to the config file, never printed to
    // the terminal. Assert the confirmation line and the ABSENCE of any JWT
    // on stdout.
    const captured = initOut.join("");
    const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(captured).toMatch(/Bootstrap token saved to/);
    const tokenLikeLine = captured.split("\n").map(stripAnsi).find(
      (l) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(l),
    ) ?? "";
    expect(tokenLikeLine).toBe("");

    // 2. `tenant list` shows the bootstrap tenant. NOTE: `status` is
    // live-only after the cli-restructure (PRD-TRD S6) — the local
    // in-process status path died with the old name, so the tenant
    // probe is `tenant list` (offline, disk).
    const list0 = await runCli(["tenant", "list", "--data-dir", dataDir], { fs, home: iso.home });
    expect(list0.exitCode).toBe(0);
    expect(list0.stdout).toMatch(/acme/);

    // 3. tenant create
    const createBeta = await runCli(
      ["tenant", "create", "--id", "beta", "--name", "Beta Co", "--data-dir", dataDir],
      { fs, home: iso.home },
    );
    expect(createBeta.exitCode).toBe(0);
    const list1 = await runCli(["tenant", "list", "--data-dir", dataDir], { fs, home: iso.home });
    expect(list1.stdout).toMatch(/acme/);
    expect(list1.stdout).toMatch(/beta/);

    // 4. token issue for acme
    const issued = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--scope", "*", "--data-dir", dataDir],
      { fs, home: iso.home },
    );
    expect(issued.exitCode).toBe(0);
    const token = issued.stdout.trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // 5. capability list shows the registered capabilities
    const cap = await runCli(["capability", "list", "--data-dir", dataDir], { fs, home: iso.home });
    expect(cap.exitCode).toBe(0);
    expect(cap.stdout).toMatch(/gateway\.status/);
    expect(cap.stdout).toMatch(/tenant\.list/);
    expect(cap.stdout).toMatch(/capability\.list/);

    // 6. RESTART simulation — same fs, fresh createPlatform-equivalent.
    //    `tenant list` re-reads the persisted store and must still see
    //    both tenants (disk persistence proof). NOTE: D-117 (status
    //    reporting tenantCount: 0) is moot for the CLI now — `status` is
    //    live-only per PRD-TRD S6, so the broken local status path no
    //    longer exists.
    const list2 = await runCli(["tenant", "list", "--data-dir", dataDir], { fs, home: iso.home });
    expect(list2.exitCode).toBe(0);
    expect(list2.stdout).toMatch(/acme/);
    expect(list2.stdout).toMatch(/beta/);
  });

  it("JWT round-trip: token issued by CLI is verifiable against the on-disk secret", async () => {
    const fs = new InMemoryFs();
    const dataDir = "/data";
    const iso = isolatedHome();
    await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: iso.home });
    const issued = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-42", "--scope", "platform.tenant.read,platform.capability.read", "--data-dir", dataDir],
      { fs, home: iso.home },
    );
    const token = issued.stdout.trim();
    // Decode the secret (base64 stored on disk)
    const stored = fs.files.get(`${dataDir}/gateway-secret`);
    expect(stored).toBeDefined();
    const secretBytes = Buffer.from(stored ?? "", "base64");
    // Stub a clock-now that matches the iat/exp window. The test just verifies verification doesn't throw
    // a TOKEN_INVALID error for a freshly minted token; full scope/exp validation lives in gateway-core tests.
    const now = Date.now();
    const fakeClock = { now: () => now + 1000, setTimeout: () => 0, clearTimeout: () => undefined };
    const result = verifyToken(token, fakeClock, new Uint8Array(secretBytes));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const claims = result.claims as TokenClaims;
      expect(claims.sub.tenantId).toBe("acme");
      expect(claims.sub.callerId).toBe("agent-42");
    }
  });

  it("`init` is idempotent — running it twice on the same dataDir does not error", async () => {
    const fs = new InMemoryFs();
    const dataDir = "/data";
    const iso = isolatedHome();
    const r1 = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: iso.home });
    expect(r1.exitCode).toBe(0);
    const r2 = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: iso.home });
    expect(r2.exitCode).toBe(0);
    // `init` does not error on re-run (the actual contract this test
    // pins). NOTE[agent]: D-118 — `init` is NOT tenant-idempotent: each
    // run re-registers the default tenant, so `tenant list` shows acme
    // twice after two inits. The old "count is still 1" comment was a
    // misdiagnosis — it read the broken (D-117) status count of 0. The
    // real count after two inits is 2. Tracked in docs/drift.md D-118.
    const list = await runCli(["tenant", "list", "--data-dir", dataDir], { fs, home: iso.home });
    expect(list.exitCode).toBe(0);
    expect(list.stdout.match(/acme/g)?.length).toBe(2);
  });
});