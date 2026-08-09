// CID:shell-010 - interactive shell tests (IMPL Phase 5, PRD-TRD S1/S7/S8)
// Purpose: the shell is the same dispatcher as one-shot behind a readline
//   loop. These tests drive it with scripted stdin (the ShellIO seam) and
//   assert the S1/S7/S8 behaviors: builtins, prefix tolerance, per-directory
//   history, Tab completion (completer function), Ctrl-C stays in, exit codes.
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable, PassThrough } from "node:stream";
import { runShell, makeCompleter, type ShellIO } from "../shell.js";
import { repoKey } from "../data-dir.js";
import { runCli } from "../index.js";
import type { CliOptions } from "../cli-types.js";

const ORIGINAL_CWD = process.cwd();
const tempHomes: string[] = [];
function tempHome(): string {
  const h = mkdtempSync(join(tmpdir(), "agentide-shell-home-"));
  tempHomes.push(h);
  return h;
}
afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  for (const h of tempHomes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }
});

// Global-store helper: the data dir for a cwd under a given temp home
// (mirrors the ONE resolver in data-dir.ts — only the store path differs).
async function storeDataDir(home: string, cwd: string): Promise<string> {
  return join(home, ".local", "share", "agentide", await repoKey(cwd), "data");
}

// --- helpers ---------------------------------------------------------------

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentide-shell-"));
}

// Scripted stdin + captured stdout for one shell session.
// Scripted stdin + captured stdout for one shell session. Every session gets
// its OWN temp home (the global store must never touch the real machine home).
async function driveShell(
  lines: string,
  opts: { fs?: CliOptions["fs"]; home?: string; pidFile?: string } = {},
  cwd?: string,
): Promise<{ output: string; exitCode: number; home: string }> {
  const input = Readable.from([lines]);
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk: string | Uint8Array, _enc, cb) {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      cb();
    },
  });
  const io: ShellIO = { input, output };
  const fs = opts.fs ?? makeFs();
  const home = opts.home ?? tempHome();
  const r = await runShell(cwd ?? process.cwd(), { fs, home, ...(opts.pidFile ? { pidFile: opts.pidFile } : {}) }, io);
  return { output: chunks.join(""), exitCode: r.exitCode, home };
}

function makeFs(): CliOptions["fs"] {
  return {
    async readFile(): Promise<string> { throw new Error("ENOENT"); },
    async writeFile(): Promise<void> {},
    async exists(): Promise<boolean> { return false; },
  };
}

// --- S1/S8: builtins ---------------------------------------------------------

