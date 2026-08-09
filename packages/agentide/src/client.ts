// CID:client-001 - client command handler (cli-restructure split, D-68)
// Purpose: operator management of machine identities (BI[29] client_credentials).
//   create/grant/revoke/rotate/redeem talk to the gateway's ClientService
//   directly (no session+token dance — this is operator tooling, same trust
//   level as `tenant create`).
// discovery/issues: the plaintext secret is written to <dataDir>/clients/
//   .secret-<id>.txt with 0600 permissions and is only echoed to stdout with
//   --print. Real-fs runs retry the write after mkdir (InMemoryFs never fails).
import { createPlatform } from "./factory.js";
import { AuditWriter } from "@spanexx/gateway-core";
import type { CliOptions, CliResult } from "./cli-types.js";
import { getFlag, result } from "./cli-utils.js";

// CID:cli-009 - clientHelp
// Purpose: D-84 per-subcommand help. `agentide client` (no subcommand) or
// `agentide client <sub> --help` prints the subcommand's flag set and exits 0.
function clientHelp(sub?: string): string {
  const lines: Record<string, string> = {
    "": `agentide client  — machine identities (client_credentials)

Usage:
  agentide client create   --tenant <id> --name <name> [--scope <csv>] [--print] [--data-dir <path>]
  agentide client list     [--tenant <id>] [--data-dir <path>]
  agentide client grant    --tenant <id> --name <name> [--scope <csv>] [--ttl-min <n>] [--data-dir <path>]
  agentide client revoke   --client-id <id> [--data-dir <path>]
  agentide client rotate   --client-id <id> [--data-dir <path>]
  agentide client redeem   --code <rc_...> [--data-dir <path>]

Run 'agentide client <subcommand> --help' for subcommand-specific flags.`,
    "create": "agentide client create  --tenant <id> --name <name> [--scope <csv>] [--print] [--data-dir <path>]\n",
    "list": "agentide client list    [--tenant <id>] [--data-dir <path>]\n",
    "grant": "agentide client grant   --tenant <id> --name <name> [--scope <csv>] [--ttl-min <n>] [--data-dir <path>]\n",
    "revoke": "agentide client revoke --client-id <id> [--data-dir <path>]\n",
    "rotate": "agentide client rotate --client-id <id> [--data-dir <path>]\n",
    "redeem": "agentide client redeem --code <rc_...> [--data-dir <path>]\n",
  };
  return lines[sub ?? ""] ?? lines[""];
}

// CID:client-002 - writeClientSecret
// Purpose: persist the plaintext secret to <dataDir>/clients/.secret-<id>.txt
//   (0600). Retries once after mkdir for real filesystems; InMemoryFs never
//   hits the fallback.
async function writeClientSecret(
  dataDir: string,
  clientId: string,
  plaintextSecret: string,
  fs: CliOptions["fs"],
): Promise<string> {
  const secretPath = `${dataDir}/clients/.secret-${clientId}.txt`;
  try {
    await fs.writeFile(secretPath, plaintextSecret, 0o600);
  } catch {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(`${dataDir}/clients`, { recursive: true });
    await fs.writeFile(secretPath, plaintextSecret, 0o600);
  }
  return secretPath;
}

