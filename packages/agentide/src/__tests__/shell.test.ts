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
import { runCli } from "../index.js";
import type { CliOptions } from "../cli-types.js";

const ORIGINAL_CWD = process.cwd();
afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

// --- helpers ---------------------------------------------------------------

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentide-shell-"));
}

// Scripted stdin + captured stdout for one shell session.
async function driveShell(
  lines: string,
  opts: Partial<CliOptions> = {},
  cwd?: string,
): Promise<{ output: string; exitCode: number }> {
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
  const r = await runShell(cwd ?? process.cwd(), { fs, ...opts }, io);
  return { output: chunks.join(""), exitCode: r.exitCode };
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

  it("cd switches the data-dir context and reloads history (S8)", async () => {
    const dir = tempDir();
    const other = mkdtempSync(join(tmpdir(), "agentide-shell-other-"));
    try {
      // PassThrough keeps the stream open so the post-cd restart can show
      // its new prompt and read the exit line (scripted Readable.from would
      // be exhausted and the restart exits immediately).
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk: string | Uint8Array, _enc, cb) {
          chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
          cb();
        },
      });
      const p = runShell(dir, { fs: makeFs() }, { input, output });
      input.write(`cd ${other}\n`);
      setTimeout(() => {
        input.write("exit\n");
        input.end();
      }, 50);
      await p;
      const out = chunks.join("");
      expect(out).toContain(`context: ${join(other, ".agentide/data")}`);
      // The restarted session prompts with the NEW context.
      expect(out).toContain(`agentide (${join(other, ".agentide/data")})> `);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("history builtin lists the loaded history file", async () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, ".agentide/data"), { recursive: true });
      writeFileSync(join(dir, ".agentide/data", "shell-history"), "gateway\nstatus\n");
      const { output } = await driveShell("history\nexit\n", {}, dir);
      expect(output).toContain("gateway");
      expect(output).toContain("status");
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
  it("commands are appended to <dataDir>/shell-history (every line incl. exit, per sim)", async () => {
    const dir = tempDir();
    try {
      const { output } = await driveShell("gateway\nhelp\nexit\n", {}, dir);
      expect(output).toContain("Subcommands:"); // gateway dispatched fine
      const historyFile = join(dir, ".agentide/data", "shell-history");
      expect(existsSync(historyFile)).toBe(true);
      const lines = readFileSync(historyFile, "utf8").split("\n").filter(Boolean);
      expect(lines).toEqual(["gateway", "help", "exit"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("consecutive duplicate commands are deduped (S8)", async () => {
    const dir = tempDir();
    try {
      await driveShell("gateway\ngateway\nhelp\nexit\n", {}, dir);
      const lines = readFileSync(join(dir, ".agentide/data", "shell-history"), "utf8").split("\n").filter(Boolean);
      expect(lines).toEqual(["gateway", "help", "exit"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("history persists across shell sessions (reload on start)", async () => {
    const dir = tempDir();
    try {
      await driveShell("gateway\nexit\n", {}, dir);
      // Second session: history builtin sees the first session's command.
      const { output } = await driveShell("history\nexit\n", {}, dir);
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
    const r = await runShell(process.cwd(), { fs: makeFs() }, { input, output });
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
    const r = await runCli([], { fs: makeFs(), stdin: input, stdout: output });
    expect(r.exitCode).toBe(0);
    expect(chunks.join("")).toContain("agentide (");
  });
});
