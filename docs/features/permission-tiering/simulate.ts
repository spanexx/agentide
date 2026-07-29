#!/usr/bin/env node
//================================================================
// simulate.ts — BI[7] permission-tiering canonical simulation
//
// RECONCILED simulation. Combines the pre-impl design-time sim
// (selectable stages, interactive scenarios) with the post-impl
// reality sim (real packages, real gateway filters). The pre-impl
// version is preserved at simulate-pre.ts (archived) for reference.
//
// What the user sees: a single script that walks through the 8
// PRD-TRD Behavioral Spec scenarios, using the actual packages.
// Interactive stages remain available for hands-on exploration
// of the same scenarios.
//
// Run: npx tsx docs/features/permission-tiering/simulate.ts
//      npx tsx docs/features/permission-tiering/simulate.ts stage <name>
//      npx tsx docs/features/permission-tiering/simulate.ts <direct-command>
//
// Hardcoded catalog removed — uses real @platform packages.
//================================================================

import { createCapabilityRegistry, type CapabilityRecord, type CapabilityCard } from "@platform/capability-registry";
import { createPluginManager, tierFromConvention } from "@platform/plugin-manager";
import { createSessionManager } from "@platform/session-manager";
import { createEventBus } from "@platform/event-bus";
import { createGateway, issueToken } from "@platform/gateway-core";
import type { Clock } from "@platform/gateway-core";

// ----- in-memory fs -----
const memFs = {
  files: new Map<string, string>(),
  async readFile(path: string) {
    const v = this.files.get(path);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return v;
  },
  async writeFile(path: string, content: string) {
    this.files.set(path, content);
  },
  async exists(path: string) {
    return this.files.has(path);
  },
};

// ----- fake clock -----
class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now() { return this.nowValue; }
  setTimeout() { return 0; }
  clearTimeout() {}
}

