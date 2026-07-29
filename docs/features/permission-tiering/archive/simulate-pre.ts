#!/usr/bin/env node
//================================================================
// simulate-pre.ts — BI[7] permission-tiering pre-impl simulation
//
// DESIGN-TIME simulation. Mirrors the GRILLed design BEFORE code
// is written. The user runs stages interactively to surface design
// issues the GRILL missed.
//
// Run: npx tsx docs/features/permission-tiering/simulate-pre.ts
//      npx tsx docs/features/permission-tiering/simulate-pre.ts stage <name>
//      npx tsx docs/features/permission-tiering/simulate-pre.ts <command> [args]
//
// Hardcoded catalog (25 caps from BI[6]). No real events. No real
// auth. The point is to make the operator flow visible.
//================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

//---------------------------------------------------------------
// Tier convention (Q6 hybrid: verb list + explicit override)
//---------------------------------------------------------------
const READ_VERBS = new Set([
  "read", "list", "get", "view", "show", "describe", "fetch", "query",
  "count", "is", "has",
]);
const ACT_VERBS = new Set([
  "write", "set", "put", "create", "update", "edit", "patch", "append",
  "push", "post", "send", "open", "close", "start", "stop", "restart",
  "pause", "resume", "navigate", "goto", "click", "doubleclick", "hover",
  "type", "press", "select", "scroll", "wait", "upload", "download",
  "run", "exec", "execute", "install", "enable", "disable", "reload",
  "touch", "move", "copy", "rename",
]);
const DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "drop", "destroy", "purge", "wipe", "reset", "clear",
  "truncate", "commit", "merge", "rebase", "push", "checkout",
]);

function tierFromConvention(capName: string): string | null {
  const verb = capName.split(".").pop() ?? "";
  if (DESTRUCTIVE_VERBS.has(verb)) return "destructive";
  if (ACT_VERBS.has(verb)) return "act";
  if (READ_VERBS.has(verb)) return "read";
  return null;
}

//---------------------------------------------------------------
// State (matches BI[6]'s 25 caps)
//---------------------------------------------------------------
interface Cap {
  name: string;
  version: string;
  type: "business" | "platform" | "runtime";
  owner: string;
  permissions: string[];
  tier: string | null;
  description: string;
}

interface Token {
  id: string;
  tenant: string;
  caller: string;
  scope: string[];
  issued: string;
}

interface State {
  active_token: string | null;
  tokens: Token[];
  capabilities: Cap[];
  audit_log: { ts: string; caller: string; capability: string; status: string }[];
}

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const SIM_ROOT = resolve(SCRIPT_DIR, "../../..");
const STATE_FILE = process.env["SIM_ROOT"]
  ? `${process.env["SIM_ROOT"]}/data/sim-state.json`
  : `${SIM_ROOT}/data/sim-state.json`;