export async function runClient(
  subArgs: readonly string[],
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  const sub = subArgs[0];
  // D-84: no subcommand, or explicit --help, prints the per-subcommand help.
  if (sub === undefined || flags["help"] === true) {
    return result(clientHelp(sub));
  }
  const platform = await createPlatform({
    fs: opts.fs,
    dataDir,
    adapterMcp: false,
    adapterWs: false,
  });
  // D-70 closeout (drift 2026-08-05): every state-changing client action
  // through the CLI writes an audit row. Previously these calls bypassed
  // handleInvocation, so operators got no trail. We use the same AuditWriter
  // the gateway uses (same file, same row shape) so operators can grep
  // audit.log for either path. Failure to write is best-effort (AuditWriter
  // already swallows I/O errors to stderr).
  const auditLogPath = `${dataDir.replace(/\/$/, "")}/audit.log`;
  const audit = new AuditWriter(auditLogPath, opts.fs);
  const writeAudit = async (
    action: string,
    tenantId: string,
    clientId: string,
    status: "ok" | "denied" | "error" = "ok",
  ): Promise<void> => {
    await audit.append({
      schemaVersion: 1,
      ts: Date.now(),
      tenantId,
      caller: { id: clientId, scope: [] },
      capability: { name: action, version: "1" },
      owner: "operator-cli",
      status,
      durationMs: 0,
    });
  };
  try {
    const svc = platform.gateway.clientService;
    if (sub === "create") {
      const tenantId = getFlag(flags, "tenant", "");
      const name = getFlag(flags, "name", "");
      if (!tenantId || !name) return result("", "client create requires --tenant and --name\n", 1);
      const scope = getFlag(flags, "scope", "*").split(",").map((s) => s.trim()).filter(Boolean);
      const { record, plaintextSecret } = await svc.createClient({ tenantId, name, defaultScope: scope });
      const secretPath = await writeClientSecret(dataDir, record.id, plaintextSecret, opts.fs);
      await writeAudit("client.create", record.tenantId, record.id);
      if (flags["print"] === true) {
        return result(
          `# Created client\nid: ${record.id}\nname: ${record.name}\nplaintext_secret: ${plaintextSecret}\nsecret_at: ${secretPath}\n`,
        );
      }
      return result(`# Created client\nid: ${record.id}\nname: ${record.name}\ncreated_at: ${record.createdAt}\nsecret_at: ${secretPath}\n`);
    }
    if (sub === "list") {
      const tenantId = getFlag(flags, "tenant", "");
      const clients = tenantId ? await svc.listClients(tenantId) : await svc.listClients();
      const lines = clients.map(
        (c) => `- ${c.id}\t${c.name}\tcreatedAt: ${c.createdAt}\trevoked: ${c.revoked}\tlastUsedAt: ${c.lastUsedAt ?? "-"}`,
      );
      // list is read-only; no audit row per PRD ("every state-changing client action")
      return result(lines.join("\n") + "\n");
    }
    if (sub === "grant") {
      const tenantId = getFlag(flags, "tenant", "");
      const name = getFlag(flags, "name", "");
      if (!tenantId || !name) return result("", "client grant requires --tenant and --name\n", 1);
      const scope = getFlag(flags, "scope", "*").split(",").map((s) => s.trim()).filter(Boolean);
      const ttlMin = Number.parseInt(getFlag(flags, "ttl-min", "5"), 10);
      const { code, expiresAt } = await svc.createRegistrationCode({
        tenantId,
        defaultScope: scope,
        ttlMs: Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60_000 : 5 * 60_000,
      });
      await writeAudit("client.grant", tenantId, code);
      return result(`# Registration code\ncode: ${code}\nexpires_at: ${expiresAt}\n`);
    }
    if (sub === "revoke") {
      const clientId = getFlag(flags, "client-id", "");
      if (!clientId) return result("", "client revoke requires --client-id\n", 1);
      // Resolve tenantId from the record for the audit row.
      const rec = await svc.findClientById(clientId);
      await svc.revokeClient({ clientId });
      await writeAudit("client.revoke", rec?.tenantId ?? "unknown", clientId);
      return result(`# Revoked client\nid: ${clientId}\nrevoked: true\n`);
    }
    if (sub === "rotate") {
      const clientId = getFlag(flags, "client-id", "");
      if (!clientId) return result("", "client rotate requires --client-id\n", 1);
      const rec = await svc.findClientById(clientId);
      const { plaintextSecret } = await svc.rotateClient({ clientId });
      const secretPath = await writeClientSecret(dataDir, clientId, plaintextSecret, opts.fs);
      await writeAudit("client.rotate", rec?.tenantId ?? "unknown", clientId);
      return result(`# Rotated client\nid: ${clientId}\nrotated: true\nsecret_at: ${secretPath}\n`);
    }
    if (sub === "redeem") {
      const code = getFlag(flags, "code", "");
      if (!code) return result("", "client redeem requires --code\n", 1);
      const redeemed = await svc.redeemRegistrationCode({ code });
      if (redeemed === null) {
        await writeAudit("client.redeem", "unknown", code, "denied");
        return result("", "client redeem: invalid or expired registration code\n", 1);
      }
      await writeAudit("client.redeem", "unknown", redeemed.clientId);
      return result(`# Redeemed registration code\nclient_id: ${redeemed.clientId}\nclient_secret: ${redeemed.plaintextSecret}\n`);
    }
    return result("", `unknown client subcommand: ${sub ?? ""}\n`, 1);
  } finally {
    await platform.stop();
  }
}
