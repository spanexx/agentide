// Phase 1 + 2 — token hygiene (S6) + config precedence (S1).
// Tests drive resolveConfig through its public interface with a temp HOME
// (config file on disk, real perms via chmod) — no mocks of node:fs.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, Source } from "../config.js";

interface TempHome {
  dir: string;
  cfg: string; // config.toml path
}

function makeHome(): TempHome {
  const dir = mkdtempSync(join(tmpdir(), "agentide-cfg-"));
  mkdirSync(join(dir, ".config", "platform"), { recursive: true });
  return { dir, cfg: join(dir, ".config", "platform", "config.toml") };
}

function cleanup(home: TempHome): void {
  rmSync(home.dir, { recursive: true, force: true });
}

describe("config: token hygiene (S6)", () => {
  it("path:/absent → ConfigError exit 2 'token file not found'", async () => {
    const home = makeHome();
    try {
      await expect(
        resolveConfig({ argv: ["--url", "ws://x/ws", "--token", "path:/absent.jwt"], env: {}, home: home.dir }),
      ).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("token file not found") });
    } finally {
      cleanup(home);
    }
  });

  it("config file 0600 → no perms warning", async () => {
    const home = makeHome();
    try {
      writeFileSync(home.cfg, 'gateway_url = "ws://x/ws"\ntoken = "tok-1"\n');
      chmodSync(home.cfg, 0o600);
      const r = await resolveConfig({ argv: [], env: {}, home: home.dir });
      expect(r.token).toBe("tok-1");
      expect(r.warnings).toEqual([]);
    } finally {
      cleanup(home);
    }
  });

  it("config file 0644 → exactly one warning naming the file", async () => {
    const home = makeHome();
    try {
      writeFileSync(home.cfg, 'gateway_url = "ws://x/ws"\ntoken = "tok-1"\n');
      chmodSync(home.cfg, 0o644);
      const r = await resolveConfig({ argv: [], env: {}, home: home.dir });
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(home.cfg);
      expect(r.warnings[0]).toContain("group/world-readable");
    } finally {
      cleanup(home);
    }
  });

  it("path: token file 0644 → one warning naming the token file", async () => {
    const home = makeHome();
    try {
      const tok = join(home.dir, "tok.txt");
      writeFileSync(tok, "file-token\n");
      chmodSync(tok, 0o644);
      const r = await resolveConfig({
        argv: ["--url", "ws://x/ws", "--token", `path:${tok}`],
        env: {}, home: home.dir,
      });
      expect(r.token).toBe("file-token");
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(tok);
    } finally {
      cleanup(home);
    }
  });
});

describe("config: precedence (S1)", () => {
  it("flag beats env beats config file", async () => {
    const home = makeHome();
    try {
      writeFileSync(home.cfg, 'gateway_url = "ws://cfg/ws"\ntoken = "cfg-tok"\n');
      chmodSync(home.cfg, 0o600);
      const r = await resolveConfig({
        argv: ["--url", "ws://flag/ws", "--token", "flag-tok"],
        env: { PLATFORM_GATEWAY_URL: "ws://env/ws", PLATFORM_TOKEN: "env-tok" },
        home: home.dir,
      });
      expect(r.url).toBe("ws://flag/ws");
      expect(r.token).toBe("flag-tok");
      expect(r.urlSource).toBe(Source.Flag);
      expect(r.tokenSource).toBe(Source.Flag);
    } finally {
      cleanup(home);
    }
  });

  it("env beats config file", async () => {
    const home = makeHome();
    try {
      writeFileSync(home.cfg, 'gateway_url = "ws://cfg/ws"\ntoken = "cfg-tok"\n');
      chmodSync(home.cfg, 0o600);
      const r = await resolveConfig({
        argv: [],
        env: { PLATFORM_GATEWAY_URL: "ws://env/ws", PLATFORM_TOKEN: "env-tok" },
        home: home.dir,
      });
      expect(r.url).toBe("ws://env/ws");
      expect(r.token).toBe("env-tok");
      expect(r.urlSource).toBe(Source.Env);
      expect(r.tokenSource).toBe(Source.Env);
    } finally {
      cleanup(home);
    }
  });

  it("config file only → both from file", async () => {
    const home = makeHome();
    try {
      writeFileSync(home.cfg, 'gateway_url = "ws://cfg/ws"\ntoken = "cfg-tok"\n');
      chmodSync(home.cfg, 0o600);
      const r = await resolveConfig({ argv: [], env: {}, home: home.dir });
      expect(r.url).toBe("ws://cfg/ws");
      expect(r.token).toBe("cfg-tok");
      expect(r.urlSource).toBe(Source.ConfigFile);
      expect(r.tokenSource).toBe(Source.ConfigFile);
    } finally {
      cleanup(home);
    }
  });

  it("missing URL + non-TTY → exit 2 with the locked message", async () => {
    const home = makeHome();
    try {
      await expect(
        resolveConfig({ argv: ["--token", "tok"], env: {}, isTTY: false, home: home.dir }),
      ).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining("gateway URL required"),
      });
    } finally {
      cleanup(home);
    }
  });

  it("missing token + non-TTY → exit 2", async () => {
    const home = makeHome();
    try {
      await expect(
        resolveConfig({ argv: ["--url", "ws://x/ws"], env: {}, isTTY: false, home: home.dir }),
      ).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining("token required"),
      });
    } finally {
      cleanup(home);
    }
  });

  it("--config <path> overrides the default path", async () => {
    const home = makeHome();
    try {
      const alt = join(home.dir, "alt.toml");
      writeFileSync(alt, 'gateway_url = "ws://alt/ws"\ntoken = "alt-tok"\n');
      chmodSync(alt, 0o600);
      const r = await resolveConfig({
        argv: ["--config", alt],
        env: {}, home: home.dir, cwd: home.dir,
      });
      expect(r.url).toBe("ws://alt/ws");
      expect(r.token).toBe("alt-tok");
    } finally {
      cleanup(home);
    }
  });

  it("unknown keys in config.toml are ignored", async () => {
    const home = makeHome();
    try {
      writeFileSync(
        home.cfg,
        'gateway_url = "ws://x/ws"\ntoken = "tok"\nmystery = 42\n[profiles.staging]\ngateway_url = "ws://other/ws"\n',
      );
      chmodSync(home.cfg, 0o600);
      const r = await resolveConfig({ argv: [], env: {}, home: home.dir });
      expect(r.url).toBe("ws://x/ws");
      expect(r.token).toBe("tok");
    } finally {
      cleanup(home);
    }
  });

  it("missing config file + no env + no flag → exit 2 (not a crash)", async () => {
    const home = makeHome();
    try {
      await expect(
        resolveConfig({ argv: [], env: {}, isTTY: false, home: home.dir }),
      ).rejects.toMatchObject({ exitCode: 2 });
    } finally {
      cleanup(home);
    }
  });

  it("path: token from env source works and is marked Env", async () => {
    const home = makeHome();
    try {
      const tok = join(home.dir, "envtok.txt");
      writeFileSync(tok, "env-file-token\n");
      chmodSync(tok, 0o600);
      const r = await resolveConfig({
        argv: ["--url", "ws://x/ws"],
        env: { PLATFORM_TOKEN: `path:${tok}` },
        home: home.dir,
      });
      expect(r.token).toBe("env-file-token");
      expect(r.tokenSource).toBe(Source.Env);
    } finally {
      cleanup(home);
    }
  });
});
