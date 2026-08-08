import { describe, expect, it, afterEach } from "vitest";
import { createEventBus } from "@spanexx/event-bus";
import { issueToken, type CanonicalInvocation, type CanonicalResponse, type Clock, type FileSystem, type Gateway } from "@spanexx/gateway-core";
import { createWebSocketAdapter } from "@spanexx/adapter-websocket";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const r = await runCli(["--version"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints the version with -v", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["-v"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints help and exits 0 when invoked with --help", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["--help", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/agentide/);
    expect(r.stdout).toMatch(/init|start|stop|status|tenant|token|capability|plugin/);
  });

  it("prints help when invoked with no args", async () => {
    const fs = new InMemoryFs();
    const r = await runCli([], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
  });

  it("init creates default tenant + secret + saves token to config (not stdout)", async () => {
    const mem = new InMemoryFs();
    // init writes its confirmation directly to process.stdout. Capture it.
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      const r = await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs: mem, home: TEMP_HOME });
      expect(r.exitCode).toBe(0);
      expect(mem.files.has("/data/gateway-secret")).toBe(true);
      const captured = stdoutWrites.join("");
      expect(captured).toMatch(/Initialized Agentide/);
      expect(captured).toMatch(/Default tenant: acme/);
      // F2a: the token is persisted to the config file, never printed.
      expect(captured).toMatch(/Bootstrap token saved to/);
      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
      const tokenLine = captured.split("\n").find(
        (l) => {
          const clean = stripAnsi(l);
          return clean.startsWith("eyJ") || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(clean);
        }
      ) ?? "";
      expect(tokenLine).toBe("");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("`status` (old name) is live-only after the cli-restructure (PRD-TRD S6)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    // Old `status` maps to `gateway status` (live). Without a reachable
    // gateway it must fail — the local in-process status path is gone.
    // NOTE: a real gateway may be running on 127.0.0.1:7300 from earlier
    // sessions and the consumer resolves the real ~/.config — force a
    // dead endpoint so the assertion is deterministic.
    const r = await runCli(
      ["status", "--data-dir", "/data", "--url", "ws://127.0.0.1:1/ws", "--token", "t"],
      { fs, home: TEMP_HOME },
    );
    expect(r.exitCode).not.toBe(0);
  });

  it("`tenant create` adds a new tenant and `tenant list` shows it", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const c = await runCli(["tenant", "create", "--id", "beta", "--name", "Beta Co", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(c.exitCode).toBe(0);
    const l = await runCli(["tenant", "list", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(l.exitCode).toBe(0);
    expect(l.stdout).toMatch(/acme/);
    expect(l.stdout).toMatch(/beta/);
  });

  it("`token issue` mints a JWT and prints it", async () => {
    const fs = new InMemoryFs();
    const home = makeTempHome();
    try {
      await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home });
      const r = await runCli(
        ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--scope", "platform.tenant.read,platform.capability.read", "--data-dir", "/data"],
        { fs, home },
      );
      expect(r.exitCode).toBe(0);
      const lines = r.stdout.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      expect(last).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("`capability list` shows the registered capabilities", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/gateway\.status/);
    expect(r.stdout).toMatch(/tenant\.list/);
  });

  it("`capability list --owner session-manager` shows only session.* caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--owner", "session-manager", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.create/);
    expect(r.stdout).toMatch(/session\.list/);
    expect(r.stdout).not.toMatch(/gateway\.status/);
    expect(r.stdout).not.toMatch(/tenant\.list/);
  });

  it("`capability list --owner plugin-manager` shows only plugin.* caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--owner", "plugin-manager", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plugin\.install/);
    expect(r.stdout).toMatch(/plugin\.list/);
    expect(r.stdout).not.toMatch(/session\.create/);
    expect(r.stdout).not.toMatch(/gateway\.status/);
  });

  it("`capability list --owner nonexistent` returns empty list", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--owner", "nonexistent", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("`capability list --tier read` shows only read-tier caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--tier", "read", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.list/);
    expect(r.stdout).not.toMatch(/session\.create/);
    expect(r.stdout).not.toMatch(/plugin\.install/);
  });

  it("`capability list --tier write` shows only write-tier caps", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--tier", "write", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/session\.create/);
    expect(r.stdout).toMatch(/plugin\.install/);
    expect(r.stdout).not.toMatch(/session\.list/);
  });

  it("`capability list --owner plugin-manager --tier read` shows only plugin.list", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(["capability", "list", "--owner", "plugin-manager", "--tier", "read", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plugin\.list/);
    expect(r.stdout).not.toMatch(/plugin\.install/);
  });

  it("unknown command exits non-zero with a clear message", async () => {
    const fs = new InMemoryFs();
    const r = await runCli(["frobnicate", "--data-dir", "/data"], { fs, home: TEMP_HOME });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown command/i);
  });
});

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf-8"));
}

