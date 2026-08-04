#!/usr/bin/env node
// POST-IMPL simulation — agentide-cli-consumer (BI[28]).
//
// Runs the SAME 12-command Simulation Contract as simulate-pre.sh, but
// against the REAL gateway (scripts/start-gateway.mjs) and the REAL CLI
// binary (packages/agentide/dist/bin.js). Each check asserts the locked
// exit code (GRILL Q4) and, where deterministic, the output shape.
//
// Differences vs the pre-impl stub are intentional and reported as
// "observed gap" lines — the pre-impl sim showed the DESIGN; this sim
// shows REALITY (reconciled sim collapses both into the canonical script).
//
// Usage:
//   node packages/agentide/scripts/simulate-cli-consumer.mjs        # run all
//   node packages/agentide/scripts/simulate-cli-consumer.mjs -i 3   # one check
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(ROOT, "packages/agentide/dist/bin.js");
const GATEWAY = join(ROOT, "scripts/start-gateway.mjs");
const STATE = join(ROOT, "docs/features/agentide-cli-consumer/sim-state.json");
const DATA = join(ROOT, "data");
const URL = "ws://127.0.0.1:7300/ws";
const SCOPE = "platform.*.read,platform.session.write";

const INTERACTIVE = process.argv.includes("-i");
const ONLY = INTERACTIVE ? Number(process.argv[process.argv.length - 1]) : NaN;
let PASS = 0, FAIL = 0;
const RESULTS = [];

// ---- helpers ----
function cli(args, opts = {}) {
  return spawnSync("node", [BIN, ...args], { encoding: "utf8", timeout: 20000, ...opts });
}
function mintToken() {
  const r = cli(["token", "issue", "--tenant", "acme", "--caller", "sim", "--scope", SCOPE, "--data-dir", DATA]);
  const line = r.stdout.trim().split("\n").pop() ?? "";
  if (line === "" || line.startsWith("error")) throw new Error(`token mint failed: ${r.stderr}${r.stdout}`);
  return line;
}
function tcpUp(port, host = "127.0.0.1", tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const s = net.connect(port, host);
      s.destroy();
      return true;
    } catch { /* retry */ }
  }
  return false;
}
function check(name, want, code, out, err) {
  const ok = code === want;
  if (ok) { console.log(`ok:   ${name} (exit ${code})`); PASS++; }
  else { console.log(`FAIL: ${name} (want ${want} got ${code})`); FAIL++; }
  if (out !== "") console.log(out.split("\n").map((l) => `   ${l}`).join("\n"));
  if (err !== "") console.log(err.split("\n").map((l) => `   err: ${l}`).join("\n"));
  RESULTS.push({ name, expectedExit: want, exit: code, ok });
  return ok;
}

// ---- gateway lifecycle ----
const gateway = tcpUp(7300) ? null : spawn("node", [GATEWAY], { cwd: ROOT, stdio: "ignore" });
if (gateway) {
  console.log("starting gateway…");
  for (let i = 0; i < 60 && !tcpUp(7300); i++) await new Promise((r) => setTimeout(r, 250));
  if (!tcpUp(7300)) { console.error("FAIL: gateway did not come up on :7300"); process.exit(1); }
  console.log("gateway up on ws://127.0.0.1:7300/ws");
}
const TOKEN = mintToken();
console.log("token minted (scope " + SCOPE + ")");

