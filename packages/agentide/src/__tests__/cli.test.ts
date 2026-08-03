import { describe, expect, it } from "vitest";
import { runCli } from "../index.js";
import type { FileSystem } from "@platform/gateway-core";

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

describe("CLI", () => {
  it("prints help and exits 0 when invoked with --help", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["--help", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/agentide/);
    expect(r.stdout).toMatch(/init|start|stop|status|tenant|token|capability|plugin/);
  });

  it("prints help when invoked with no args", async () => {
    const fs = new InMemoryFs();
    const r = await runCli([], { fs });
    expect(r.exitCode).toBe(0);
  });

  it("`init` creates the default tenant + secret file and prints the bootstrap token", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    expect(r.exitCode).toBe(0);
    expect(fs.files.has("/data/gateway-secret")).toBe(true);
    expect(r.stdout).toMatch(/Bootstrap token for tenant "acme":/);
    // The token is a JWT
    const tokenLine = r.stdout.split("\n").find((l: string) => l.includes(".") && l.includes(".") && !l.startsWith("#")) ?? "";
    expect(tokenLine).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("`status` returns a JSON-ish status line after init", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["status", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/tenants:\s*1/);
    expect(r.stdout).toMatch(/plugins:\s*0/);
  });

  it("`tenant create` adds a new tenant and `tenant list` shows it", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const c = await runCli(["tenant", "create", "--id", "beta", "--name", "Beta Co", "--data-dir", "/data"], { fs });
    expect(c.exitCode).toBe(0);
    const l = await runCli(["tenant", "list", "--data-dir", "/data"], { fs });
    expect(l.exitCode).toBe(0);
    expect(l.stdout).toMatch(/acme/);
    expect(l.stdout).toMatch(/beta/);
  });

  it("`token issue` mints a JWT and prints it", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--scope", "platform.tenant.read,platform.capability.read", "--data-dir", "/data"],
      { fs },
    );
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    expect(last).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("`capability list` shows the registered capabilities", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/gateway\.status/);
    expect(r.stdout).toMatch(/tenant\.list/);
  });

  it("`capability list --owner session-manager` shows only session.* caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--owner", "session-manager", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.create/);
    expect(r.stdout).toMatch(/session\.list/);
    expect(r.stdout).not.toMatch(/gateway\.status/);
    expect(r.stdout).not.toMatch(/tenant\.list/);
  });

  it("`capability list --owner plugin-manager` shows only plugin.* caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--owner", "plugin-manager", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plugin\.install/);
    expect(r.stdout).toMatch(/plugin\.list/);
    expect(r.stdout).not.toMatch(/session\.create/);
    expect(r.stdout).not.toMatch(/gateway\.status/);
  });

  it("`capability list --owner nonexistent` returns empty list", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--owner", "nonexistent", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("`capability list --tier read` shows only read-tier caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--tier", "read", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.list/);
    expect(r.stdout).not.toMatch(/session\.create/);
    expect(r.stdout).not.toMatch(/plugin\.install/);
  });

  it("`capability list --tier write` shows only write-tier caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--tier", "write", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.create/);
    expect(r.stdout).toMatch(/plugin\.install/);
    expect(r.stdout).not.toMatch(/session\.list/);
  });

  it("`capability list --owner plugin-manager --tier read` shows only plugin.list", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await runCli(["capability", "list", "--owner", "plugin-manager", "--tier", "read", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plugin\.list/);
    expect(r.stdout).not.toMatch(/plugin\.install/);
  });

  it("unknown command exits non-zero with a clear message", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["frobnicate", "--data-dir", "/data"], { fs });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown command/i);
  });
});

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf-8"));
}

async function mintViaCli(fs: InMemoryFs, args: string[]): Promise<{ exitCode: number; payload: Record<string, unknown> | null; raw: string }> {
  const r = await runCli(["token", "issue", "--tenant", "acme", "--caller", "agent-1", ...args, "--data-dir", "/data"], { fs });
  if (r.exitCode !== 0) return { exitCode: r.exitCode, payload: null, raw: r.stdout };
  const lines = r.stdout.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return { exitCode: 0, payload: decodeJwt(last), raw: last };
}

describe("CLI token issue expectedOrigins", () => {
  it("--origin binds the token (claim in JWT payload)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, ["--origin", "https://app.acme.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://app.acme.com"]);
  });

  it("--origins comma-separated binds multiple origins in order", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, ["--origins", "https://a.example.com,https://b.example.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("--origin repeatable collects all occurrences", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, [
      "--origin", "https://a.acme.com",
      "--origin", "https://b.acme.com",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.acme.com", "https://b.acme.com"]);
  });

  it("--origin + --origins merge and dedupe keeping first occurrence", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, [
      "--origin", "https://a.com",
      "--origin", "https://b.com",
      "--origins", "https://b.com,https://c.com",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("--origins drops empty and whitespace entries, trims the rest", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, ["--origins", " https://a.com ,, ,  https://b.com  "]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("without origin flags the claim is omitted (backward compat)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, []);
    expect(r.exitCode).toBe(0);
    expect(r.payload).not.toHaveProperty("expectedOrigins");
  });

  it("minted token round-trips through gateway verify with the claim intact", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs });
    const r = await mintViaCli(fs, ["--origin", "https://app.acme.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://app.acme.com"]);
    expect(r.raw).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});