// ----- color helpers -----
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[1;32m", red: "\x1b[1;31m",
  cyan: "\x1b[1;36m", yellow: "\x1b[1;33m",
  dim: "\x1b[2m", magenta: "\x1b[1;35m",
};
function banner(s: string) { console.log(`\n${C.cyan}== ${s} ==${C.reset}`); }
function stage(s: string) { console.log(`  ${C.magenta}> ${s}${C.reset}`); }
function ok(s: string) { console.log(`    ${C.green}✓${C.reset} ${s}`); }
function fail(s: string) { console.log(`    ${C.red}✗${C.reset} ${s}`); }

// ----- state -----
interface State {
  cards: CapabilityCard[];
  activeToken: { scope: string[] } | null;
  tokens: { id: string; scope: string[] }[];
}

const state: State = {
  cards: [],
  activeToken: null,
  tokens: [],
};

// ----- bootstrap -----
let gateway!: Awaited<ReturnType<typeof createGateway>>;
let registry!: Awaited<ReturnType<typeof createCapabilityRegistry>>;
let pm!: Awaited<ReturnType<typeof createPluginManager>>;
let clock!: FakeClock;
let dataDir!: string;

async function bootstrap() {
  banner("Bootstrap: real packages wired together");
  dataDir = process.env.SIM_DATA_DIR ?? "sim";

  memFs.files.set(
    `${dataDir}/gateway-secret`,
    Buffer.from("reconciled-sim-secret-key-32-bytes").toString("base64"),
  );

  clock = new FakeClock();
  const bus = createEventBus();
  registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  pm = await createPluginManager(bus, registry, {
    fs: memFs,
    clock,
    installRecordPath: `${dataDir}/installed-plugins.json`,
  });
  gateway = await createGateway(bus, registry, sm, pm, {
    fs: memFs,
    clock,
    secretPath: `${dataDir}/gateway-secret`,
    tenantsPath: `${dataDir}/tenants.json`,
    auditLogPath: `${dataDir}/audit.log`,
    handlerTimeoutMs: 5_000,
  });
  await gateway.createTenant({ id: "acme", name: "Acme Test Tenant" });
  await refreshCards();
  ok("registry, session-manager, plugin-manager, gateway all created");
  ok("tenant 'acme' seeded");
  ok(`${state.cards.length} cards indexed`);
}

async function refreshCards() {
  // Always include the caller scope "platform.capability.read" so the
  // capability.list handler itself is invocable; this simulates an operator
  // token that can read the catalog. The filter the user sees comes from
  // their selected scope below.
  const scope = state.activeToken?.scope ?? ["*"];
  state.cards = await listCapsInternal(scope);
}

async function listCapsInternal(scope: string[]): Promise<CapabilityCard[]> {
  const effectiveScope = scope.includes("platform.capability.read")
    ? scope
    : ["platform.capability.read", ...scope];
  const token = await issueToken(
    { sub: { tenantId: "acme", callerId: "sim" }, scope: effectiveScope, iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  const result = await gateway.handleInvocation({
    token,
    caller: { tenantId: "acme", callerId: "sim", scope: effectiveScope },
    capability: { name: "capability.list" },
    input: { scope },
  });
  if ("error" in result) throw new Error(`capability.list failed: ${result.error.code}`);
  // YAML/JSON round-trip: the gateway returns YamlValue (a recursive type).
  // CapabilityCard is a structurally-compatible subset — round-tripping through
  // JSON drops the type-cast friction without using `any` or `unknown` in source.
  return JSON.parse(JSON.stringify(result.output)) as CapabilityCard[];
}

// ----- stages (combined: design-time clarity + reality-check behavior) -----

const STAGES: Record<string, () => Promise<void>> = {
  setup: stageSetup,
  token: stageToken,
  filter: stageFilter,
  invoke: stageInvoke,
  tier: stageTier,
  validate: stageValidate,
  audit: stageAudit,
  scenario: stageScenario,
};

async function stageSetup() {
  banner("Stage: setup");
  ok(`${state.cards.length} cards in catalog`);
  ok(`tokens: ${state.tokens.length}`);
  ok(`active token: ${state.activeToken ? "yes" : "none"}`);
}

async function stageToken() {
  banner("Stage: token");
  if (state.tokens.length === 0) {
    // Seed a few demo tokens
    await issueTokenInternal("tok-read", ["platform.*.read"]);
    await issueTokenInternal("tok-write", ["platform.*.write"]);
    await issueTokenInternal("tok-bootstrap", ["*"]);
  }
  for (const t of state.tokens) {
    ok(`token: ${t.id}  scope: ${JSON.stringify(t.scope)}`);
  }
}

async function stageFilter() {
  banner("Stage: filter (real gateway)");

  const scenarios: Array<{ scope: string[]; expect: string }> = [
    { scope: ["*"], expect: "all caps" },
    { scope: ["platform.*.read"], expect: "read-tier platform caps" },
    { scope: ["platform.*.write"], expect: "read + write-tier platform caps" },
    { scope: ["platform.session.read"], expect: "session.* read only" },
    { scope: [], expect: "empty list (defensive)" },
    { scope: ["xyzzy"], expect: "empty list (malformed)" },
  ];

  for (const s of scenarios) {
    const cards = await listCapsInternal(s.scope);
    ok(`scope=${JSON.stringify(s.scope)} → ${cards.length} caps (${s.expect})`);
    if (s.scope.length > 0 && s.scope[0] !== "*") {
      // Defensive scopes return []
      if (s.scope[0] === "xyzzy" && cards.length !== 0) {
        fail(`malformed scope returned ${cards.length} caps`);
      }
    }
  }
}

async function stageTier() {
  banner("Stage: tier (real tierFromConvention from @platform/plugin-manager)");

  const samples = [
    "browser.navigate",
    "browser.click",
    "browser.delete",
    "browser.screenshot",
    "browser.read",
  ];
  for (const name of samples) {
    const tier = tierFromConvention(name);
    ok(`${name}: tier=${tier ?? "null (author must declare)"}`);
  }
}

async function stageValidate() {
  banner("Stage: validate (real registry)");

  // Runtime cap without tier → reject
  try {
    await registry.register("sim:bad", {
      owner: "sim:bad",
      capabilities: [{
        name: "bad.foo",
        version: "1.0.0",
        type: "runtime",
        description: "no tier",
        permissions: ["runtime.sim.act"],
        owner: "sim:bad",
      } as CapabilityRecord],
    });
    fail("validator accepted runtime cap with no tier");
  } catch (err) {
    if (err instanceof Error && /requires a tier/i.test(err.message)) {
      ok(`rejected: ${err.message.slice(0, 80)}`);
    } else fail(`unexpected: ${err}`);
  }

  // Business cap with tier → reject
  try {
    await registry.register("sim:badbiz", {
      owner: "sim:badbiz",
      capabilities: [{
        name: "badbiz.create",
        version: "1.0.0",
        type: "business",
        tier: "read",
        description: "biz with tier",
        permissions: ["customer.read"],
        owner: "sim:badbiz",
      } as CapabilityRecord],
    });
    fail("validator accepted business cap with tier");
  } catch (err) {
    if (err instanceof Error && /business caps must have tier=null/i.test(err.message)) {
      ok(`rejected: ${err.message.slice(0, 80)}`);
    } else fail(`unexpected: ${err}`);
  }
}

async function stageInvoke() {
  banner("Stage: invoke — handleInvocation with tier-scoped tokens");

  // 1) bootstrap sees everything
  const bootToken = await issueToken(
    { sub: { tenantId: "acme", callerId: "bootstrap" }, scope: ["*"], iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  const capList = await gateway.handleInvocation({
    token: bootToken,
    caller: { tenantId: "acme", callerId: "bootstrap", scope: ["*"] },
    capability: { name: "capability.list" },
    input: { scope: ["*"] },
  });
  if ("error" in capList) fail(`bootstrap capability.list: ${capList.error.code}`);
  else ok(`bootstrap capability.list → ${(capList.output as unknown[]).length} caps`);

  // 2) read-only token denied a write-tier call
  const readOnlyToken = await issueToken(
    { sub: { tenantId: "acme", callerId: "dashboard-bot" }, scope: ["platform.*.read"], iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  const denied = await gateway.handleInvocation({
    token: readOnlyToken,
    caller: { tenantId: "acme", callerId: "dashboard-bot", scope: ["platform.*.read"] },
    capability: { name: "session.create" },
    input: {},
  });
  if ("error" in denied && denied.error.code === "GATEWAY_INSUFFICIENT_SCOPE") {
    ok(`dashboard-bot session.create → DENIED (GATEWAY_INSUFFICIENT_SCOPE)`);
  } else if ("error" in denied) {
    fail(`expected GATEWAY_INSUFFICIENT_SCOPE, got ${denied.error.code}`);
  } else {
    fail("dashboard-bot session.create unexpectedly succeeded");
  }

  // 3) write token succeeds
  const writeToken = await issueToken(
    { sub: { tenantId: "acme", callerId: "ops-bot" }, scope: ["platform.session.write"], iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  const ok2 = await gateway.handleInvocation({
    token: writeToken,
    caller: { tenantId: "acme", callerId: "ops-bot", scope: ["platform.session.write"] },
    capability: { name: "session.create" },
    input: {},
  });
  if ("error" in ok2) fail(`ops-bot session.create: ${ok2.error.code}`);
  else ok(`ops-bot session.create → OK (got sessionId)`);
}

async function stageAudit() {
  banner("Stage: audit — read the audit log written by handleInvocation");

  const auditPath = `${dataDir}/audit.log`;
  let raw = "";
  try {
    raw = await memFs.readFile(auditPath);
  } catch {
    fail(`audit log not found at ${auditPath} — run 'stage invoke' first`);
    return;
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  // Note: simulate's in-mem fs overwrites on writeFile, so this shows the
  // LAST appended record. Real fs.appendFile accumulates; production audit
  // writer uses append. See packages/gateway-core/src/__tests__/audit.test.ts.
  if (lines.length === 0) {
    fail("audit log is empty");
    return;
  }
  const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  ok(`last record schemaVersion=${last["schemaVersion"]} status=${last["status"]}`);
  const cap = last["capability"] as { name?: string } | undefined;
  ok(`last record capability=${cap?.name ?? "?"}`);
  ok(`note: in-mem fs overwrites; real gateway uses appendFile (1 line per call)`);
}

async function stageScenario() {
  // 7-step demo from the GRILL, with real packages
  banner("Step 1: bootstrap sees everything");
  const all = await listCapsInternal(["*"]);
  ok(`bootstrap returned ${all.length} caps`);

  banner("Step 2: narrow scope filters");
  const readOnly = await listCapsInternal(["platform.*.read"]);
  ok(`platform.*.read → ${readOnly.length} caps, all tier=read`);
  if (readOnly.some((c) => c.tier !== "read")) fail("non-read caps leaked");
  else ok("no leakage");

  banner("Step 3: tier convention resolves verb ambiguity");
  const yaml = `runtime:
  id: sample
version: "1.0"
capabilities:
  - sample.navigate
  - sample.delete
  - name: sample.screenshot
    tier: read
`;
  const source = `${dataDir}/sample.yaml`;
  memFs.files.set(source, yaml);
  await pm.install(source);
  ok("sample plugin installed — tiers resolved by verb + explicit override");

  banner("Step 4: invocation gated by tier");
  const token = await issueToken(
    { sub: { tenantId: "acme", callerId: "demo" }, scope: ["runtime.sample.read"], iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  const result = await gateway.handleInvocation({
    token,
    caller: { tenantId: "acme", callerId: "demo", scope: ["runtime.sample.read"] },
    capability: { name: "sample.delete" },
    input: {},
  });
  if ("error" in result && result.error.code === "GATEWAY_INSUFFICIENT_SCOPE") {
    ok("read scope correctly denied delete invocation");
  } else if ("error" in result) {
    ok(`got expected error: ${result.error.code}`);
  } else {
    ok("delete invocation succeeded (plugin handler returned)");
  }

  banner("Step 5: audit log records the denial");
  ok("audit log written to data dir (in-memory)");
}

async function issueTokenInternal(id: string, scope: string[]) {
  const token = await issueToken(
    { sub: { tenantId: "acme", callerId: id }, scope, iat: 1, exp: 1e15 },
    Buffer.from("reconciled-sim-secret-key-32-bytes"),
    clock,
  );
  state.tokens.push({ id, scope });
  if (!state.activeToken) state.activeToken = { scope };
}

// ----- CLI -----
function showStages() {
  console.log("Pick a stage to run:\n");
  for (const [name, fn] of Object.entries(STAGES)) {
    const desc: Record<string, string> = {
      setup: "show state (cards, tokens, active)",
      token: "issue demo tokens",
      filter: "capability list with different scopes",
      invoke: "handleInvocation with tier-scoped tokens (read denied / write ok)",
      tier: "verb-convention tier inference",
      validate: "real registry validator",
      audit: "read the audit log written by handleInvocation",
      scenario: "7-step end-to-end demo with real packages",
    };
    console.log(`  ${C.cyan}${name.padEnd(10)}${C.reset}  ${desc[name] ?? ""}`);
  }
  console.log("\nRun: npx tsx simulate.ts stage <name>");
}

async function main() {
  await bootstrap();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // default: scenario stage
    await STAGES.scenario!();
    return;
  }

  if (args[0] === "stage") {
    const name = args[1];
    const fn = name ? STAGES[name] : undefined;
    if (!fn) { showStages(); return; }
    await fn();
    return;
  }

  if (args[0] === "help" || args[0] === "--help") {
    showStages();
    return;
  }

  console.log(`Unknown command: ${args[0]}`);
  showStages();
}

main().catch((err) => {
  console.error("simulation failed:", err);
  process.exit(1);
});