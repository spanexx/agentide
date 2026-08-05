import { describe, expect, it, afterEach } from "vitest";
import { createEventBus } from "@spanexx/event-bus";
import { issueToken, type CanonicalInvocation, type CanonicalResponse, type Clock, type FileSystem, type Gateway } from "@spanexx/gateway-core";
import { createWebSocketAdapter } from "@spanexx/adapter-websocket";
import { runCli } from "../index.js";

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
  it("prints the version and exits 0 with --version", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["--version"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints the version with -v", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["-v"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

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

  it("init creates default tenant + secret + prints bootstrap token", async () => {
    const mem = new InMemoryFs();
    // init writes the token directly to process.stdout (so it can auto-clear
    // on Enter / 30s). Capture it for the test.
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      const r = await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs: mem });
      expect(r.exitCode).toBe(0);
      expect(mem.files.has("/data/gateway-secret")).toBe(true);
      const captured = stdoutWrites.join("");
      expect(captured).toMatch(/Initialized Agentide/);
      expect(captured).toMatch(/Default tenant: acme/);
      // The token is a JWT (header.payload.signature).
      // Strip ANSI escapes before matching since printTokenWithClear adds them.
      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
      const tokenLine = captured.split("\n").find(
        (l) => {
          const clean = stripAnsi(l);
          return clean.startsWith("eyJ") || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(clean);
        }
      ) ?? "";
      expect(tokenLine).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    } finally {
      process.stdout.write = origWrite;
    }
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

// Remote consumer dispatch: `--url` switches aliases/status/capability list
// onto the live-gateway path (GRILL Q2 / Q3). Non-TTY here → compact JSON.
describe("CLI remote dispatch (--url)", () => {
  const SECRET = new TextEncoder().encode("cli-dispatch-secret");
  const adapters: ReturnType<typeof createWebSocketAdapter>[] = [];

  class CliTestClock implements Clock {
    nowValue = 1_700_000_000_000;
    now(): number { return this.nowValue; }
    setTimeout(callback: () => void, delayMs: number): number { return setTimeout(callback, delayMs) as unknown as number; }
    clearTimeout(handle: number): void { clearTimeout(handle); }
  }

  async function startAdapter(handler?: (req: CanonicalInvocation) => Promise<CanonicalResponse>): Promise<string> {
    const gateway: Gateway = {
      listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
      handleInvocation: handler ?? (async (req): Promise<CanonicalResponse> => {
        switch (req.capability.name) {
          case "session.list": return { output: [] };
          case "gateway.status": return { output: { status: "ok", tenantCount: 1, pluginCount: 1, uptimeMs: 7 } };
          case "system.health": return { output: { status: "ok" } };
          default: return { output: { name: req.capability.name } };
        }
      }),
    } as unknown as Gateway;
    const adapter = createWebSocketAdapter(gateway, createEventBus(), {
      tokenSecret: SECRET,
      port: 0,
      clock: new CliTestClock(),
    });
    await adapter.start();
    adapters.push(adapter);
    const address = adapter.address();
    return `ws://127.0.0.1:${address!.port}/ws`;
  }

  function tok(): string {
    const clock = new CliTestClock();
    return issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 60_000,
    }, SECRET, clock);
  }

  afterEach(async () => {
    await Promise.all(adapters.splice(0).map((a) => a.stop()));
  });

  it("help lists the remote commands", async () => {
    const r = await runCli(["--help"], { fs: new InMemoryFs() });
    expect(r.stdout).toMatch(/Remote \(live gateway over websocket/);
    expect(r.stdout).toMatch(/agentide sessions/);
    expect(r.stdout).toMatch(/agentide invoke <cap>/);
    expect(r.stdout).toMatch(/agentide watch <alias>/);
  });

  it("`sessions --url` dispatches to the consumer (compact JSON)", async () => {
    const url = await startAdapter();
    const r = await runCli(["sessions", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("[]");
  });

  it("`status --url` hits gateway.status remotely instead of local status", async () => {
    const url = await startAdapter();
    const r = await runCli(["status", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok","tenantCount":1,"pluginCount":1,"uptimeMs":7}');
  });

  it("`capability list --url` dispatches to the consumer", async () => {
    const url = await startAdapter(async (req) => ({ output: [{ name: "gateway.status", version: "1.0.0", tier: "read" }] }));
    const r = await runCli(["capability", "list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('[{"name":"gateway.status","version":"1.0.0","tier":"read"}]');
  });

  it("`health --url` hits system.health", async () => {
    const url = await startAdapter();
    const r = await runCli(["health", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok"}');
  });

  it("`invoke --url` returns the gateway output", async () => {
    const url = await startAdapter();
    const r = await runCli(["invoke", "product.list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"name":"product.list"}');
  });
});

// CID:cli-002..007 - Phase 5 (BI[29]) client subcommand tests

describe("CLI client subcommand", () => {
  it("`client create` writes the secret to a file and prints only the path", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(
      ["client", "create", "--tenant", "acme", "--name", "nightly-build", "--data-dir", "/data"],
      { fs },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/created/i);
    expect(r.stdout).toMatch(/secret_at: \/data\/clients\/.secret-cli_/);
    // The plaintext secret must NOT be printed unless --print is given.
    expect(r.stdout).not.toMatch(/eyJ/);
    // The secret file was actually written.
    const written = [...fs.files.keys()].find((p) => p.startsWith("/data/clients/.secret-cli_"));
    expect(written).toBeDefined();
  });

  it("`client create --print` prints the plaintext secret", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(
      ["client", "create", "--tenant", "acme", "--name", "debug-helper", "--print", "--data-dir", "/data"],
      { fs },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plaintext_secret:/);
  });

  it("`client list --tenant` shows id + name for created clients", async () => {
    const fs = new InMemoryFs();
    await runCli(["client", "create", "--tenant", "acme", "--name", "n1", "--data-dir", "/data"], { fs });
    await runCli(["client", "create", "--tenant", "beta", "--name", "n2", "--data-dir", "/data"], { fs });
    const r = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/cli_/);
    expect(r.stdout).toMatch(/n1/);
    expect(r.stdout).not.toMatch(/n2/);
  });

  it("`client grant` issues a registration code with an expiry", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(
      ["client", "grant", "--tenant", "acme", "--name", "storefront", "--data-dir", "/data"],
      { fs },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/rc_/);
    expect(r.stdout).toMatch(/expires_at/);
  });

  it("`client revoke` flips the client to revoked (visible in list)", async () => {
    const fs = new InMemoryFs();
    await runCli(["client", "create", "--tenant", "acme", "--name", "leaky", "--data-dir", "/data"], { fs });
    const listBefore = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs });
    expect(listBefore.stdout).toMatch(/revoked: false/);
    const clientId = listBefore.stdout.match(/cli_[A-Za-z0-9_-]+/)?.[0] ?? "";
    const r = await runCli(["client", "revoke", "--client-id", clientId, "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    const listAfter = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs });
    expect(listAfter.stdout).toMatch(/revoked.+true/);
  });

  it("`client rotate` issues a new secret and prints rotated", async () => {
    const fs = new InMemoryFs();
    await runCli(["client", "create", "--tenant", "acme", "--name", "rotator", "--data-dir", "/data"], { fs });
    const list = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs });
    const clientId = list.stdout.match(/cli_[A-Za-z0-9_-]+/)?.[0] ?? "";
    const r = await runCli(["client", "rotate", "--client-id", clientId, "--data-dir", "/data"], { fs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/rotated/);
  });
});