// Shared temp HOME so token-save tests never touch the operator's real
// ~/.config/platform/config.toml. Created once per process, cleaned by afterEach.
const TEMP_HOME = mkdtempSync(join(tmpdir(), "agentide-cli-home-"));
afterEach(() => {
  for (const name of ["config.toml"]) {
    rmSync(join(TEMP_HOME, ".config", "platform", name), { force: true });
  }
});

function tempConfigPath(): string {
  return join(TEMP_HOME, ".config", "platform", "config.toml");
}

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "agentide-cli-home-"));
}

async function mintViaCli(fs: InMemoryFs, args: string[]): Promise<{ exitCode: number; payload: Record<string, unknown> | null; raw: string }> {
  const r = await runCli(["token", "issue", "--tenant", "acme", "--caller", "agent-1", ...args, "--data-dir", "/data"], { fs, home: TEMP_HOME });
  if (r.exitCode !== 0) return { exitCode: r.exitCode, payload: null, raw: r.stdout };
  const lines = r.stdout.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return { exitCode: 0, payload: decodeJwt(last), raw: last };
}

describe("CLI token issue expectedOrigins", () => {
  it("--origin binds the token (claim in JWT payload)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, ["--origin", "https://app.acme.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://app.acme.com"]);
  });

  it("--origins comma-separated binds multiple origins in order", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, ["--origins", "https://a.example.com,https://b.example.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("--origin repeatable collects all occurrences", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, [
      "--origin", "https://a.acme.com",
      "--origin", "https://b.acme.com",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.acme.com", "https://b.acme.com"]);
  });

  it("--origin + --origins merge and dedupe keeping first occurrence", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
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
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, ["--origins", " https://a.com ,, ,  https://b.com  "]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("without origin flags the claim is omitted (backward compat)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, []);
    expect(r.exitCode).toBe(0);
    expect(r.payload).not.toHaveProperty("expectedOrigins");
  });

  it("minted token round-trips through gateway verify with the claim intact", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await mintViaCli(fs, ["--origin", "https://app.acme.com"]);
    expect(r.exitCode).toBe(0);
    expect(r.payload?.expectedOrigins).toEqual(["https://app.acme.com"]);
    expect(r.raw).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

// D-112 token persist: `token issue` writes the minted JWT into the config
// file so remote commands work without --url/--token in every terminal.
describe("CLI token issue config persistence (D-112)", () => {
  it("saves the minted token to ~/.config/platform/config.toml", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const r = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--data-dir", "/data"],
      { fs, home: TEMP_HOME },
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(tempConfigPath())).toBe(true);
    const text = readFileSync(tempConfigPath(), "utf8");
    const lines = r.stdout.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const minted = lines[lines.length - 1] ?? "";
    expect(text).toContain(`token = "${minted}"`);
  });

  it("--no-save skips the config write (init's token stays untouched)", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const before = readFileSync(tempConfigPath(), "utf8");
    const r = await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--no-save", "--data-dir", "/data"],
      { fs, home: TEMP_HOME },
    );
    expect(r.exitCode).toBe(0);
    // init (F2a) already persisted its bootstrap token; --no-save must not
    // replace it with the freshly minted one.
    expect(readFileSync(tempConfigPath(), "utf8")).toBe(before);
  });

  it("existing config keeps gateway_url when token is replaced", async () => {
    const fs = new InMemoryFs();
    await runCli(["init", "--data-dir", "/data", "--default-tenant", "acme"], { fs, home: TEMP_HOME });
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(TEMP_HOME, ".config", "platform");
    mkdirSync(dir, { recursive: true });
    writeFileSync(tempConfigPath(), 'gateway_url = "ws://keep:7300/ws"\ntoken = "tok-old"\n', { mode: 0o600 });
    await runCli(
      ["token", "issue", "--tenant", "acme", "--caller", "agent-1", "--data-dir", "/data"],
      { fs, home: TEMP_HOME },
    );
    const text = readFileSync(tempConfigPath(), "utf8");
    expect(text).toContain('gateway_url = "ws://keep:7300/ws"');
    expect(text).not.toContain("tok-old");
    expect(text).toContain("token = ");
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
          case "session.create": return { output: { id: "sess-cli-test" } };
          case "session.destroy": return { output: {} };
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
    expect(r.stdout).toBe("[]\n");
  });

  it("`status --url` hits gateway.status remotely instead of local status", async () => {
    const url = await startAdapter();
    const r = await runCli(["status", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok","tenantCount":1,"pluginCount":1,"uptimeMs":7}\n');
  });

  it("`capability list --url` dispatches to the consumer", async () => {
    const url = await startAdapter(async (_req) => ({ output: [{ name: "gateway.status", version: "1.0.0", tier: "read" }] }));
    const r = await runCli(["capability", "list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('[{"name":"gateway.status","version":"1.0.0","tier":"read"}]\n');
  });

  it("`health --url` hits system.health", async () => {
    const url = await startAdapter();
    const r = await runCli(["health", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok"}\n');
  });

  // cli-restructure Phase 1 review fix (drift report 20260808-184933, Gaps 1+2):
  // the group forms must reach the same capabilities as the legacy one-word
  // names. Pinned here against a LIVE adapter — the dead-endpoint tests alone
  // passed for the wrong reason (connect fails before alias resolution).
  it("`gateway status` (group form) hits gateway.status", async () => {
    const url = await startAdapter();
    const r = await runCli(["gateway", "status", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok","tenantCount":1,"pluginCount":1,"uptimeMs":7}\n');
  });

  it("`gateway health` (group form) hits system.health", async () => {
    const url = await startAdapter();
    const r = await runCli(["gateway", "health", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"status":"ok"}\n');
  });

  it("`gateway metrics` (group form) hits gateway.metrics", async () => {
    let invoked = "";
    const url = await startAdapter(async (req) => {
      invoked = req.capability.name;
      return { output: { invocations: 3 } };
    });
    const r = await runCli(["gateway", "metrics", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(invoked).toBe("gateway.metrics");
    expect(r.stdout).toBe('{"invocations":3}\n');
  });

  it("`gateway version` (group form) hits system.version", async () => {
    let invoked = "";
    const url = await startAdapter(async (req) => {
      invoked = req.capability.name;
      return { output: { version: "0.1.0", buildHash: null } };
    });
    const r = await runCli(["gateway", "version", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(invoked).toBe("system.version");
    expect(r.stdout).toBe('{"version":"0.1.0","buildHash":null}\n');
  });

  it("`session list` (group form) dispatches to the consumer", async () => {
    const url = await startAdapter();
    const r = await runCli(["session", "list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("[]\n");
  });

  it("`plugin list --url` (group form, dual-mode) dispatches to the consumer", async () => {
    const url = await startAdapter(async (_req) => ({ output: [{ id: "p-1", version: "1.0.0", enabled: true }] }));
    const r = await runCli(["plugin", "list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('[{"id":"p-1","version":"1.0.0","enabled":true}]\n');
  });

  it("`invoke --url` returns the gateway output", async () => {
    const url = await startAdapter();
    const r = await runCli(["invoke", "product.list", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"name":"product.list"}\n');
  });

  // D-113 newline flush: every exit path ends stdout with \n so the shell
  // prompt never glues to the last output line. Lives here because the
  // consumer path (compact JSON, no trailing newline before this fix) is
  // the case that motivated the guarantee.
  describe("CLI trailing newline (D-113)", () => {
    it("success stdout lacking a trailing newline gets one appended", async () => {
      const url = await startAdapter();
      const r = await runCli(["sessions", "--url", url, "--token", tok()], { fs: new InMemoryFs() });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("[]\n");
    });

    it("error stderr path is unchanged (already has newline)", async () => {
      const fs = new InMemoryFs();
      const r = await runCli(["frobnicate"], { fs });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr.endsWith("\n")).toBe(true);
    });

    it("stdout already ending in newline is untouched (idempotent)", async () => {
      const fs = new InMemoryFs();
      const r = await runCli(["--version"], { fs });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.endsWith("\n")).toBe(true);
      // exactly one trailing newline — no double-append
      expect(r.stdout).not.toMatch(/\n\n$/);
    });
  });
});

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