function initialState(): State {
  return {
    active_token: null,
    tokens: [],
    capabilities: [
      { name: "tenant.create", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.tenant.write"], tier: "write", description: "Create a tenant and bootstrap token" },
      { name: "tenant.list", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.tenant.read"], tier: "read", description: "List tenants visible to the caller" },
      { name: "tenant.suspend", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.tenant.write"], tier: "write", description: "Suspend a tenant (block new calls)" },
      { name: "tenant.delete", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.tenant.write"], tier: "write", description: "Delete a tenant (purge records)" },
      { name: "gateway.status", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.gateway.read"], tier: "read", description: "Gateway runtime status" },
      { name: "gateway.metrics", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.gateway.read"], tier: "read", description: "Gateway counters and metrics" },
      { name: "gateway.configuration", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.gateway.read"], tier: "read", description: "Effective configuration (with secrets redacted)" },
      { name: "auth.token.issue", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.token.write"], tier: "write", description: "Mint a JWT for a caller" },
      { name: "auth.token.revoke", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.token.write"], tier: "write", description: "Revoke a JWT (no-op in v1)" },
      { name: "system.info", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.system.read"], tier: "read", description: "Platform name and version" },
      { name: "system.version", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.system.read"], tier: "read", description: "Platform version (semver + nullable buildHash)" },
      { name: "system.health", version: "1.0.0", type: "platform", owner: "gateway", permissions: ["platform.system.read"], tier: "read", description: "Platform health status (always ok in v1)" },
      { name: "session.create", version: "1.0.0", type: "platform", owner: "session-manager", permissions: ["platform.session.write"], tier: "write", description: "Create a session" },
      { name: "session.resume", version: "1.0.0", type: "platform", owner: "session-manager", permissions: ["platform.session.write"], tier: "write", description: "Resume a session" },
      { name: "session.destroy", version: "1.0.0", type: "platform", owner: "session-manager", permissions: ["platform.session.write"], tier: "write", description: "Destroy a session and cleanup resources" },
      { name: "session.touch", version: "1.0.0", type: "platform", owner: "session-manager", permissions: ["platform.session.write"], tier: "write", description: "Reset a session's idle timer" },
      { name: "session.list", version: "1.0.0", type: "platform", owner: "session-manager", permissions: ["platform.session.read"], tier: "read", description: "List sessions in the caller's tenant (returns [] in v1)" },
      { name: "capability.list", version: "1.0.0", type: "platform", owner: "capability-registry", permissions: ["platform.capability.read"], tier: "read", description: "List registered capabilities" },
      { name: "capability.describe", version: "1.0.0", type: "platform", owner: "capability-registry", permissions: ["platform.capability.read"], tier: "read", description: "Describe one capability by name" },
      { name: "plugin.list", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.read"], tier: "read", description: "List installed plugins" },
      { name: "plugin.install", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.write"], tier: "write", description: "Install a plugin from local source" },
      { name: "plugin.uninstall", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.write"], tier: "write", description: "Uninstall a plugin and cleanup resources" },
      { name: "plugin.enable", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.write"], tier: "write", description: "Enable a previously disabled plugin" },
      { name: "plugin.disable", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.write"], tier: "write", description: "Disable a plugin (in-flight finish)" },
      { name: "plugin.reload", version: "1.0.0", type: "platform", owner: "plugin-manager", permissions: ["platform.plugin.write"], tier: "write", description: "Re-read a plugin's source from disk" },
    ],
    audit_log: [],
  };
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const s = initialState();
    saveState(s);
    return s;
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
}

function saveState(s: State): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function resetActive(s: State): void {
  s.active_token = null;
}

//---------------------------------------------------------------
// Authz (the existing tierCovers algorithm, simulated in TS)
//---------------------------------------------------------------
function rank(scope: string): number {
  const kind = scope.split(".")[0] ?? "";
  const tier = scope.split(".").slice(-1)[0] ?? "";
  if (kind === "runtime") {
    if (tier === "read") return 1;
    if (tier === "act") return 2;
    if (tier === "destructive") return 3;
    return 0;
  }
  if (kind === "platform") {
    if (tier === "read") return 1;
    if (tier === "write") return 2;
    return 0;
  }
  return 0;
}

function checkAuthz(grantedScope: string[], requiredPerms: string[]): boolean {
  if (grantedScope.includes("*")) return true;
  for (const required of requiredPerms) {
    for (const granted of grantedScope) {
      if (granted === required) return true;
      const gr = rank(granted);
      const req = rank(required);
      if (gr > 0 && req > 0) {
        const grantedKind = granted.split(".")[0];
        const requiredKind = required.split(".")[0];
        if (grantedKind !== requiredKind) continue;
        const grantedNs = granted.split(".")[1] ?? "";
        if (grantedNs === "*") {
          if (gr >= req) return true;
        } else {
          const requiredNs = required.split(".")[1] ?? "";
          if (grantedNs === requiredNs && gr >= req) return true;
        }
      }
    }
  }
  return false;
}

//---------------------------------------------------------------
// Caption helpers
//---------------------------------------------------------------
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[1;36m",
  green: "\x1b[1;32m",
  yellow: "\x1b[1;33m",
  red: "\x1b[1;31m",
  dim: "\x1b[2m",
  magenta: "\x1b[1;35m",
};

function banner(s: string): void {
  console.log(`\n${C.cyan}== ${s} ==${C.reset}`);
}
function stage(s: string): void {
  console.log(`\n${C.magenta}-- ${s} --${C.reset}`);
}
function ok(s: string): void { console.log(`  ${C.green}✓${C.reset} ${s}`); }
function warn(s: string): void { console.log(`  ${C.yellow}!${C.reset} ${s}`); }
function err(s: string): void { console.log(`  ${C.red}✗${C.reset} ${s}`); }
function info(s: string): void { console.log(`  ${C.dim}${s}${C.reset}`); }

//---------------------------------------------------------------
// Commands
//---------------------------------------------------------------
function cmdInit(): void {
  const s = initialState();
  saveState(s);
  ok(`Initialized state at ${STATE_FILE}`);
}

function cmdReset(): void {
  const s = initialState();
  saveState(s);
  ok("State reset to initial.");
}

function cmdState(): void {
  const s = loadState();
  banner("Current state");
  console.log(`  active_token: ${s.active_token ?? "(none)"}`);
  console.log(`  tokens:       ${s.tokens.length}`);
  console.log(`  capabilities: ${s.capabilities.length}`);
  console.log(`  audit_log:    ${s.audit_log.length}`);
  console.log(`  state file:   ${STATE_FILE}`);
}

interface TokenIssueOpts { scope: string; tenant?: string; caller?: string }
function cmdTokenIssue(opts: TokenIssueOpts): void {
  const s = loadState();
  const id = `tok-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const scope = opts.scope.split(",").map((s) => s.trim()).filter(Boolean);
  const token: Token = {
    id,
    tenant: opts.tenant ?? "acme",
    caller: opts.caller ?? "bot",
    scope,
    issued: new Date().toISOString(),
  };
  s.tokens.push(token);
  s.active_token = id;
  saveState(s);
  ok(`Issued token ${id}`);
  console.log(`  tenant:  ${token.tenant}`);
  console.log(`  caller:  ${token.caller}`);
  console.log(`  scope:   ${token.scope.join(", ")}`);
}

function cmdTokenUse(id: string): void {
  const s = loadState();
  if (!s.tokens.find((t) => t.id === id)) {
    err(`Token not found: ${id}`);
    return;
  }
  s.active_token = id;
  saveState(s);
  ok(`Active token: ${id}`);
}

function cmdTokenList(): void {
  const s = loadState();
  if (s.tokens.length === 0) {
    warn("No tokens issued");
    return;
  }
  console.log("  id                                       tenant  caller                scope");
  for (const t of s.tokens) {
    const active = t.id === s.active_token ? "*" : " ";
    console.log(`  ${active} ${t.id.padEnd(36)} ${t.tenant.padEnd(7)} ${t.caller.padEnd(20)} ${t.scope.join(", ")}`);
  }
  console.log(`  (* = active)`);
}

function cmdTokenShow(): void {
  const s = loadState();
  if (!s.active_token) {
    warn("No active token. Run: token issue --scope <csv>");
    return;
  }
  const token = s.tokens.find((t) => t.id === s.active_token);
  if (!token) {
    warn("Active token not found in state");
    return;
  }
  console.log(`  id:     ${token.id}`);
  console.log(`  tenant: ${token.tenant}`);
  console.log(`  caller: ${token.caller}`);
  console.log(`  scope:  ${token.scope.join(", ")}`);
}

function cmdCapabilityList(): void {
  const s = loadState();
  const all = s.capabilities;
  const countAll = all.length;
  const id = s.active_token;

  if (!id) {
    banner("Capability list (unfiltered — no active token)");
    console.log(`  Total: ${countAll} caps`);
    for (const c of all) {
      console.log(`  - ${c.name.padEnd(30)} ${(c.tier ?? "null").padEnd(12)} ${c.owner}`);
    }
    return;
  }

  const token = s.tokens.find((t) => t.id === id);
  if (!token) {
    err("Active token not found");
    return;
  }
  const scope = token.scope;

  banner("Capability list (filtered by active token's scope)");
  console.log(`  Token:    ${token.caller} (id=${token.id})`);
  console.log(`  Scope:    ${scope.join(", ")}`);
  console.log("");

  const filtered: Cap[] = [];
  for (const c of all) {
    if (checkAuthz(scope, c.permissions)) filtered.push(c);
  }

  console.log(`  Filtered: ${filtered.length} of ${countAll} caps`);
  console.log("");
  for (const c of filtered) {
    console.log(`  - ${c.name.padEnd(30)} ${(c.tier ?? "null").padEnd(12)} ${c.owner}`);
  }
}

function cmdCapabilityDescribe(name: string): void {
  const s = loadState();
  const cap = s.capabilities.find((c) => c.name === name);
  if (!cap) {
    err(`Capability not found: ${name}`);
    return;
  }
  console.log(`  name:        ${cap.name}`);
  console.log(`  version:     ${cap.version}`);
  console.log(`  type:        ${cap.type}`);
  console.log(`  owner:       ${cap.owner}`);
  console.log(`  tier:        ${cap.tier ?? "null"}`);
  console.log(`  permissions: ${cap.permissions.join(", ")}`);
  console.log(`  description: ${cap.description}`);
}

function cmdAudit(): void {
  const s = loadState();
  banner("Audit log");
  if (s.audit_log.length === 0) {
    warn("Audit log is empty");
    return;
  }
  for (const e of s.audit_log) {
    console.log(`  ${e.ts}  ${e.caller.padEnd(20)} ${e.capability.padEnd(30)} ${e.status}`);
  }
}

function cmdAuditRecord(caller: string, capability: string, status: string): void {
  const s = loadState();
  s.audit_log.push({
    ts: new Date().toISOString().slice(11, 19),
    caller,
    capability,
    status,
  });
  saveState(s);
}

function cmdTierOf(capName: string): void {
  const inferred = tierFromConvention(capName);
  if (inferred) {
    ok(`tier of ${capName}: ${inferred} (from convention)`);
  } else {
    warn(`tier of ${capName}: unknown verb — plugin author must declare explicitly`);
  }
}

interface RegisterOpts { type: string; name: string; tier?: string }
function cmdRegister(opts: RegisterOpts): void {
  switch (opts.type) {
    case "runtime": {
      let tier = opts.tier;
      if (!tier) {
        const inferred = tierFromConvention(opts.name);
        if (inferred) {
          tier = inferred;
          ok(`Tier inferred from convention: ${tier}`);
        } else {
          err(`TIER_REQUIRED: runtime cap '${opts.name}' has no tier. Declare: {name, tier: read|act|destructive}`);
          return;
        }
      }
      if (!["read", "act", "destructive"].includes(tier)) {
        err(`Invalid tier for runtime: ${tier} (must be read|act|destructive)`);
        return;
      }
      ok(`Registered runtime cap: ${opts.name} (tier: ${tier})`);
      return;
    }
    case "platform": {
      let tier = opts.tier;
      if (!tier) {
        const m = opts.name.match(/platform\.[a-z]+\.(read|write)/);
        tier = m?.[1] ?? "read";
      }
      ok(`Registered platform cap: ${opts.name} (tier: ${tier})`);
      return;
    }
    case "business": {
      if (opts.tier && opts.tier !== "null") {
        err(`Business caps must have tier=null (got: ${opts.tier})`);
        return;
      }
      ok(`Registered business cap: ${opts.name} (tier: null)`);
      return;
    }
    default:
      err(`Unknown type: ${opts.type} (must be business|platform|runtime)`);
  }
}

function cmdInvoke(capabilityName: string): void {
  const s = loadState();
  if (!s.active_token) {
    err("No active token. Run: token issue --scope <csv> --caller <id>");
    return;
  }
  const token = s.tokens.find((t) => t.id === s.active_token);
  if (!token) {
    err("Active token not found");
    return;
  }
  const cap = s.capabilities.find((c) => c.name === capabilityName);
  if (!cap) {
    err(`Capability not found: ${capabilityName}`);
    return;
  }
  const covered = checkAuthz(token.scope, cap.permissions);
  const tierMatch = (() => {
    // For a "tier match" demo: caller must have at least the cap's tier rank.
    if (token.scope.includes("*")) return "covered (wildcard)";
    const req = rank(cap.permissions[0] ?? "");
    if (req === 0) return "covered (exact match)";
    let ok = false;
    let reason = "";
    for (const granted of token.scope) {
      const gr = rank(granted);
      if (gr === 0) continue;
      if (granted.split(".")[0] !== cap.permissions[0]!.split(".")[0]) continue;
      const ns = granted.split(".")[1] ?? "";
      if (ns === "*" || ns === (cap.permissions[0]!.split(".")[1] ?? "")) {
        if (gr >= req) { ok = true; break; }
        reason = `caller tier rank ${gr} < required ${req}`;
      }
    }
    return ok ? "covered (tier hierarchy)" : `denied (${reason || "namespace mismatch"})`;
  })();
  console.log(`  Caller:   ${token.caller}`);
  console.log(`  Cap:      ${cap.name} (tier: ${cap.tier})`);
  console.log(`  Required: ${cap.permissions.join(", ")}`);
  console.log(`  Result:   ${tierMatch}`);
  if (covered) {
    ok("Call would succeed");
    cmdAuditRecord(token.caller, cap.name, "ok");
  } else {
    err("Call would be denied with GATEWAY_INSUFFICIENT_SCOPE");
    cmdAuditRecord(token.caller, cap.name, "denied");
  }
}

function cmdHelp(): void {
  console.log(`BI[7] permission-tiering - pre-impl simulation

USAGE
  npx tsx simulate-pre.ts                     interactive menu
  npx tsx simulate-pre.ts stage <name>       run a stage
  npx tsx simulate-pre.ts <command> [args]   direct command

STAGES
  scenario       run the full 7-step demo
  setup          initialize / reset / show state
  token          issue, list, switch, show tokens
  filter         capability list with different scopes
  invoke         simulate a handleInvocation call
  tier           test the tier convention (verb list)
  validate       test the validator (cap registration)
  audit          view the audit log

DIRECT COMMANDS
  init                                  initialize state
  reset                                 clear and reinit state
  state                                 show state summary
  token issue --scope <csv> [--tenant T] [--caller C]
  token list                            list all tokens
  token use <id>                        switch active token
  token show                            show active token
  capability list                       list caps (filtered by active token)
  capability describe --name <name>     show full record
  invoke <capability-name>              simulate a handleInvocation call
  tier-of <cap-name>                    infer tier from convention
  register --type <t> --name <cap> [--tier <tier>]
  audit                                 show audit log
  help                                  this help

STATE
  ${STATE_FILE}

Run with no args for the interactive menu, or pick a stage to start.
`);
}

//---------------------------------------------------------------
// STAGES — selectable scenarios the user can run
//---------------------------------------------------------------

function stageSetup(): void {
  stage("STAGE: setup");
  info("Reset or initialize the simulation state.");
  info("Commands: init, reset, state");
  info("");
  info("Try:");
  info("  > reset            # fresh state with 25 caps");
  info("  > state            # show what's in the state file");
  const s = loadState();
  if (s.tokens.length === 0) {
    warn("No tokens yet. Run 'token issue' or 'stage token'.");
  } else {
    ok(`${s.tokens.length} token(s) in state. Active: ${s.active_token ?? "(none)"}`);
  }
}

function stageToken(): void {
  stage("STAGE: token — issue and switch tokens");
  info("Try the operator flow: issue a token, switch between them, list all.");
  info("");
  info("Suggested:");
  info("  > token issue --scope '*' --caller bootstrap");
  info("  > token issue --scope 'platform.*.read' --caller dashboard-bot");
  info("  > token issue --scope 'runtime.*.act' --caller agent-alpha");
  info("  > token list");
  info("  > token use <id>            # switch to a different token");
  info("  > capability list           # see the catalog filtered by active token");
  info("");
  cmdTokenList();
}

function stageFilter(): void {
  stage("STAGE: filter — capability.list with different scopes");
  info("The headline feature. The catalog filters by what the active token can invoke.");
  info("");
  info("Try: issue a few tokens, then use 'capability list' to see the filtered catalog.");
  info("");

  // Auto-issue three sample tokens if none exist
  const s = loadState();
  if (s.tokens.length === 0) {
    info("(no tokens yet — auto-issuing three sample tokens for the demo)");
    info("");
    cmdTokenIssue({ scope: "*", caller: "bootstrap" });
    console.log("");
    cmdTokenIssue({ scope: "platform.*.read", caller: "dashboard-bot" });
    console.log("");
    cmdTokenIssue({ scope: "runtime.*.act", caller: "agent-alpha" });
    console.log("");
    // Reload state to get the freshly-issued tokens
    const fresh = loadState();
    if (fresh.tokens.length > 0) {
      cmdTokenUse(fresh.tokens[0]!.id);
    }
  }

  info("Pick a token with 'token use <id>' then run 'capability list'.");
  info("Watch the filtered count change as you switch tokens.");
}

function stageInvoke(): void {
  stage("STAGE: invoke — simulate handleInvocation");
  info("Walk through the actual invocation: caller + cap + tier check + audit.");
  info("");

  // Auto-ensure two tokens exist
  const s = loadState();
  if (!s.tokens.find((t) => t.caller === "bootstrap")) {
    cmdTokenIssue({ scope: "*", caller: "bootstrap" });
  }
  if (!s.tokens.find((t) => t.caller === "dashboard-bot")) {
    cmdTokenIssue({ scope: "platform.*.read", caller: "dashboard-bot" });
  }
  const fresh = loadState();
  const bootstrap = fresh.tokens.find((t) => t.caller === "bootstrap")!;
  const dash = fresh.tokens.find((t) => t.caller === "dashboard-bot")!;

  info("Auto-demo: bootstrap invocations, then dashboard-bot invocations.");
  info("");
  cmdTokenUse(bootstrap.id);
  cmdInvoke("plugin.install");
  console.log("");
  cmdInvoke("auth.token.issue");
  console.log("");
  cmdTokenUse(dash.id);
  cmdInvoke("tenant.create");
  console.log("");
  cmdInvoke("tenant.list");
  console.log("");
  info("Try other invocations:");
  info("  > invoke capability.list    # read-only can list");
  info("  > invoke system.info        # read-only can read");
  info("  > invoke plugin.install     # dashboard-bot should be denied");
}

function stageTier(): void {
  stage("STAGE: tier — test the convention (verb -> tier)");
  info("The plugin manager infers the tier from the action verb.");
  info("Plugin authors override when the verb is ambiguous.");
  info("");
  info("Try: 'tier-of <cap-name>' with various names.");
  info("");
  const examples = [
    "browser.navigate",
    "browser.click",
    "browser.screenshot",
    "browser.delete",
    "browser.run",
    "browser.exec",
    "browser.snapshot",
    "docker.run",
    "docker.remove",
    "git.push",
    "git.commit",
    "filesystem.read",
    "filesystem.write",
  ];
  for (const ex of examples) {
    cmdTierOf(ex);
  }
  info("");
  info("Notice: 'screenshot', 'snapshot', 'run', 'exec' are ambiguous.");
  info("Plugin authors must declare them explicitly:");
  info("  > register --type runtime --name browser.screenshot --tier read");
}

function stageValidate(): void {
  stage("STAGE: validate — test the registry validator");
  info("Try registering caps with different types and tiers.");
  info("");

  // Auto-test cases
  const cases: RegisterOpts[] = [
    { type: "runtime", name: "browser.screenshot", tier: "read" },
    { type: "runtime", name: "browser.delete", tier: "destructive" },
    { type: "runtime", name: "browser.run" },  // tier inferred
    { type: "runtime", name: "browser.run", tier: "write" },  // invalid
    { type: "runtime", name: "browser.snapshot" },  // unknown verb
    { type: "platform", name: "tenant.create" },
    { type: "platform", name: "tenant.list" },
    { type: "platform", name: "weird.platform.cap" },  // no permission
    { type: "business", name: "customer.refund" },
    { type: "business", name: "customer.refund", tier: "write" },  // business + tier != null
  ];
  info("Auto-test cases:");
  info("");
  for (const c of cases) {
    const tierStr = c.tier ? `--tier ${c.tier}` : "(no tier)";
    info(`  > register --type ${c.type} --name ${c.name} ${tierStr}`);
    cmdRegister(c);
  }
  info("");
  info("Note: runtime caps REQUIRE a tier (validator enforces).");
  info("Platform caps may omit it (derived from permissions).");
  info("Business caps MUST have tier=null.");
}

function stageAudit(): void {
  stage("STAGE: audit — view the audit log");
  info("Every invocation (ok or denied) is recorded.");
  info("");
  const s = loadState();
  if (s.audit_log.length === 0) {
    warn("Audit log is empty. Try 'stage invoke' first.");
  } else {
    cmdAudit();
  }
}

function stageScenario(): void {
  stage("STAGE: scenario — full 7-step demo");
  info("Walks the full operator flow. Use 'reset' first to start fresh.");
  info("");

  // Reset to fresh state
  cmdInit();
  console.log("");

  // Step 1: wildcard scope
  banner("Step 1: a wildcard scope (operator / bootstrap)");
  console.log("A token with scope='*' sees everything. The operator's * scope");
  console.log("covers every read+write.");
  console.log("");
  cmdTokenIssue({ scope: "*", caller: "bootstrap" });
  console.log("");
  cmdCapabilityList();
  const s1 = loadState();
  s1.active_token = null;
  saveState(s1);

  // Step 2: read-only
  banner("Step 2: a read-only token");
  console.log("This token can list and read but cannot create or modify anything.");
  console.log("");
  cmdTokenIssue({ scope: "platform.*.read", caller: "dashboard-bot" });
  console.log("");
  cmdCapabilityList();
  const s2 = loadState();
  s2.active_token = null;
  saveState(s2);

  // Step 3: tier-aware wildcard
  banner("Step 3: a tier-aware wildcard");
  console.log("A token with runtime.*.act covers every act-tier runtime cap (and");
  console.log("every read-tier too, since act > read). In v1 there are 0 runtime");
  console.log("caps in the platform catalog, so the response is 0.");
  console.log("");
  cmdTokenIssue({ scope: "runtime.*.act", caller: "agent-alpha" });
  console.log("");
  cmdCapabilityList();
  const s3 = loadState();
  s3.active_token = null;
  saveState(s3);

  // Step 4: invoke
  banner("Step 4: invoke a capability outside the active token's scope");
  console.log("The bootstrap operator token tries to call plugin.install. Fine.");
  console.log("Then the dashboard-bot token tries to call tenant.create. Denied.");
  console.log("");
  const bootstrap = loadState().tokens.find((t) => t.caller === "bootstrap");
  if (bootstrap) {
    cmdTokenUse(bootstrap.id);
    cmdInvoke("plugin.install");
    console.log("");
  }
  const dash = loadState().tokens.find((t) => t.caller === "dashboard-bot");
  if (dash) {
    cmdTokenUse(dash.id);
    cmdInvoke("tenant.create");
    console.log("");
  }

  // Step 5: tier convention
  banner("Step 5: the tier convention");
  console.log("A runtime plugin author writes a manifest. The plugin manager");
  console.log("infers the tier from the verb in the action name.");
  console.log("");
  cmdTierOf("browser.navigate");
  cmdTierOf("browser.click");
  cmdTierOf("browser.screenshot");
  cmdTierOf("browser.delete");
  cmdTierOf("browser.run");
  console.log("");

  // Step 6: validator
  banner("Step 6: the validator");
  console.log("A runtime cap without a tier (and an unknown verb) is rejected.");
  console.log("");
  cmdRegister({ type: "runtime", name: "browser.screenshot", tier: "read" });
  cmdRegister({ type: "runtime", name: "browser.delete", tier: "destructive" });
  cmdRegister({ type: "runtime", name: "browser.run" });
  cmdRegister({ type: "runtime", name: "browser.run", tier: "write" });
  cmdRegister({ type: "business", name: "customer.refund", tier: "write" });
  console.log("");

  // Step 7: audit
  banner("Step 7: audit log");
  cmdAudit();
}

const STAGES: Record<string, () => void> = {
  setup: stageSetup,
  token: stageToken,
  filter: stageFilter,
  invoke: stageInvoke,
  tier: stageTier,
  validate: stageValidate,
  audit: stageAudit,
  scenario: stageScenario,
};

function showStages(): void {
  console.log("Pick a stage to run:");
  console.log("");
  for (const [name, fn] of Object.entries(STAGES)) {
    const desc = {
      setup: "initialize / reset / show state",
      token: "issue, list, switch, show tokens",
      filter: "capability list with different scopes",
      invoke: "simulate a handleInvocation call",
      tier: "test the tier convention (verb list)",
      validate: "test the validator (cap registration)",
      audit: "view the audit log",
      scenario: "run the full 7-step demo",
    }[name] ?? "";
    console.log(`  ${C.cyan}${name.padEnd(10)}${C.reset}  ${desc}`);
  }
  console.log("");
  console.log("Run: npx tsx simulate-pre.ts stage <name>");
  console.log("Or:  npx tsx simulate-pre.ts <direct-command> [args]");
}

//---------------------------------------------------------------
// CLI
//---------------------------------------------------------------
function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    showStages();
    return;
  }

  const [command, ...rest] = argv;

  // Stage dispatch
  if (command === "stage") {
    const stageName = rest[0];
    if (!stageName) {
      showStages();
      return;
    }
    const fn = STAGES[stageName];
    if (!fn) {
      err(`Unknown stage: ${stageName}`);
      showStages();
      return;
    }
    fn();
    return;
  }

  // Direct command dispatch
  switch (command) {
    case "init":
      cmdInit();
      break;
    case "reset":
      cmdReset();
      break;
    case "state":
      cmdState();
      break;
    case "token": {
      const sub = rest[0] ?? "";
      const subRest = rest.slice(1);
      const flags = parseFlags(subRest);
      switch (sub) {
        case "issue": {
          if (!flags["scope"]) {
            err("Usage: token issue --scope <csv> [--tenant T] [--caller C]");
            break;
          }
          cmdTokenIssue({
            scope: flags["scope"]!,
            tenant: flags["tenant"],
            caller: flags["caller"],
          });
          break;
        }
        case "use":
          if (!subRest[0]) { err("Usage: token use <id>"); break; }
          cmdTokenUse(subRest[0]);
          break;
        case "list":
          cmdTokenList();
          break;
        case "show":
          cmdTokenShow();
          break;
        default:
          err(`Unknown token subcommand: ${sub}`);
      }
      break;
    }
    case "capability": {
      const sub = rest[0] ?? "";
      const flags = parseFlags(rest.slice(1));
      switch (sub) {
        case "list":
          cmdCapabilityList();
          break;
        case "describe":
          if (!flags["name"]) { err("Usage: capability describe --name <name>"); break; }
          cmdCapabilityDescribe(flags["name"]!);
          break;
        default:
          err(`Unknown capability subcommand: ${sub}`);
      }
      break;
    }
    case "invoke": {
      if (!rest[0]) { err("Usage: invoke <capability-name>"); break; }
      cmdInvoke(rest[0]);
      break;
    }
    case "tier-of":
      if (!rest[0]) { err("Usage: tier-of <cap-name>"); break; }
      cmdTierOf(rest[0]);
      break;
    case "register": {
      const flags = parseFlags(rest);
      if (!flags["type"] || !flags["name"]) {
        err("Usage: register --type <t> --name <cap> [--tier <tier>]");
        break;
      }
      cmdRegister({
        type: flags["type"]!,
        name: flags["name"]!,
        tier: flags["tier"],
      });
      break;
    }
    case "audit":
      cmdAudit();
      break;
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    default:
      err(`Unknown command: ${command}`);
      cmdHelp();
  }
}

main();
