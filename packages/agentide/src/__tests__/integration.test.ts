import { describe, expect, it } from "vitest";
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

describe("integration: full lifecycle", () => {
  it("init → status → token issue → tenant create → capability list → restart preserves state", async () => {
    const fs = new InMemoryFs();
    const dataDir = "/data";

    // 1. init
    const init = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs });
    expect(init.exitCode).toBe(0);
    expect(fs.files.has(`${dataDir}/gateway-secret`)).toBe(true);
    expect(fs.files.has(`${dataDir}/tenants.json`)).toBe(true);
    const bootstrapLine = init.stdout.split("\n").find((l: string) => l.includes(".") && l.match(/^[A-Za-z0-9_-]+\./)) ?? "";
    expect(bootstrapLine).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // 2. status shows the bootstrap tenant
    const status1 = await runCli(["status", "--data-dir", dataDir], { fs });
    expect(status1.exitCode).toBe(0);
    expect(status1.stdout).toMatch(/tenants:\s*1/);

    // 3. tenant create
    const createBeta = await runCli(
      ["tenant", "create", "--id", "beta", "--name", "Beta Co", "--data-dir", dataDir],
      { fs },
    );
    expect(createBeta.exitCode).toBe(0);
    const list1 = await runCli(["tenant", "list", "--data-dir", dataDir], { fs });
    expect(list1.stdout).toMatch(/acme/);
    expect(list1.stdout).toMatch(/beta/);

    // 4. token issue for acme
    const issued = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--scope", "*", "--data-dir", dataDir],
      { fs },
    );
    expect(issued.exitCode).toBe(0);
    const token = issued.stdout.trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // 5. capability list shows the registered capabilities
    const cap = await runCli(["capability", "list", "--data-dir", dataDir], { fs });
    expect(cap.exitCode).toBe(0);
    expect(cap.stdout).toMatch(/gateway\.status/);
    expect(cap.stdout).toMatch(/tenant\.list/);
    expect(cap.stdout).toMatch(/capability\.list/);

    // 6. RESTART simulation — same fs, fresh createPlatform-equivalent (via status)
    const status2 = await runCli(["status", "--data-dir", dataDir], { fs });
    expect(status2.stdout).toMatch(/tenants:\s*2/);
  });

  it("JWT round-trip: token issued by CLI is verifiable against the on-disk secret", async () => {
    const fs = new InMemoryFs();
    const dataDir = "/data";
    await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs });
    const issued = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-42", "--scope", "platform.tenant.read,platform.capability.read", "--data-dir", dataDir],
      { fs },
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
    const r1 = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs });
    expect(r1.exitCode).toBe(0);
    const r2 = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs });
    expect(r2.exitCode).toBe(0);
    // tenant count is still 1 (not 2)
    const status = await runCli(["status", "--data-dir", dataDir], { fs });
    expect(status.stdout).toMatch(/tenants:\s*1/);
  });
});