// CID:commands-001 - operator command handlers (cli-restructure split, D-68)
// Purpose: the executable handlers behind the tree — init/tenant/token/
//   capability/plugin. client lives in client.ts. Each is one disk-data-dir
//   operation (no websocket — remote commands live in consumer.ts).
import { createPlatform } from "./factory.js";
import { saveConfig } from "./config.js";
import type { CliOptions, CliResult } from "./cli-types.js";
import { getFlag, getFlagAll, result } from "./cli-utils.js";
import { runClient } from "./client.js";

export { runClient };

async function runInit(dataDir: string, flags: Record<string, string | boolean | string[]>, opts: CliOptions): Promise<CliResult> {
  const tenantId = getFlag(flags, "default-tenant", "default");
  const tenantName = getFlag(flags, "default-tenant-name", tenantId);
  // CID:cli-init-001 - D-78: create the data dir if it doesn't exist.
  // The CLI is the bootstrap path; the operator should never have to `mkdir -p`
  // before `init`. Idempotent (recursive: true is a no-op on existing dirs).
  // Uses the FileSystem seam — the production fs implements mkdir; in-memory
  // fakes omit it (they don't need real directories) and the mkdir is skipped.
  if (typeof opts.fs.mkdir === "function") {
    await opts.fs.mkdir(dataDir, { recursive: true });
  }
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    defaultTenant: { id: tenantId, name: tenantName },
    // BI[9] GRILL Q6 / Plan Decision 7: CLI is short-lived per invocation;
    // binding 7100 here would waste a port and risk EADDRINUSE races across
    // rapid back-to-back commands.
    adapterMcp: false,
    adapterWs: false,
  });
  const { token } = await platform.gateway.issueToken({
    tenantId,
    callerId: "bootstrap",
    scope: ["*"],
    expiresInMs: 365 * 24 * 60 * 60 * 1000,
  });
  await platform.stop();

  // CID:cli-init-002 - persist the bootstrap token to the config file so
  // remote commands work in every terminal right after init. Mirrors the
  // D-112 behavior of `token issue` (runToken): a save failure is a
  // warning, never an error — the token is already printed below.
  const configOverride = getFlag(flags, "config", "");
  let configPath = "";
  try {
    configPath = saveConfig({ token }, { home: opts.home, configOverride }).path;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warning: could not save token to config: ${msg}\n`);
  }

  // Header + confirmation. The token itself never touches the terminal —
  // it is only persisted to the config file above (CID:cli-init-002), which
  // is the entire point of the auto-save: nothing secret on screen, no
  // scrollback, no copy-paste needed.
  process.stdout.write(
    `# Initialized Agentide in ${dataDir}\n` +
    `# Default tenant: ${tenantId} (${tenantName})\n` +
    `# Bootstrap token saved to ${configPath}\n`,
  );
  return result("");
}

async function runTenant(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    adapterMcp: false,
    adapterWs: false,
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
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  if (sub !== "issue") return result("", `unknown token subcommand: ${sub ?? ""}\n`, 1);
  const tenantId = getFlag(flags, "tenant", "");
  const callerId = getFlag(flags, "caller", "");
  const scopeStr = getFlag(flags, "scope", "*");
  if (!tenantId || !callerId) return result("", "token issue requires --tenant and --caller\n", 1);
  const scope = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
  const origins = [
    ...getFlagAll(flags, "origin"),
    ...getFlag(flags, "origins", "").split(","),
  ].map((s) => s.trim()).filter(Boolean);
  const expectedOrigins = [...new Set(origins)];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    adapterMcp: false,
    adapterWs: false,
  });
  try {
    const { token } = await platform.gateway.issueToken({
      tenantId,
      callerId,
      scope,
      ...(expectedOrigins.length > 0 ? { expectedOrigins } : {}),
    });
    // CID:cli-012 - D-112: persist the freshly minted token to the config
    // file so remote commands (`invoke`, `sessions`, ...) just work in every
    // terminal. Fresh mint overwrites the old token — the stale-token
    // treadmill dies with it. --no-save opts out (scripting/CI). A save
    // failure is a warning, never an error: the token is already on stdout.
    if (flags["no-save"] !== true) {
      const configOverride = getFlag(flags, "config", "");
      try {
        saveConfig({ token }, { home: opts.home, configOverride });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return result(`${token}\n`, `warning: could not save token to config: ${msg} (use --no-save to silence)\n`, 0);
      }
    }
    return result(`${token}\n`);
  } finally {
    await platform.stop();
  }
}

// CID:cli-001 - runClient
// Purpose: operator management of machine identities (BI[29] client_credentials).
//   create/grant/revoke/rotate/redeem talk to the gateway's ClientService
//   directly (no session+token dance — this is operator tooling, same trust
//   level as `tenant create`).
// discovery/issues: the plaintext secret is written to <dataDir>/clients/
//   .secret-<id>.txt with 0600 permissions and is only echoed to stdout with
//   --print. Real-fs runs retry the write after mkdir (InMemoryFs never fails).
async function runCapability(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    adapterMcp: false,
    adapterWs: false,
  });
  try {
    if (sub === "list") {
      const ownerFilter = getFlag(flags, "owner", "");
      const tierFilter = getFlag(flags, "tier", "") as "read" | "act" | "destructive" | "write" | "";
      const cards = platform.capabilityRegistry.list();
      // Perf note: N×M filter walks the registry once per filter check.
      // v1 has ~30 caps; this is sub-millisecond. A registry.listByOwner() helper
      // would make this O(1) for future higher-cardinality catalogs.
      const enriched = cards.map((card) => {
        const full = platform.capabilityRegistry.describe(card.name).capability;
        return { card, full };
      });
      const filtered = enriched.filter(({ card, full }) => {
        if (!full) return false;
        if (ownerFilter && full.owner !== ownerFilter) return false;
        if (tierFilter && card.tier !== tierFilter) return false;
        return true;
      });
      const lines = filtered.map(({ card }) => {
        const tier = card.tier ?? "-";
        return `- ${card.name}\t${card.version}\t${tier}\t${card.description}`;
      });
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
    adapterMcp: false,
    adapterWs: false,
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

export {
  runInit,
  runTenant,
  runToken,
  runCapability,
  runPlugin,
};
