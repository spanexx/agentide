// CID:cli-002 - runCli
// Purpose: parse argv, dispatch to subcommand handlers, return a structured CliResult.
// discovery/issues: argv parsing follows GNU-ish conventions — subcommand first, then sub-subcommand + flags. We keep the parser minimal (no dependency on commander/yargs).
// Uses: createPlatform() to wire the stack per-invocation (init/start/status/etc each spin up a Platform from disk state, operate, tear down).
// Used by: bin entry point, integration tests, future programmatic CLI consumers.
import { createPlatform } from "./factory.js";
import type { CliOptions, CliResult } from "./cli-types.js";

const HELP = `agentide — Agent Runtime Platform operator CLI

Usage:
  agentide init    [--data-dir <path>] [--default-tenant <id>] [--default-tenant-name <name>]
  agentide status  [--data-dir <path>]
  agentide tenant  {create|list|suspend|delete} [--id <id>] [--name <name>] [--data-dir <path>]
  agentide token   issue --tenant <id> --caller <id> [--scope <csv>] [--data-dir <path>]
  agentide capability {list|describe --name <name>} [--data-dir <path>]
  agentide plugin  {list} [--data-dir <path>]
  agentide --help

Run \`agentide <command> --help\` for command-specific options.
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) break;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
      } else {
        flags[key] = next;
        i += 2;
      }
    } else {
      positional.push(tok);
      i += 1;
    }
  }
  return { positional, flags };
}

function getFlag(flags: Record<string, string | boolean>, key: string, fallback: string): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

function result(stdout: string, stderr = "", exitCode = 0): CliResult {
  return { exitCode, stdout, stderr };
}

export async function runCli(argv: readonly string[], opts: CliOptions): Promise<CliResult> {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0];

  if (cmd === undefined || cmd === "--help" || cmd === "-h" || flags["help"] === true) {
    return result(HELP);
  }

  const dataDir = getFlag(flags, "data-dir", process.env["AGENTIDE_DATA_DIR"] ?? "./.agentide/data");

  try {
    switch (cmd) {
      case "init":
        return await runInit(dataDir, flags, opts);
      case "status":
        return await runStatus(dataDir, opts);
      case "tenant":
        return await runTenant(positional.slice(1), dataDir, flags, opts);
      case "token":
        return await runToken(positional.slice(1), dataDir, flags, opts);
      case "capability":
        return await runCapability(positional.slice(1), dataDir, flags, opts);
      case "plugin":
        return await runPlugin(positional.slice(1), dataDir, opts);
      default:
        return result("", `unknown command: ${cmd}\n\n${HELP}`, 1);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return result("", `error: ${msg}\n`, 1);
  }
}

async function runInit(dataDir: string, flags: Record<string, string | boolean>, opts: CliOptions): Promise<CliResult> {
  const tenantId = getFlag(flags, "default-tenant", "default");
  const tenantName = getFlag(flags, "default-tenant-name", tenantId);
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    defaultTenant: { id: tenantId, name: tenantName },
  });
  const { token } = await platform.gateway.issueToken({
    tenantId,
    callerId: "bootstrap",
    scope: ["*"],
    expiresInMs: 365 * 24 * 60 * 60 * 1000,
  });
  await platform.stop();
  return result(
    `# Initialized Agentide in ${dataDir}\n` +
      `# Default tenant: ${tenantId} (${tenantName})\n` +
      `# Bootstrap token for tenant "${tenantId}":\n` +
      `${token}\n`,
  );
}

async function runStatus(dataDir: string, opts: CliOptions): Promise<CliResult> {
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
  });
  const status = await platform.gateway.status();
  await platform.stop();
  return result(
    `tenants: ${status.tenantCount}\n` +
      `plugins: ${status.pluginCount}\n` +
      `audit log: ${status.auditLogBytes} bytes\n` +
      `uptime: ${status.uptimeMs}ms\n`,
  );
}

async function runTenant(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
  });
  try {
    if (sub === "create") {
      const id = getFlag(flags, "id", "");
      const name = getFlag(flags, "name", id);
      if (!id) return result("", "tenant create requires --id\n", 1);
      const tenant = await platform.gateway.createTenant({ id, name });
      return result(`# Created tenant\nid: ${tenant.id}\nname: ${tenant.name}\ncreatedAt: ${tenant.createdAt}\n`);
    }
    if (sub === "list") {
      const tenants = platform.gateway.listTenants();
      const lines = tenants.map((t) => `- ${t.id}\t${t.name}\t${t.suspended ? "suspended" : "active"}`);
      return result(lines.join("\n") + "\n");
    }
    if (sub === "suspend") {
      const id = getFlag(flags, "id", "");
      if (!id) return result("", "tenant suspend requires --id\n", 1);
      const t = await platform.gateway.suspendTenant(id);
      return result(`# Suspended tenant\nid: ${t.id}\nsuspended: ${t.suspended}\n`);
    }
    if (sub === "delete") {
      const id = getFlag(flags, "id", "");
      if (!id) return result("", "tenant delete requires --id\n", 1);
      await platform.gateway.deleteTenant(id);
      return result(`# Deleted tenant\nid: ${id}\n`);
    }
    return result("", `unknown tenant subcommand: ${sub ?? ""}\n`, 1);
  } finally {
    await platform.stop();
  }
}

async function runToken(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  if (sub !== "issue") return result("", `unknown token subcommand: ${sub ?? ""}\n`, 1);
  const tenantId = getFlag(flags, "tenant", "");
  const callerId = getFlag(flags, "caller", "");
  const scopeStr = getFlag(flags, "scope", "*");
  if (!tenantId || !callerId) return result("", "token issue requires --tenant and --caller\n", 1);
  const scope = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
  });
  try {
    const { token } = await platform.gateway.issueToken({ tenantId, callerId, scope });
    return result(`${token}\n`);
  } finally {
    await platform.stop();
  }
}

async function runCapability(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
  });
  try {
    if (sub === "list") {
      const list = platform.capabilityRegistry.list();
      const lines = list.map((c) => `- ${c.name}\t${c.version}\t${c.description}`);
      return result(lines.join("\n") + "\n");
    }
    if (sub === "describe") {
      const name = getFlag(flags, "name", "");
      if (!name) return result("", "capability describe requires --name\n", 1);
      const r = platform.capabilityRegistry.describe(name);
      if (r.capability === null) return result("", `capability not found: ${name}\n`, 1);
      const c = r.capability;
      return result(
        `name: ${c.name}\nversion: ${c.version}\nowner: ${c.owner}\ndescription: ${c.description}\ninputSchema: ${JSON.stringify(c.inputSchema ?? {})}\n`,
      );
    }
    return result("", `unknown capability subcommand: ${sub ?? ""}\n`, 1);
  } finally {
    await platform.stop();
  }
}

async function runPlugin(subArgs: readonly string[], dataDir: string, opts: CliOptions): Promise<CliResult> {
  const sub = subArgs[0];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
  });
  try {
    if (sub === "list") {
      const list = platform.pluginManager.list();
      const lines = list.map((p) => `- ${p.id}\t${p.source ?? ""}\t${p.enabled ? "enabled" : "disabled"}`);
      return result(lines.join("\n") + "\n");
    }
    return result("", `unknown plugin subcommand: ${sub ?? ""}\n`, 1);
  } finally {
    await platform.stop();
  }
}