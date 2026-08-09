// CID:data-dir-007 - default data-dir resolver tests (surgical change 2026-08-09)
// Purpose: lock the ONE resolution chain — --data-dir > AGENTIDE_DATA_DIR >
//   config data_dir (repo|global) > global per-repo store. This is the spec
//   for the "no more .agentide/ in every repo" change.
import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultDataDir, repoKey, repoRoot, type DataDirOptions } from "../data-dir.js";
import { saveConfig } from "../config.js";

const ORIGINAL_CWD = process.cwd();
afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function home(): string {
  return mkdtempSync(join(tmpdir(), "agentide-dd-home-"));
}

function opts(h: string, extra: Partial<DataDirOptions> = {}): DataDirOptions {
  return { env: {}, home: h, argv: [], ...extra };
}

describe("data-dir: priority chain", () => {
  it("explicit --data-dir flag wins over everything", async () => {
    const h = home();
    try {
      const r = await defaultDataDir("/proj", opts(h, {
        argv: ["--data-dir", "/explicit"],
        env: { AGENTIDE_DATA_DIR: "/env" },
      }));
      expect(r).toBe(resolve("/explicit"));
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });

  it("AGENTIDE_DATA_DIR env wins over config + default", async () => {
    const h = home();
    try {
      const r = await defaultDataDir("/proj", opts(h, { env: { AGENTIDE_DATA_DIR: "/env" } }));
      expect(r).toBe(resolve("/env"));
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });

  it("config data_dir='repo' restores the legacy per-directory .agentide/data", async () => {
    const h = home();
    const cfg = join(h, "config.toml");
    writeFileSync(cfg, 'data_dir = "repo"\n');
    try {
      const r = await defaultDataDir("/proj", opts(h, { configOverride: cfg }));
      expect(r).toBe(resolve("/proj", ".agentide/data"));
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });

  it("absent config (or data_dir='global') defaults to the shared per-repo store", async () => {
    const h = home();
    const cwd = mkdtempSync(join(tmpdir(), "agentide-dd-repo-"));
    try {
      const r = await defaultDataDir(cwd, opts(h, { configOverride: join(h, "missing.toml") }));
      expect(r).toBe(join(h, ".local", "share", "agentide", await repoKey(cwd), "data"));
    } finally {
      rmSync(h, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("data-dir: repo key (global store isolation)", () => {
  it("two cwds inside one git root share a key; different repos get different keys", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "agentide-dd-repa-"));
    const rootB = mkdtempSync(join(tmpdir(), "agentide-dd-repb-"));
    try {
      mkdirSync(join(rootA, ".git"));
      mkdirSync(join(rootB, ".git"));
      mkdirSync(join(rootA, "sub"));
      expect(await repoKey(join(rootA, "sub"))).toBe(await repoKey(rootA));
      expect(await repoKey(rootA)).not.toBe(await repoKey(rootB));
      expect(await repoRoot(join(rootA, "sub"))).toBe(rootA);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("outside a repo, the cwd itself keys the store (stable per directory)", async () => {
    const d1 = mkdtempSync(join(tmpdir(), "agentide-dd-nogit1-"));
    const d2 = mkdtempSync(join(tmpdir(), "agentide-dd-nogit2-"));
    try {
      expect(await repoKey(d1)).toBe(await repoKey(d1));
      expect(await repoKey(d1)).not.toBe(await repoKey(d2));
    } finally {
      rmSync(d1, { recursive: true, force: true });
      rmSync(d2, { recursive: true, force: true });
    }
  });
});

describe("data-dir: cli integration — init lands in the global store, never in the repo", () => {
  it("`agentide init` (no flags) uses <home>/.local/share/agentide and creates NO .agentide in cwd", async () => {
    const { runCli } = await import("../index.js");
    const fs = {
      async readFile(): Promise<string> { throw new Error("ENOENT"); },
      async writeFile(): Promise<void> {},
      async exists(): Promise<boolean> { return false; },
    };
    const h = home();
    const cwd = mkdtempSync(join(tmpdir(), "agentide-dd-cwd-"));
    try {
      process.chdir(cwd);
      const stdoutWrites: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stdout.write;
      try {
        const r = await runCli(["init"], { fs: fs as never, home: h });
        expect(r.exitCode).toBe(0);
      } finally {
        process.stdout.write = origWrite;
      }
      const store = join(h, ".local", "share", "agentide", await repoKey(cwd), "data");
      expect(stdoutWrites.join("")).toContain(`Initialized Agentide in ${store}`);
      expect(existsSync(join(cwd, ".agentide"))).toBe(false);
    } finally {
      process.chdir(ORIGINAL_CWD);
      rmSync(h, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("data-dir: config key survives saveConfig (line-based merge)", () => {
  it("token refresh keeps the data_dir line", async () => {
    const h = home();
    try {
      process.chdir(h);
      saveConfig({ token: "new-token" }, { home: h });
      const text = readFileSync(join(h, ".config", "platform", "config.toml"), "utf8");
      expect(text).not.toContain("data_dir");
      expect(text).toContain('token = "new-token"');
      // now WITH data_dir present beforehand:
      writeFileSync(join(h, ".config", "platform", "config.toml"), 'gateway_url = "ws://x"\ndata_dir = "repo"\n');
      saveConfig({ token: "t2" }, { home: h });
      const after = readFileSync(join(h, ".config", "platform", "config.toml"), "utf8");
      expect(after).toContain('data_dir = "repo"');
      expect(after).toContain('token = "t2"');
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });
});