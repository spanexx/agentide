// CID:cli-tree-001 - CLI command tree
// Purpose: the static command → subcommand table that drives dispatch in
//   `runCliInner` and shell completion. Single source of truth for the
//   CLI surface per docs/features/cli-restructure/PRD-TRD-cli-restructure.md
//   (S3 tree, S4 old names, S5 offline/live/dual split, S6 gateway rehome).
//
// Quick lookup:
//   rg -n "CID:cli-tree-" packages/agentide/src/cli-tree.ts

// CID:cli-tree-002 - World type
// Purpose: a subcommand lives in one of three "worlds":
//   - "offline": disk/data-dir only. Refuses --url/--token. (init, tenant,
//     client, token, plus gateway start/stop which only touch the pid file.)
//   - "live": always remote (gateway over websocket). Refuses --data-dir.
//     Gateway down → friendly "gateway not running" error from the pid file.
//   - "dual": reads disk by default; --url switches to the live gateway.
//     (capability list, plugin list.)
export type World = "offline" | "live" | "dual";

// CID:cli-tree-003 - SubDef
// Purpose: per-subcommand metadata. `description` shows up in `agentide
//   <group> --help`; `world` overrides the group's default world when set
//   (used for capability list vs describe, plugin list vs mutators, and
//   the gateway start/stop-vs-status split per IMPL Risk Note 1).
export interface SubDef {
  readonly description: string;
  readonly world?: World;
}

// CID:cli-tree-004 - GroupDef
// Purpose: a group's subcommand table + its default world. A sub without
//   an explicit `world` inherits the group's default.
export interface GroupDef {
  readonly subs: Record<string, SubDef>;
  readonly world: World;
}

// CID:cli-tree-005 - GROUPS
// Purpose: the tree. Every group is a domain the operator can address;
//   every sub is a verb on that domain. World per group + per sub (overrides).
//   "session" / "plugin" mutators / "capability describe" are "live" because
//   they require a running gateway; "capability list" / "plugin list" are
//   "dual" so they default to disk and switch to live when --url is given.
export const GROUPS: Record<string, GroupDef> = {
  gateway: {
    world: "live",
    subs: {
      // start/stop are pid-file / spawn ops — they do NOT need a live
      // gateway (Risk Note 1). Mark them offline so refusal rules don't
      // force a "gateway not running" check on `agentide gateway start`.
      start: { description: "Start the agentide gateway in the background", world: "offline" },
      stop: { description: "Stop a running agentide gateway (by pid file)", world: "offline" },
      status: { description: "Show the live gateway status (gateway.status)", world: "live" },
      health: { description: "Show the live gateway health (system.health)", world: "live" },
      metrics: { description: "Show the live gateway metrics (gateway.metrics)", world: "live" },
      version: { description: "Show the live gateway version (system.version)", world: "live" },
    },
  },
  tenant: {
    world: "offline",
    subs: {
      create: { description: "Create a tenant in the data dir" },
      list: { description: "List tenants known to the gateway" },
      suspend: { description: "Suspend a tenant (deny new sessions)" },
      delete: { description: "Delete a tenant from the data dir" },
    },
  },
  client: {
    world: "offline",
    subs: {
      create: { description: "Create a machine identity (client_credentials)" },
      list: { description: "List machine identities" },
      grant: { description: "Issue a one-time registration code" },
      revoke: { description: "Revoke a machine identity" },
      rotate: { description: "Rotate a machine identity's secret" },
      redeem: { description: "Redeem a registration code into a client_id+secret" },
    },
  },
  capability: {
    world: "dual",
    subs: {
      list: { description: "List registered capabilities (disk default; --url for live)" },
      // IMPL delivery note 4: describe runs on the in-process registry in v1
      // (data-dir). Wiring it to the live gateway is a follow-up; marking it
      // live now would force a "gateway not running" refusal on a command
      // that works offline.
      describe: { description: "Describe a single capability (in-process registry in v1)", world: "offline" },
    },
  },
  plugin: {
    world: "dual",
    subs: {
      list: { description: "List installed plugins (disk default; --url for live)" },
      install: { description: "Install a plugin from a manifest (live)", world: "live" },
      uninstall: { description: "Uninstall a plugin (live)", world: "live" },
      enable: { description: "Enable a plugin (live)", world: "live" },
      disable: { description: "Disable a plugin (live)", world: "live" },
      reload: { description: "Reload a plugin's handlers (live)", world: "live" },
    },
  },
  session: {
    world: "live",
    subs: {
      create: { description: "Create a new session" },
      resume: { description: "Resume an existing session" },
      destroy: { description: "Destroy a session" },
      touch: { description: "Refresh a session's TTL" },
      list: { description: "List active sessions" },
    },
  },
  token: {
    world: "offline",
    subs: {
      issue: { description: "Issue a JWT for a tenant + caller" },
      revoke: { description: "Revoke a JWT by jti" },
    },
  },
};

// CID:cli-tree-006 - OLD_NAME_NEW
// Purpose: the one-release deprecation map. Each entry is the new tree
//   target an old bare command should dispatch to. Used by `runCliInner`
//   to route `agentide status` → `agentide gateway status` (with a stderr
//   note added in Phase 4). Old names die in the release after this one.
export interface MappedTarget {
  readonly group: string;
  readonly sub: string;
}

export const OLD_NAME_NEW: Record<string, MappedTarget> = {
  start: { group: "gateway", sub: "start" },
  stop: { group: "gateway", sub: "stop" },
  status: { group: "gateway", sub: "status" },
  health: { group: "gateway", sub: "health" },
  sessions: { group: "session", sub: "list" },
  capabilities: { group: "capability", sub: "list" },
  plugins: { group: "plugin", sub: "list" },
};

// CID:cli-tree-007 - worldOf
// Purpose: resolve the effective world for a (group, sub) pair. Sub's
//   explicit world wins; otherwise the group's default applies. Returns
//   "live" for unknown (group, sub) so the dispatcher treats unknowns
//   conservatively (refuses --data-dir, asks for live connection).
export function worldOf(group: string, sub: string): World {
  const g = GROUPS[group];
  if (g === undefined) return "live";
  const s = g.subs[sub];
  if (s === undefined) return g.world;
  return s.world ?? g.world;
}

// CID:cli-tree-008 - groupHelp
// Purpose: the per-group usage text. `agentide <group>` with no sub prints
//   this and exits 0 (PRD-TRD S3). Unknown group returns "" so callers
//   can fall through to the full help text.
export function groupHelp(group: string): string {
  const g = GROUPS[group];
  if (g === undefined) return "";
  const subNames = Object.keys(g.subs);
  return (
    `agentide ${group} — ${describeGroup(group)}\n` +
    `\n` +
    `Usage:\n` +
    `  agentide ${group} <subcommand>\n` +
    `\n` +
    `Subcommands:\n` +
    subNames.map((s) => `  ${s.padEnd(12)} ${g.subs[s]!.description}`).join("\n") +
    "\n"
  );
}

function describeGroup(group: string): string {
  switch (group) {
    case "gateway":
      return "lifecycle (start/stop/status/health/metrics/version)";
    case "tenant":
      return "tenant registry (data-dir)";
    case "client":
      return "machine identities (client_credentials)";
    case "capability":
      return "capability discovery";
    case "plugin":
      return "plugin lifecycle";
    case "session":
      return "session lifecycle (live)";
    case "token":
      return "JWT mint / revoke";
    default:
      return "";
  }
}