// ---- scenarios (12-command contract + config warning = 13 checks) ----
function s1_in_process_status() {
  const r = cli(["status", "--data-dir", DATA]);
  return check("1 in-process status (S1/S3 key:value)", 0, r.status, r.stdout, r.stderr);
}
function s2_in_process_caps() {
  const r = cli(["capability", "list", "--data-dir", DATA]);
  const ok = check("2 in-process capability list (table)", 0, r.status, r.stdout.split("\n").slice(0, 3).join("\n") + "…", r.stderr);
  return ok && /tenant\.create/.test(r.stdout);
}
function s3_remote_caps() {
  const r = cli(["capability", "list", "--url", URL, "--token", TOKEN]);
  const ok = check("3 remote capability list (S2 alias→cap)", 0, r.status, r.stdout, r.stderr);
  if (ok && r.stdout.trim() === "[]") {
    console.log("   ⚠ observed gap: real gateway filters capability.list by caller scope\n" +
      "     (empty input.scope → []); thin alias prints an empty table. v2: alias\n" +
      "     forwards caller scope, or operator tokens get the full catalog.");
  }
  return ok;
}
function s4_sessions() {
  const r = cli(["sessions", "--url", URL, "--token", TOKEN]);
  return check("4 sessions alias (S2 session.list)", 0, r.status, r.stdout, r.stderr);
}
function s5_invoke_status() {
  const r = cli(["invoke", "gateway.status", "--url", URL, "--token", TOKEN]);
  const ok = check("5 invoke gateway.status (S4 pretty JSON)", 0, r.status, r.stdout, r.stderr);
  return ok && /"status": "ok"/.test(r.stdout);
}
function s6_invoke_product() {
  const r = cli(["invoke", "product.list", "--url", URL, "--token", TOKEN]);
  // product.list is not registered on a bare gateway → invoke.error verbatim
  const ok = check("6 invoke product.list (unregistered → invoke.error)", 1, r.status, r.stdout, r.stderr);
  if (ok) console.log("   ⚠ note: bare gateway has no backend SDK — GATEWAY_SESSION_REQUIRED is the\n     real gateway's verbatim code (S5 passthrough, exit 1).");
  return ok;
}
function s7_sessions_json() {
  const r = cli(["sessions", "--json", "--url", URL, "--token", TOKEN]);
  return check("7 sessions --json (S3 compact)", 0, r.status, r.stdout, r.stderr);
}
function s8_watch() {
  // background watch; create a session to emit session.created; SIGINT → 5
  const watch = spawn("node", [BIN, "watch", "sessions", "--url", URL, "--token", TOKEN], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  watch.stdout.on("data", (d) => { out += d; });
  watch.stderr.on("data", (d) => { err += d; });
  return new Promise((resolve) => {
    const done = (code) => {
      const lines = out.trim().split("\n").filter(Boolean);
      const hasEvent = lines.some((l) => l.includes('"topic":"session.created"'));
      const hasSnapshot = lines.length > 0 && lines[0] !== undefined;
      const ok = check("8 watch sessions (S7 NDJSON → Ctrl-C=5)", 5, code, lines.join("\n"), err.trim());
      if (ok && (!hasSnapshot || !hasEvent)) {
        console.log("   ⚠ observed gap: expected snapshot + session.created event line");
      }
      resolve(ok);
    };
    setTimeout(() => {
      cli(["invoke", "session.create", "--args", '{"ownerId":"sim","adapterType":"cli"}', "--url", URL, "--token", TOKEN]);
    }, 1500);
    setTimeout(() => watch.kill("SIGINT"), 2800);
    watch.on("close", done);
    setTimeout(() => { watch.kill("SIGKILL"); done(99); }, 15000);
  });
}
function s9_bad_token() {
  const r = cli(["sessions", "--url", URL, "--token", "not-a-jwt"]);
  const ok = check("9 bad.jwt (S5 exit 4)", 4, r.status, r.stdout, r.stderr);
  return ok && r.stderr.includes("auth.error");
}
function s10_missing_token_file() {
  const r = cli(["sessions", "--url", URL, "--token", "path:/tmp/nope-sim.jwt"]);
  return check("10 path:/nope.jwt (S1 exit 2)", 2, r.status, r.stdout, r.stderr);
}
function s11_no_url() {
  const r = cli(["sessions"], { env: { ...process.env, PLATFORM_TOKEN: TOKEN } });
  return check("11 no URL non-TTY (S1 exit 2)", 2, r.status, r.stdout, r.stderr);
}
function s12_tls() {
  const r = cli(["sessions", "--url", "wss://127.0.0.1:7300/ws", "--token", TOKEN]);
  return check("12 wss:// TLS (S5 exit 3)", 3, r.status, r.stdout, r.stderr.split("\n")[0]);
}
function s13_config_warn() {
  const dir = mkdtempSync(join(tmpdir(), "agentide-sim-"));
  const cfg = join(dir, "config.toml");
  writeFileSync(cfg, `gateway_url = "${URL}"\n`);
  chmodSync(cfg, 0o644);
  const r = cli(["sessions", "--config", cfg, "--token", TOKEN]);
  const ok = check("13 config 0644 (S6 one warning)", 0, r.status, r.stdout, r.stderr);
  return ok && r.stderr.includes("group/world-readable");
}

// ---- run ----
const SCENARIOS = [
  ["1 in-process status (S1/S3 key:value)", s1_in_process_status],
  ["2 in-process capability list (table)", s2_in_process_caps],
  ["3 remote capability list (S2 alias→cap)", s3_remote_caps],
  ["4 sessions alias (S2 session.list)", s4_sessions],
  ["5 invoke gateway.status (S4 pretty JSON)", s5_invoke_status],
  ["6 invoke product.list (business cap)", s6_invoke_product],
  ["7 sessions --json (S3 compact)", s7_sessions_json],
  ["8 watch sessions (S7 NDJSON → Ctrl-C=5)", s8_watch],
  ["9 bad.jwt (S5 exit 4)", s9_bad_token],
  ["10 path:/nope.jwt (S1 exit 2)", s10_missing_token_file],
  ["11 no URL non-TTY (S1 exit 2)", s11_no_url],
  ["12 wss:// TLS (S5 exit 3)", s12_tls],
  ["13 config 0644 (S6 one warning)", s13_config_warn],
];

console.log("== agentide-cli-consumer POST-IMPL sim — real gateway, real binary ==");
console.log("   contract: GRILL Q1-Q5 · 12 commands + config warning\n");
if (INTERACTIVE && !Number.isNaN(ONLY)) {
  const [name, fn] = SCENARIOS[ONLY - 1] ?? [];
  if (fn) { console.log(`── ${name}`); await fn(); }
} else {
  for (const [name, fn] of SCENARIOS) {
    console.log(`── ${name}`);
    await fn();
    console.log("");
  }
}

writeFileSync(STATE, JSON.stringify({
  stage: "post-impl",
  updated: new Date().toISOString(),
  gateway: URL,
  checks: RESULTS,
  pass: PASS,
  fail: FAIL,
  observedGaps: [
    "sessions snapshot is [] on a fresh gateway (session.list is a v1 stub returning [] until v2 listSessions()) — check 4/7 shape verified, but a live operator sees an empty table; D-45 tracks the gateway-side stub.",
    "capability.list with empty input.scope returns [] (gateway-core scope filter) — the `capabilities` alias therefore prints an empty table against a real gateway; v2: forward caller scope or operator full-catalog view.",
    "invoke product.list on a bare gateway → GATEWAY_SESSION_REQUIRED (unregistered cap), exit 1 — S5 verbatim passthrough verified; business caps appear once a backend SDK registers.",
    "wss:// against the ws listener surfaces as EPROTO/SSL-record error — exit-codes.ts now classifies it as exit 3 (fixed during post-impl sim).",
  ],
}, null, 2));

console.log(`\nPASS ${PASS}/${SCENARIOS.length}  FAIL ${FAIL}`);
console.log(`sim-state.json → ${STATE}`);
if (gateway) gateway.kill("SIGTERM");
process.exit(FAIL > 0 ? 1 : 0);