describe("shell: builtins (PRD-TRD S1/S8)", () => {
  it("help prints the shell help; exit leaves with code 0", async () => {
    const { output, exitCode } = await driveShell("help\nexit\n");
    expect(exitCode).toBe(0);
    expect(output).toMatch(/agentide interactive shell/);
    expect(output).toMatch(/Commands:/);
  });

  it("quit leaves with code 0", async () => {
    const { exitCode } = await driveShell("quit\n");
    expect(exitCode).toBe(0);
  });

  it("pwd prints the working directory", async () => {
    const dir = tempDir();
    try {
      const { output } = await driveShell("pwd\nexit\n", {}, dir);
      expect(output).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clear emits the ANSI clear sequence", async () => {
    const { output } = await driveShell("clear\nexit\n");
    expect(output).toContain("\x1b[2J\x1b[H");
  });

  it("cd switches the data-dir context (S8)", async () => {
    const dir = tempHome();
    const other = mkdtempSync(join(tmpdir(), "agentide-shell-other-"));
    const home = tempHome();
    try {
      // PassThrough keeps the stream open so the post-cd restart can show
      // its new prompt and read the exit line.
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk: string | Uint8Array, _enc, cb) {
          chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
          cb();
        },
      });
      const p = runShell(dir, { fs: makeFs(), home }, { input, output });
      input.write(`cd ${other}\n`);
      setTimeout(() => {
        input.write("exit\n");
        input.end();
      }, 50);
      await p;
      const out = chunks.join("");
      const expected = await storeDataDir(home, other);
      expect(out).toContain(`context: ${expected}`);
      // The restarted session prompts with the NEW context.
      expect(out).toContain(`agentide (${expected})> `);
      // The NEW dir NEVER gets a .agentide folder (global store).
      expect(existsSync(join(other, ".agentide"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("history builtin lists the loaded history file", async () => {
    const dir = tempDir();
    const home = tempHome();
    try {
      const store = await storeDataDir(home, dir);
      mkdirSync(store, { recursive: true });
      writeFileSync(join(store, "shell-history"), "gateway\nstatus\n");
      const { output } = await driveShell("history\nexit\n", { home }, dir);
      expect(output).toContain("gateway");
      expect(output).toContain("status");
      expect(existsSync(join(dir, ".agentide"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- S8: prefix tolerance + dispatch -----------------------------------------

describe("shell: dispatch + prefix tolerance (PRD-TRD S8)", () => {
  it("bare `agentide` inside the shell gets the friendly message", async () => {
    const { output } = await driveShell("agentide\nexit\n");
    expect(output).toContain("(you are already in the agentide shell — type help)");
  });

  it("`agentide gateway` (prefixed) dispatches to the group help", async () => {
    const { output } = await driveShell("agentide gateway\nexit\n");
    expect(output).toContain("agentide gateway —");
    expect(output).toContain("Subcommands:");
  });

  it("`gateway` (bare) dispatches to the group help", async () => {
    const { output } = await driveShell("gateway\nexit\n");
    expect(output).toContain("Subcommands:");
  });

  it("an offline command dispatched from the shell is refused (worlds hold)", async () => {
    const { output } = await driveShell("tenant list --url ws://x\nexit\n");
    expect(output).toContain("is offline (data-dir only)");
  });

  it("a live command without a gateway says 'gateway not running' (pid seam)", async () => {
    const dir = tempDir();
    try {
      const { output } = await driveShell("gateway status\nexit\n", { pidFile: join(dir, "no.pid") });
      expect(output).toContain("gateway not running (start it with: agentide gateway start)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- S7: history file ---------------------------------------------------------

describe("shell: history file (PRD-TRD S7/S8)", () => {
  it("commands are appended to <store>/shell-history (every line incl. exit, per sim)", async () => {
    const dir = tempDir();
    const home = tempHome();
    try {
      const { output } = await driveShell("gateway\nhelp\nexit\n", { home }, dir);
      expect(output).toContain("Subcommands:"); // gateway dispatched fine
      const dataDir = await storeDataDir(home, dir);
      const historyFile = join(dataDir, "shell-history");
      expect(existsSync(historyFile)).toBe(true);
      const lines = readFileSync(historyFile, "utf8").split("\n").filter(Boolean);
      expect(lines).toEqual(["gateway", "help", "exit"]);
      expect(existsSync(join(dir, ".agentide"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("consecutive duplicate commands are deduped (S8)", async () => {
    const dir = tempDir();
    const home = tempHome();
    try {
      await driveShell("gateway\ngateway\nhelp\nexit\n", { home }, dir);
      const lines = readFileSync(join(await storeDataDir(home, dir), "shell-history"), "utf8").split("\n").filter(Boolean);
      expect(lines).toEqual(["gateway", "help", "exit"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("history persists across shell sessions (reload on start)", async () => {
    const dir = tempDir();
    const home = tempHome();
    try {
      await driveShell("gateway\nexit\n", { home }, dir);
      // Second session (same home): history builtin sees first session's command.
      const { output } = await driveShell("history\nexit\n", { home }, dir);
      expect(output).toContain("gateway");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- S7: Tab completion --------------------------------------------------------

describe("shell: Tab completion (PRD-TRD S7)", () => {
  it("completes group names at position 0", async () => {
    const completer = makeCompleter("/tmp");
    const [matches, current] = await completer("gate");
    expect(current).toBe("gate");
    expect(matches).toContain("gateway");
  });

  it("completes subcommands after a group (gateway sta<Tab> → start)", async () => {
    const completer = makeCompleter("/tmp");
    const [matches, current] = await completer("gateway sta");
    expect(current).toBe("sta");
    expect(matches).toContain("start");
    expect(matches).toContain("status");
  });

  it("completes tenant ids from tenants.json (tenant delete acm<Tab> → acme)", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "tenants.json"), JSON.stringify([{ id: "acme" }, { id: "beta" }]));
      const completer = makeCompleter(dir);
      const [matches, current] = await completer("tenant delete acm");
      expect(current).toBe("acm");
      expect(matches).toContain("acme");
      expect(matches).not.toContain("beta");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT complete filesystem paths (S7 lock)", async () => {
    const completer = makeCompleter("/tmp");
    const [matches] = await completer("tenant delete /tm");
    expect(matches).toEqual([]);
  });
});

// --- S8: Ctrl-C ----------------------------------------------------------------

describe("shell: Ctrl-C behavior (PRD-TRD S8)", () => {
  it("Ctrl-C (\\x03) clears the line and stays in the shell; exit still works", async () => {
    const input = Readable.from(["hello\x03exit\n"]);
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: string | Uint8Array, _enc, cb) {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    });
    const r = await runShell(process.cwd(), { fs: makeFs(), home: tempHome() }, { input, output });
    expect(r.exitCode).toBe(0);
    const out = chunks.join("");
    // The shell survived the SIGINT and processed the exit line — the prompt
    // appears at least twice (start + after SIGINT), meaning it did not exit.
    expect(out.match(/agentide \(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// --- S2: bare agentide TTY/non-TTY dispatch (runCli wiring) ----------------------

describe("shell: bare `agentide` wiring in runCli (PRD-TRD S1/S2)", () => {
  it("bare agentide + non-TTY stdin → help, exit 0 (S2)", async () => {
    const r = await runCli([], {
      fs: makeFs(),
      stdin: { isTTY: false } as NodeJS.ReadStream,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/agentide/);
  });

  it("bare agentide + TTY stdin → the shell prompt (S1)", async () => {
    const input = Readable.from(["exit\n"]) as unknown as NodeJS.ReadStream;
    Object.defineProperty(input, "isTTY", { value: true });
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: string | Uint8Array, _enc, cb) {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        cb();
      },
    }) as NodeJS.WritableStream;
    const r = await runCli([], { fs: makeFs(), home: tempHome(), stdin: input, stdout: output });
    expect(r.exitCode).toBe(0);
    expect(chunks.join("")).toContain("agentide (");
  });
});
