#!/usr/bin/env -S npx tsx
/**
 * PROTOTYPE — throwaway.
 * Simulates the install + first-boot UX for an Agentide self-hosted install.
 * No real installation happens. Output is exactly what the operator would see.
 *
 * Run: npx tsx prototypes/install-ux/simulate-install.ts
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function step(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function info(msg: string) {
  console.log(`  ${CYAN}→${RESET} ${msg}`);
}
function warn(msg: string) {
  console.log(`  ${YELLOW}!${RESET} ${msg}`);
}
function header(msg: string) {
  console.log(`\n${BOLD}${msg}${RESET}\n`);
}
function subheader(msg: string) {
  console.log(`${BOLD}${msg}${RESET}`);
}

function simulateOneLiner() {
  header("install.sh — agentide v0.1.0");
  info("Detecting environment... Linux x64, no Docker, no Node.js");
  step("Downloaded agentide binary (12 MB)");
  step("Installed to /usr/local/bin/agentide");
  step("Created data directory: ~/.agentide/data");
  console.log("");
  console.log(`${DIM}Run \`agentide init\` to bootstrap a tenant and operator token.${RESET}`);
  console.log(`${DIM}Run \`agentide --help\` for all commands.${RESET}`);
  console.log("");
}

function simulateInit() {
  header("agentide init — first-run bootstrap");

  info("No existing install detected. Bootstrapping fresh platform.");
  console.log("");

  info("Creating default tenant...");
  step("Tenant: default");
  info("Generating operator token (tenant=default, caller=default-admin, scope=*)...");
  step("Token issued. Expires in 24h.");

  console.log("");
  subheader("Bootstrap operator token:");
  console.log("");
  console.log(`  ${BOLD}eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ7InRlbmFudElkIjoiZGVmYXVsdCIsImNhbGxlcklkIjoiZGVmYXVsdC1hZG1pbiJ9Iiwic2NvcGUiOlsicGxhdGZvcm0uKiIsInBsdWdpbi4qIiwiYnVzaW5lc3MuKiJdfQ.${DIM}<signature>${RESET}`);
  console.log("");
  warn("Save this token now. It will not be shown again.");
  warn("To issue more tokens later: agentide token issue --tenant <id> --caller <id> --scope <...>");
  console.log("");

  info("Writing config to ~/.agentide/config.yaml...");
  step("port: 7100");
  step("dataDir: ~/.agentide/data");
  step("auditLogPath: ~/.agentide/data/audit.log");
  step("adapters.mcp.enabled: true");
  step("adapters.mcp.port: 7100");
  step("Default MCP adapter bundled and enabled.");
}

function simulateStart() {
  header("agentide start — launching platform");
  info("Booting components:");
  step("Event bus");
  step("Capability registry");
  step("Session manager");
  step("Plugin manager (loaded 0 installed plugins)");
  step("Gateway");
  step("MCP adapter (Streamable HTTP, port 7100)");
  console.log("");

  info("Audit log: ~/.agentide/data/audit.log");
  info("Install records: ~/.agentide/data/installed-plugins.json");
  console.log("");
  step("Agentide v0.1.0 is running.");
  console.log("");

  subheader("Connect an AI agent:");
  console.log("");
  console.log(`  ${BOLD}URL:${RESET}    http://localhost:7100`);
  console.log(`  ${BOLD}Auth:${RESET}   Bearer eyJhbGciOiJIUzI1NiIs...`);
  console.log("");
  console.log(`  ${DIM}Or via the bootstrap token you saved during init.${RESET}`);
  console.log("");

  subheader("Next steps:");
  console.log("");
  console.log(`  ${BOLD}agentide status${RESET}                ${DIM}— show running state${RESET}`);
  console.log(`  ${BOLD}agentide logs${RESET}                  ${DIM}— tail the audit log${RESET}`);
  console.log(`  ${BOLD}agentide plugin install --source ./browser.yaml${RESET}`);
  console.log(`  ${BOLD}agentide tenant create <id> <name>${RESET}  ${DIM}— provision a new tenant${RESET}`);
  console.log(`  ${BOLD}agentide stop${RESET}                  ${DIM}— stop the platform${RESET}`);
  console.log("");
  console.log(`${DIM}For hosted multi-tenant deployment, see: https://agentide.io/docs/hosted${RESET}`);
  console.log("");
}

function simulateFailure() {
  header("install.sh — failure case");
  info("Detecting environment... Linux x64, no Docker");
  step("Downloaded agentide binary (12 MB)");
  warn("Failed to install to /usr/local/bin/agentide: permission denied");
  info("Falling back to ~/.local/bin/agentide...");
  step("Installed to ~/.local/bin/agentide");
  warn("~/.local/bin is not in your PATH.");
  warn("Run: export PATH=\"$HOME/.local/bin:$PATH\"  (add to your shell rc)");
  console.log("");
}

simulateOneLiner();
simulateInit();
simulateStart();
console.log("");
console.log("=========================================================");
console.log("");
simulateFailure();
console.log("");
console.log("End of prototype. Edit this file to iterate on wording.");