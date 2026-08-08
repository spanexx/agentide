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
 * CID:start-012 - --port-sdk opt-in flag (BI[cjs-sdk-bootstrap] Phase 1)
 * CID:start-013 - detached-child env marker → child boots gateway directly
 *                 (fix: child self-kill on its own pid, handoff 2026-08-05)
 * CID:start-014 - banner written before the blocking await (production CLI
 *                 never returned it — detached log stayed empty)
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
 * Boot the gateway as a long-lived daemon. One binary does everything
 * (PRD S9 lock) — `agentide start --all-doors` is the dev bootstrap
 * (scripts/start-gateway.mjs retired, cli-ops-ergonomics D-114).
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
    mkdir: (path, options) => fsPromises.mkdir(path, options),
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

  // CID:start-013 - --dashboard-port opt-in (BI[13] dashboard-core).
  // Opens the dashboard static server at the given port (default 7200 when
  // the flag is present with no value, matching DASHBOARD_DEFAULT_PORT in
  // packages/dashboard-core/src/config.ts). Flag absent → dashboard server
  // does NOT start (matches factory's regression test: no dashboardPort →
  // no dashboardServer on the Platform).
  const portDashFlag = flags["dashboard-port"];
  let dashboardPort: number | undefined;
  if (portDashFlag !== undefined) {
    if (typeof portDashFlag === "boolean" && portDashFlag === true) {
      dashboardPort = 7200;
    } else if (typeof portDashFlag === "string") {
      const parsed = Number.parseInt(portDashFlag, 10);
      if (!Number.isFinite(parsed)) {
        return result("", `error: invalid port --dashboard-port=${portDashFlag}\n`, 2);
      }
      if (parsed === 7100 || parsed === 7300 || parsed === 7350) {
        return result("", `error: --dashboard-port=${parsed} collides with MCP/WS/SDK adapter doors (7100/7300/7350)\n`, 2);
      }
      dashboardPort = parsed;
    } else {
      return result("", `error: invalid --dashboard-port value (${String(portDashFlag)})\n`, 2);
    }
  }

  // CID:start-012 - --port-sdk opt-in (BI[cjs-sdk-bootstrap] Phase 1).
  // Opens the backend-runtime door (where sdk-node/sdk-browser connect with
  // the {type:"sdk.auth"} first-frame protocol). Flag absent → door stays
  // closed; the factory's backward-compat regression test (no backendRuntime
  // → GATEWAY_SDK_UNREACHABLE) stays green. Default 7350 when present with
  // no value (matches DEFAULT_SDK_PORT in factory.ts).
  const portSdkFlag = flags["port-sdk"];
  let portSdk: number | undefined;
  if (portSdkFlag !== undefined) {
    if (typeof portSdkFlag === "boolean" && portSdkFlag === true) {
      portSdk = 7350;
    } else if (typeof portSdkFlag === "string") {
      const parsed = Number.parseInt(portSdkFlag, 10);
      if (!Number.isFinite(parsed)) {
        return result("", `error: invalid port --port-sdk=${portSdkFlag}\n`, 2);
      }
      portSdk = parsed;
    } else {
      return result("", `error: invalid --port-sdk value (${String(portSdkFlag)})\n`, 2);
    }
    if (portSdk === 7100 || portSdk === 7200 || portSdk === 7300) {
      return result("", `error: --port-sdk=${portSdk} collides with MCP/WS adapter doors (7100/7200/7300)\n`, 2);
    }
  }

  // CID:start-014 - --adapter-rest-port opt-in (A9 REST door).
  // Opens the third client-facing door: POST /invoke + GET /capabilities,
  // Bearer JWT per request, kernel-verified (A8 lazy path). Flag absent →
  // door stays closed (the factory's opt-in contract per A9 Q4 lock).
  // Default 7400 when present with no value, matching REST adapter default
  // in packages/adapter-rest/src/server.ts.
  const portRestFlag = flags["adapter-rest-port"];
  let adapterRestPort: number | undefined;
  if (portRestFlag !== undefined) {
    if (typeof portRestFlag === "boolean" && portRestFlag === true) {
      adapterRestPort = 7400;
    } else if (typeof portRestFlag === "string") {
      const parsed = Number.parseInt(portRestFlag, 10);
      if (!Number.isFinite(parsed)) {
        return result("", `error: invalid port --adapter-rest-port=${portRestFlag}\n`, 2);
      }
      if (parsed === 7100 || parsed === 7200 || parsed === 7300 || parsed === 7350) {
        return result("", `error: --adapter-rest-port=${parsed} collides with MCP/WS/SDK adapter doors (7100/7200/7300/7350)\n`, 2);
      }
      adapterRestPort = parsed;
    } else {
      return result("", `error: invalid --adapter-rest-port value (${String(portRestFlag)})\n`, 2);
    }
  }

  // CID:start-015 - --all-doors (cli-ops-ergonomics, D-114)
  // One flag = all four client doors open with their defaults: MCP 7100,
  // WS 7300, SDK 7350, REST 7400. Replaces the retired dev bootstrap
  // (scripts/start-gateway.mjs). The dashboard stays opt-in via
  // --dashboard-port (it is a UI, not a client door). Explicit per-door
  // flags still override the defaults; a default that collides with an
  // explicit flag is caught by the mutual check below.
  const allDoors = flags["all-doors"] === true;
  if (allDoors) {
    if (portSdk === undefined) portSdk = 7350;
    if (adapterRestPort === undefined) adapterRestPort = 7400;
  }

  // Mutual collision: SDK door vs REST door (either both explicit, or one
  // explicit clashing with the other's --all-doors default).
  if (portSdk !== undefined && adapterRestPort !== undefined && portSdk === adapterRestPort) {
    return result("", `error: --port-sdk=${portSdk} collides with the REST adapter door (--adapter-rest-port=${adapterRestPort})\n`, 2);
  }

  // CID:start-004 - at least one adapter required
  if (noMcp && noWs) {
    return result("", "error: at least one of --no-mcp or --no-ws must be omitted (need an adapter to start)\n", 2);
  }
  if (!Number.isFinite(portMcp)) {
    return result("", `error: invalid port --port-mcp=${portMcpRaw}\n`, 2);
  }

  // CID:start-003 - Ensure the data dir exists. The FileSystem interface only
  // exposes read/write/exists (+ optional mkdir); we auto-create the dir when
  // mkdir is available (D-115 — operator should never have to `mkdir -p`
  // before start; mirrors runInit's CID:cli-init-001). Best-effort probe:
  // skip if the data dir already has the secret file (createPlatform's
  // loadOrCreateSecret handles the secret bootstrap); otherwise write a probe
  // file to verify writability.
  const secretPath = `${dataDir.replace(/\/$/, "")}/gateway-secret`;
  if (typeof fs.mkdir === "function") {
    await fs.mkdir(dataDir, { recursive: true });
  }
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

  // CID:start-010 - --enable-oidc (BI[29] Phase 7)
  // Turns on the OIDC auth-code grant dev stub (GET /oauth/authorize +
  // /oauth/callback). Off by default; the baseUrl defaults to the MCP
  // adapter's own address in the platform factory.
  const enableOidc = flags["enable-oidc"] === true;

  // CID:start-011 - --no-tls (BI[29] S8 / drift 2026-08-05)
  // Disables the TLS requirement on POST /oauth/token. Default is TLS-ON;
  // localhost dev sets --no-tls to skip the 426. Production gateways must
  // never set this flag (the CLI exits 0 with a stderr note when the
  // config is "default" so operators can audit it later).
  const noTls = flags["no-tls"] === true;
  if (noTls) {
    process.stderr.write(
      "[gateway] WARNING: --no-tls disables TLS on /oauth/token. Production gateways must never use this flag.\n",
    );
  }

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
      // CID:start-012 - SDK door opt-in. Spread only when portSdk is set so
      // the no-flag path keeps createPlatform's config shape identical to
      // before (regression test at factory.ts:78-80 stays valid).
      // NOTE: backend-runtime's WebSocketServer currently hardcodes host
      // "127.0.0.1" (packages/backend-runtime/src/server.ts:277); --bind
      // does not flow through to the SDK door in v1. Phase 1 ships the
      // port-on opt-in; bind-on is a follow-up patch.
      ...(portSdk !== undefined ? { backendRuntimePort: portSdk } : {}),
      // CID:start-013 - Dashboard door opt-in. Same shape as --port-sdk:
      // absent → no dashboardServer on the Platform (matches the
      // regression test in factory.ts:97-112). Dashboard binds 127.0.0.1
      // only (server.ts:99) — --bind does not flow through in v1.
      ...(dashboardPort !== undefined ? { dashboardPort } : {}),
      // CID:start-014 - REST door opt-in (A9). Same spread-when-set shape as
      // --port-sdk / --dashboard-port. Absent → factory's default (door
      // closed). REST adapter binds 127.0.0.1 only by default; --bind is
      // a follow-up (adapter-rest/server.ts hardcodes host).
      ...(adapterRestPort !== undefined ? { adapterRestPort, adapterRestHost: bind } : {}),
      ...(enableOidc ? { enableOidc: true } : {}),
      requireTls: !noTls,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = msg.includes("EADDRINUSE") ? " (is another gateway running?)" : "";
    return result("", `error: ${msg}${hint}\n`, 2);
  }

  // CID:start-001 - banner
  const mcpBanner = !adapterMcpEnabled ? "(disabled)" : `:${portMcp}`;
  const wsBanner = !adapterWsEnabled ? "(disabled)" : `:7300`;
  const sdkBanner = portSdk === undefined ? "(disabled)" : `:${portSdk}`;
  const restBanner = adapterRestPort === undefined ? "(disabled)" : `:${adapterRestPort}`;
  const banner = `[gateway] platform up — mcp ${mcpBanner}, ws ${wsBanner}, sdk ${sdkBanner}, rest ${restBanner}\n`;

  // CID:start-016 - persist the bound WS URL to the config file so remote
  // commands (`status`, `capability list`, `invoke`) resolve the gateway
  // without `--url`. The WS adapter only serves path /ws
  // (adapter-websocket/server.ts); a wildcard bind is saved as 127.0.0.1
  // because the CLI consumer runs on this machine. Start is authoritative:
  // it overwrites any stale gateway_url. Failure is a warning, never an
  // error — the gateway itself is already up.
  if (adapterWsEnabled) {
    const wsHost = bind === "0.0.0.0" || bind === "::" ? "127.0.0.1" : bind;
    const { saveConfig } = await import("./config.js");
    const configOverride = getFlag(flags, "config", "");
    try {
      saveConfig({ gatewayUrl: `ws://${wsHost}:7300/ws` }, { home: opts.home, configOverride });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway] warning: could not save gateway_url to config: ${msg}\n`);
    }
  }

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

  // CID:start-014 - Banner must be written BEFORE blocking. runStart never
  // returns in production (the await below resolves never), so a banner
  // attached to the returned CliResult would never surface — the detached
  // child's log stayed empty and `start --foreground` printed nothing.
  // Mirrors the retired dev bootstrap's banner-then-block behavior.
  // Test mode keeps the old contract (banner rides the CliResult).
  if (process.env.AGENTIDE_TEST_NO_BLOCK === "1") {
    return result(banner);
  }
  process.stdout.write(banner);
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
  const info = await readPidFile(pidFile);
  if (info === null) {
    // D-83: both "nothing running" branches exit 0 so `agentide stop && …`
    // works in shell scripts. The message keeps the diagnostic.
    return result("", `no gateway running (no pid file at ${pidFile})\n`, 0);
  }
  const outcome = await stopByPid(info.pid);
  await removePidFile(pidFile);

  const msgs: Record<typeof outcome, string> = {
    "graceful": `Gateway stopped (PID ${info.pid}, graceful).`,
    "forced": `Gateway stopped (PID ${info.pid}, SIGKILL — did not respond to SIGTERM within 10s).`,
    "already-gone": `Gateway (PID ${info.pid}) was already not running. Pid file removed.`,
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
    DEFAULT_PID_FILE, DEFAULT_LOG_FILE, DETACH_CHILD_ENV,
    detachChild, writePidFile, readPidFile, isAlive,
  } = await import("./lifecycle.js");

  // CID:start-013 - Detached-child mode (fix, handoff 2026-08-05).
  // The parent spawns the gateway child with DETACH_CHILD_ENV=1
  // (lifecycle.ts detachChild). The child IS the gateway: skip the pid
  // guard and the detach logic entirely and boot directly via runStart.
  // Before this fix the child re-entered this function, read its own PID
  // from the pid file, saw itself alive, and died with
  // "gateway already running (PID <itself>)" — the gateway never booted.
  if (process.env[DETACH_CHILD_ENV] === "1") {
    return runStart(dataDir, flags, opts);
  }

  const logFile = getFlag(flags, "log-file", DEFAULT_LOG_FILE);
  const pidFile = getFlag(flags, "pid-file", DEFAULT_PID_FILE);
  const noDetach = flags["foreground"] === true;

  // Refuse to start a second one when one is already alive.
  const existing = await readPidFile(pidFile);
  if (existing !== null && isAlive(existing.pid)) {
    return result("", `error: gateway already running (PID ${existing.pid}). Use \`agentide stop\` first.\n`, 2);
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
  // D-81: carry the data-dir in the pid file so `status` recovers it from any cwd.
  await writePidFile(pidFile, detached.childPid, dataDir, new Date().toISOString());
  return result(
    `Detached. PID: ${detached.childPid}. ` +
      `Logs: ${logFile}. ` +
      `Stop with: agentide stop [--pid-file ${pidFile}].\n`,
  );
}