/*
 * Code Map: `agentide start` — boots the gateway as a long-lived daemon.
 *
 * CID Index:
 * CID:start-001 - runStart (orchestrator)
 * CID:start-002 - default bind/ports
 * CID:start-003 - data-dir writability probe (FileSystem has no mkdir)
 * CID:start-004 - at-least-one-adapter invariant
 * CID:start-005 - createPlatform error → exit 2 (EADDRINUSE hint)
 * CID:start-006 - bootstrap tenant only when tenants.json missing
 * CID:start-007 - signal handlers keep the event loop alive after return
 * CID:start-008 - AGENTIDE_TEST_NO_BLOCK env var skips the blocking wait for tests
 *
 * Quick lookup: rg -n "CID:start-" packages/agentide/src/start.ts
 */

import { createPlatform } from "./factory.js";
import * as fsPromises from "node:fs/promises";
import type { CliOptions, CliResult } from "./cli-types.js";
import { getFlag } from "./cli.js";
import { result } from "./cli.js";

/**
 * CID:start-001 - runStart
 * Boot the gateway as a long-lived daemon. Mirrors scripts/start-gateway.mjs
 * but lives inside the CLI so one binary does everything (PRD S9 lock).
 */
export async function runStart(
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  // Resolve a FileSystem. The CLI entrypoint (bin.js) calls runCli with {} (no fs);
  // fall back to real node:fs/promises so production calls work without the caller
  // needing to wire one up. createGateway does the same fallback for its own fs usage.
  const fs: NonNullable<CliOptions["fs"]> = opts.fs ?? {
    readFile: (path) => fsPromises.readFile(path, "utf8"),
    writeFile: (path, data, mode) => fsPromises.writeFile(path, data, { encoding: "utf8", mode }),
    exists: async (path) => {
      try { await fsPromises.access(path); return true; } catch { return false; }
    },
  };
  // CID:start-002 - default bind/ports unless overridden
  const bind = getFlag(flags, "bind", "127.0.0.1");
  const portMcpRaw = getFlag(flags, "port-mcp", "7100");
  const noMcp = flags["no-mcp"] === true;
  const noWs = flags["no-ws"] === true;
  const portMcp = Number.parseInt(portMcpRaw, 10);
  // WS port is hardcoded to 7300 at the platform factory today (no adapterWsPort
  // field in CreatePlatformConfig). Future: add it. For now, --port-ws is rejected
  // with a usage hint so users don't think it works.
  const portWsExplicit = getFlag(flags, "port-ws", "");
  if (portWsExplicit !== "") {
    return result("", "error: --port-ws is not supported yet (WS adapter port is fixed at 7300 in v1; future versions will expose adapterWsPort)\n", 2);
  }

  // CID:start-004 - at least one adapter required
  if (noMcp && noWs) {
    return result("", "error: at least one of --no-mcp or --no-ws must be omitted (need an adapter to start)\n", 2);
  }
  if (!Number.isFinite(portMcp)) {
    return result("", `error: invalid port --port-mcp=${portMcpRaw}\n`, 2);
  }

  // CID:start-003 - Ensure the data dir exists. The FileSystem interface only exposes read/write/exists,
  // so we can't mkdir through it. Best-effort: skip if data dir already has the secret file
  // (createPlatform's loadOrCreateSecret handles the secret bootstrap); otherwise
  // advise the operator to create the dir first.
  const secretPath = `${dataDir.replace(/\/$/, "")}/gateway-secret`;
  const dirLikelyExists = await fs.exists(secretPath);
  if (!dirLikelyExists) {
    try {
      await fs.writeFile(`${secretPath}.probe`, "", 0o600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return result("", `error: data dir ${dataDir} not writable or missing: ${msg} (create the directory first: mkdir -p ${dataDir})\n`, 2);
    }
  }

  // CID:start-006 - bootstrap tenant only if tenants.json doesn't exist.
  // (createPlatform's defaultTenant is idempotent at the platform level; we add a
  // pre-check so the tenant is only seeded on a true first run.)
  const defaultTenantId = getFlag(flags, "default-tenant", "");
  let defaultTenant: { id: string; name: string } | undefined;
  if (defaultTenantId !== "") {
    const tenantsPath = `${dataDir.replace(/\/$/, "")}/tenants.json`;
    const exists = await fs.exists(tenantsPath);
    if (!exists) {
      defaultTenant = { id: defaultTenantId, name: getFlag(flags, "default-tenant-name", defaultTenantId) };
    }
  }

  const adapterMcpEnabled = !noMcp;
  const adapterWsEnabled = !noWs;

  // CID:start-005 - createPlatform errors → exit 2, not the catch-all's exit 1.
  let platform;
  try {
    platform = await createPlatform({
      fs,
      dataDir,
      defaultTenant,
      adapterMcp: adapterMcpEnabled,
      adapterMcpHost: bind,
      adapterMcpPort: portMcp,
      adapterWs: adapterWsEnabled,
      adapterWsHost: bind,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = msg.includes("EADDRINUSE") ? " (is another gateway running?)" : "";
    return result("", `error: ${msg}${hint}\n`, 2);
  }

  // CID:start-001 - banner
  const mcpBanner = !adapterMcpEnabled ? "(disabled)" : `:${portMcp}`;
  const wsBanner = !adapterWsEnabled ? "(disabled)" : `:7300`;
  const banner = `[gateway] platform up — mcp ${mcpBanner}, ws ${wsBanner}\n`;

  // CID:start-007 - Register signal handlers BEFORE returning so they stay active for the
  // lifetime of the process. node keeps the event loop alive while SIGINT/SIGTERM
  // listeners are registered, even after runStart returns to runCli.
  let exiting = false;
  const stop = async (): Promise<void> => {
    if (exiting) return;
    exiting = true;
    process.stdout.write("[gateway] stopping...\n");
    try {
      await platform.stop();
    } catch {
      // best-effort — exit either way
    }
    process.exit(0);
  };
  process.on("SIGINT", () => { void stop(); });
  process.on("SIGTERM", () => { void stop(); });

  // CID:start-008 - For tests, return the banner immediately. Production blocks
  // forever (SIGINT/SIGTERM handler exits).
  if (process.env.AGENTIDE_TEST_NO_BLOCK === "1") {
    return result(banner);
  }
  await new Promise<never>(() => {});
  return result(banner);
}

// =============================================================================
// CID:start-009 - runStop
// Read pid file, send SIGTERM (10s grace), then SIGKILL. Return result with
// what happened so the operator sees the outcome.
// =============================================================================
export async function runStop(
  _dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  _opts: CliOptions,
): Promise<CliResult> {
  const { DEFAULT_PID_FILE, readPidFile, removePidFile, stopByPid } = await import("./lifecycle.js");
  const { getFlag } = await import("./cli.js");

  const pidFile = getFlag(flags, "pid-file", DEFAULT_PID_FILE);
  const pid = await readPidFile(pidFile);
  if (pid === null) {
    return result("", `no gateway running (no pid file at ${pidFile})\n`, 1);
  }
  const outcome = await stopByPid(pid);
  await removePidFile(pidFile);

  const msgs: Record<typeof outcome, string> = {
    "graceful": `Gateway stopped (PID ${pid}, graceful).`,
    "forced": `Gateway stopped (PID ${pid}, SIGKILL — did not respond to SIGTERM within 10s).`,
    "already-gone": `Gateway (PID ${pid}) was already not running. Pid file removed.`,
  };
  return result(`${msgs[outcome]}\n`);
}

// =============================================================================
// CID:start-010 - runDetachedStart
// Parent (foreground) side of `agentide start --detach`. Returns immediately
// after forking a detached child that runs the gateway in the background.
// The child is the actual gateway; the parent just reports the pid.
// =============================================================================
export async function runDetachedStart(
  dataDir: string,
  flags: Record<string, string | boolean | string[]>,
  opts: CliOptions,
): Promise<CliResult> {
  const { getFlag, result } = await import("./cli.js");
  const {
    DEFAULT_PID_FILE, DEFAULT_LOG_FILE,
    detachChild, writePidFile, readPidFile, isAlive,
  } = await import("./lifecycle.js");

  const logFile = getFlag(flags, "log-file", DEFAULT_LOG_FILE);
  const pidFile = getFlag(flags, "pid-file", DEFAULT_PID_FILE);
  const noDetach = flags["foreground"] === true;

  // Refuse to start a second one when one is already alive.
  const existing = await readPidFile(pidFile);
  if (existing !== null && isAlive(existing)) {
    return result("", `error: gateway already running (PID ${existing}). Use \`agentide stop\` first.\n`, 2);
  }

  // Pass-through argv (everything we received) so the child re-runs runCli
  // with the same flags but no --foreground.
  const passThrough = [
    "start",
    "--data-dir", dataDir,
    "--pid-file", pidFile,
    "--log-file", logFile,
    ...Object.entries(flags).flatMap(([k, v]) => {
      if (k === "foreground") return []; // child must NOT inherit --foreground
      if (k === "pid-file" || k === "log-file" || k === "data-dir") return []; // already included above
      if (v === true) return [`--${k}`];
      return [`--${k}`, String(v)];
    }),
  ];

  // Foreground mode = run normally (for local debugging).
  if (noDetach) {
    return runStart(dataDir, flags, opts);
  }

  // Detach: fork a child, write pid file, return immediately.
  const detached = detachChild({
    logFile,
    pidFile,
    argv: passThrough,
  });
  if ("error" in detached) {
    return result("", `error: detach failed: ${detached.error}\n`, 2);
  }
  await writePidFile(pidFile, detached.childPid);
  return result(
    `Detached. PID: ${detached.childPid}. ` +
      `Logs: ${logFile}. ` +
      `Stop with: agentide stop [--pid-file ${pidFile}].\n`,
  );
}