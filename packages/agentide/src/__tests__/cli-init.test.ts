// Phase 1 (D-78): agentide init --data-dir <fresh> must create the directory
// (not just the gateway-secret file). This is the first-run UX fix.
// The test uses a HybridFs: in-memory for read/write/exists (so gateway state
// lives in the test), but a REAL recursive mkdir so the filesystem-directory
// creation is observable — exactly what the production fs does.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "@spanexx/gateway-core";
import { runCli } from "../index.js";

class HybridFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) { const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  // CID:test-001 - the production fs implements mkdir (gateway-core
  // nodeFileSystem). This hybrid mirrors it: real dir creation on disk,
  // in-memory file map. Without mkdir, runInit would skip it entirely.
  mkdir(path: string): Promise<void> { mkdirSync(path, { recursive: true }); return Promise.resolve(); }
}

let TMP_ROOT = "";
beforeEach(() => { TMP_ROOT = mkdtempSync(join(tmpdir(), "agentide-init-")); });
afterEach(() => {
  if (TMP_ROOT && existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("CLI init (D-78)", () => {
  it("creates a non-existent data dir before writing the gateway-secret", async () => {
    const dataDir = join(TMP_ROOT, "fresh");
    expect(existsSync(dataDir)).toBe(false);
    const fs = new HybridFs();
    const r = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: TMP_ROOT });
    expect(r.exitCode).toBe(0);
    // The real filesystem dir now exists (mkdir was called on the hybrid).
    expect(existsSync(dataDir)).toBe(true);
    expect(statSync(dataDir).isDirectory()).toBe(true);
    // The gateway-secret is written via the FileSystem impl (in-memory map).
    expect(fs.files.has(`${dataDir}/gateway-secret`)).toBe(true);
  });

  it("is idempotent when the data dir already exists", async () => {
    const dataDir = join(TMP_ROOT, "preexisting");
    mkdirSync(dataDir, { recursive: true });
    expect(existsSync(dataDir)).toBe(true);
    const fs = new HybridFs();
    const r = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: TMP_ROOT });
    expect(r.exitCode).toBe(0);
    // Existing dir is unchanged; secret still written via the fs impl.
    expect(existsSync(dataDir)).toBe(true);
    expect(fs.files.has(`${dataDir}/gateway-secret`)).toBe(true);
  });

  it("creates nested non-existent dirs (recursive mkdir)", async () => {
    const dataDir = join(TMP_ROOT, "a", "b", "c", "d");
    expect(existsSync(dataDir)).toBe(false);
    const fs = new HybridFs();
    const r = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: TMP_ROOT });
    expect(r.exitCode).toBe(0);
    expect(existsSync(dataDir)).toBe(true);
    expect(statSync(dataDir).isDirectory()).toBe(true);
  });
});

// F2a (operator-cli-fixes): init persists the bootstrap token to the config
// file so remote commands work in every terminal right after init — mirrors
// the D-112 behavior of `token issue`.
describe("CLI init config persistence (F2a)", () => {
  it("saves the bootstrap token to ~/.config/platform/config.toml", async () => {
    const dataDir = join(TMP_ROOT, "cfg");
    const fs = new HybridFs();
    const r = await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs, home: TMP_ROOT });
    expect(r.exitCode).toBe(0);
    const cfg = join(TMP_ROOT, ".config", "platform", "config.toml");
    expect(existsSync(cfg)).toBe(true);
    const text = readFileSync(cfg, "utf8");
    // JWT shape (three dot-separated base64url segments), quoted in the toml
    expect(text).toMatch(/token = "[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/);
  });

  it("--config override redirects the config write", async () => {
    const dataDir = join(TMP_ROOT, "cfg2");
    const customCfg = join(TMP_ROOT, "custom", "my.toml");
    const fs = new HybridFs();
    const r = await runCli(
      ["init", "--data-dir", dataDir, "--default-tenant", "acme", "--config", customCfg],
      { fs, home: TMP_ROOT },
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(customCfg)).toBe(true);
    expect(readFileSync(customCfg, "utf8")).toMatch(/token = "[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/);
  });
});