// Phase 4 (D-84): agentide client subcommands expose per-subcommand help.
// `agentide client` (no subcommand) and `agentide client <sub> --help`
// print the subcommand's flag set and exit 0.
import { describe, expect, it } from "vitest";
import { runCli } from "../index.js";
import { FileSystem as GFS } from "@spanexx/gateway-core";

class MemFs implements GFS {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) { const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

async function clientHelp(args: string[]): Promise<string> {
  const r = await runCli(["client", ...args], { fs: new MemFs() });
  expect(r.exitCode).toBe(0);
  return r.stdout;
}

describe("client subcommand help (D-84)", () => {
  it("`agentide client` with no subcommand prints the summary and exits 0", async () => {
    const out = await clientHelp([]);
    expect(out).toMatch(/create/);
    expect(out).toMatch(/grant/);
    expect(out).toMatch(/redeem/);
  });

  it("`agentide client grant --help` prints grant's flags", async () => {
    const out = await clientHelp(["grant", "--help"]);
    expect(out).toMatch(/grant/);
    expect(out).toMatch(/--tenant/);
    expect(out).toMatch(/--name/);
  });

  it("`agentide client create --help` prints create's flags", async () => {
    const out = await clientHelp(["create", "--help"]);
    expect(out).toMatch(/create/);
    expect(out).toMatch(/--tenant/);
    expect(out).toMatch(/--name/);
  });

  it("`agentide client redeem --help` prints redeem's flags", async () => {
    const out = await clientHelp(["redeem", "--help"]);
    expect(out).toMatch(/redeem/);
    expect(out).toMatch(/--code/);
  });
});