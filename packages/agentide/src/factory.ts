/*
 * Code Map: agentide composition factory
 * - createPlatform: composes the full Tier 1 stack + gateway-core into a single
 *   started Platform handle. Phase 6 (BI[8b]): auto-creates a BackendRuntime
 *   when config.backendRuntimePort is set; lifecycle wired (start after gateway,
 *   stop before). Phase 5 (BI[9]): auto-creates an MCP adapter when
 *   config.adapterMcp !== false; lifecycle wired (start after gateway, stop
 *   before backendRuntime).
 *
 * discovery/issues: factory order matters — EventBus first (no deps), then
 *   CapabilityRegistry, then SessionManager, then PluginManager (async factory),
 *   then Gateway. We DO auto-register the MCP adapter per BI[9] GRILL Q6 —
 *   the meta-package is the intended home for transport wiring. The kernel
 *   itself remains transport-free (PHILOSOPHY §Tiny Kernel); per-package
 *   consumers can call createMcpAdapter() directly if they need finer control.
 *
 * Uses: @platform/event-bus, @platform/capability-registry,
 *   @platform/session-manager, @platform/plugin-manager, @platform/gateway-core,
 *   @platform/backend-runtime (Phase 6), @platform/adapter-mcp (Phase 5/BI[9])
 * Used by: CLI (packages/agentide/src/cli.ts), integration tests, custom operators
 *
 * CID Index:
 * CID:platform-factory-001 -> createPlatform
 * CID:platform-factory-002 -> mcpAdapter wiring
 */

import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";
import { createGateway } from "@spanexx/gateway-core";
import { createBackendRuntime, type BackendRuntime } from "@spanexx/backend-runtime";
import { createMcpAdapter, type McpAdapter } from "@spanexx/adapter-mcp";
import { createWebSocketAdapter, type WebSocketAdapter } from "@spanexx/adapter-websocket";
import { createRestAdapter, type RestAdapter } from "@spanexx/adapter-rest";
import {
  DASHBOARD_CAPS,
  DASHBOARD_CAPSESSION_LESS,
  createDashboardHandlers,
  createDashboardServer,
  type DashboardServer,
} from "@spanexx/dashboard-core";
import type { Platform, CreatePlatformConfig } from "./types.js";

const DEFAULT_RATE_LIMIT = { capacity: 100, tokensPerSecond: 50 };
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
const DEFAULT_ADAPTER_MCP_PORT = 7100;
const DEFAULT_ADAPTER_MCP_HOST = "127.0.0.1";
const DEFAULT_ADAPTER_WS_PORT = 7300;
const DEFAULT_ADAPTER_WS_HOST = "127.0.0.1";
// CID:platform-factory-003 - REST adapter default host. Port is REQUIRED
// (config.adapterRestPort) — the door is opt-in and the operator names the
// port. Confirmed unallocated by A9-R1 §11 (7400 is the recommendation).
const DEFAULT_ADAPTER_REST_HOST = "127.0.0.1";
// CID:cjs-sdk-bootstrap-001 - backend-runtime default port. 7350 sits in the
// 7xx0 band that 7100 (MCP) / 7200 (dashboard, reserved) / 7300 (adapter-
// websocket) already use. The SDK's door (backend-runtime) speaks the
// {type:"sdk.auth"} first-frame protocol per CONTEXT.md sdk-node T5 lock; the
// adapter-websocket door speaks {type:"auth"} — different doors, different
// protocols. The SDK door is opt-in (flag-only) so the factory's backward-
// compat regression test (no backendRuntime → GATEWAY_SDK_UNREACHABLE) stays
// green.
export const DEFAULT_SDK_PORT = 7350;
export const DEFAULT_SDK_HOST = "127.0.0.1";

export async function createPlatform(config: CreatePlatformConfig): Promise<Platform> {
  const tenantsPath = config.tenantsPath ?? `${config.dataDir}/tenants.json`;
  const auditLogPath = config.auditLogPath ?? `${config.dataDir}/audit.log`;
  const secretPath = config.secretPath ?? `${config.dataDir}/gateway-secret`;
  const installRecordPath = config.installRecordPath ?? `${config.dataDir}/plugins/installed.json`;

  const eventBus = createEventBus();
  const capabilityRegistry = createCapabilityRegistry(eventBus);
  const sessionManager = createSessionManager(eventBus);
  const pluginManager = await createPluginManager(eventBus, capabilityRegistry, {
    fs: config.fs,
    clock: config.clock,
    installRecordPath,
    cleanupTimeoutMs: config.cleanupTimeoutMs,
  });

  // CID:platform-factory-001 - createPlatform
  // Purpose: compose the full Tier 1 stack + gateway-core into a single started Platform handle.
  //
  // Phase 6 (BI[8b]) — BackendRuntime lifecycle:
  //   1. If config.backendRuntimePort is set, ensure the gateway's JWT secret
  //      file exists (bootstrap if missing), then build a BackendRuntime using
  //      those secret bytes. This guarantees the runtime verifies the same
  //      HS256 key the gateway uses for `issueToken()` — no second secret.
  //   2. Pass the runtime into createGateway via config.backendRuntime so
  //      dispatch.ts routes backend-sdk-* capabilities through it.
  //   3. Start the runtime AFTER createGateway so the dispatcher exists by
  //      the time SDKs connect.
  //   4. On platform.stop(): stop the runtime BEFORE the gateway so in-flight
  //      dispatches get rejected with GATEWAY_SDK_UNREACHABLE rather than
  //      hanging.
  //   5. Expose the runtime on Platform.backendRuntime so tests + boot
  //      scripts can introspect.
  //
  //   When backendRuntimePort is undefined, no runtime is created and
  //   backend-sdk-* invocations return GATEWAY_SDK_UNREACHABLE (preserves
  //   the Phase 5 backward-compat regression test).
  let backendRuntime: BackendRuntime | undefined;
  let backendRuntimeSecret: Uint8Array | undefined;
  if (config.backendRuntimePort !== undefined) {
    // Bootstrap the secret file if missing. Same base64 + 0600 encoding as
    // packages/gateway-core/src/factory.ts:loadOrCreateSecret. Duplicated
    // intentionally — gateway-core's helper is internal; the alternative is
    // exporting it, which is a wider API change than this pack wants.
    if (!(await config.fs.exists(secretPath))) {
      const { randomBytes } = await import("node:crypto");
      backendRuntimeSecret = new Uint8Array(randomBytes(32));
      const base64 = Buffer.from(backendRuntimeSecret).toString("base64");
      // FileSystem.writeFile takes optional mode (see packages/gateway-core/src/types.ts).
      // 0600 keeps the secret owner-only on POSIX; InMemoryFs fakes ignore it.
      await config.fs.writeFile(secretPath, base64, 0o600);
    } else {
      const stored = (await config.fs.readFile(secretPath)).replace(/\n$/, "");
      backendRuntimeSecret = new Uint8Array(Buffer.from(stored, "base64"));
    }
    backendRuntime = createBackendRuntime({
      port: config.backendRuntimePort,
      tokenSecret: backendRuntimeSecret,
      eventBus,
      capabilityRegistry,
      clock: config.clock,
    });
  }

  const gateway = await createGateway(eventBus, capabilityRegistry, sessionManager, pluginManager, {
    fs: config.fs,
    clock: config.clock,
    handlerTimeoutMs: config.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
    rateLimit: config.rateLimit ?? DEFAULT_RATE_LIMIT,
    auditLogPath,
    tenantsPath,
    secretPath,
    // BI[29]: client store must live under the operator's dataDir, not the
    // gateway-core default (/data). The CLI client subcommand reads/writes it.
    clientDataDir: config.dataDir,
    // CID:platform-types-011 - requireTls (drift 2026-08-05): S8 promised
    // a --no-tls flag; this is the seam. Default true matches GatewayConfig.
    requireTls: config.requireTls ?? true,
    ...(config.enableOidc === true
      ? {
          enableOidc: true,
          oidcBaseUrl: config.oidcBaseUrl ?? `http://${config.adapterMcpHost ?? DEFAULT_ADAPTER_MCP_HOST}:${config.adapterMcpPort ?? DEFAULT_ADAPTER_MCP_PORT}`,
        }
      : {}),
    ...(backendRuntime !== undefined ? { backendRuntime } : {}),
    // BI[13] dashboard-core P6: register the dashboard.view.* caps via
    // gateway-core's extraOwners + extraSessionLessCapabilities seam (D2
    // lock). The composition root supplies the owner + handlers; the
    // kernel stays dashboard-agnostic. Handlers close over the live
    // `gateway` passed by createGateway so they can re-invoke backing caps
    // with the dashboard-bot token.
    ...(config.dashboardPort !== undefined
      ? {
          extraSessionLessCapabilities: DASHBOARD_CAPSESSION_LESS,
          extraOwners: async (g: typeof gateway) => {
            // Mint the dashboard-bot token via the gateway's own
            // issueToken (uses the gateway's secret, no second key file).
            const innerTenantId = config.defaultTenant?.id ?? "default";
            const minted = await g.issueToken({
              tenantId: innerTenantId,
              callerId: "dashboard-bot",
              scope: ["platform.*.read"],
              expiresInMs: 60 * 60 * 1000,
            });
            return [{
              owner: "dashboard",
              capabilities: DASHBOARD_CAPS,
              handlers: createDashboardHandlers(g, { innerToken: minted.token, innerTenantId }),
            }];
          },
        }
      : {}),
  });

  // Bootstrap default tenant when caller provided one (idempotent — re-creating Platform against the same dataDir must not fail).
  if (config.defaultTenant) {
    const existing = gateway.listTenants().find((t) => t.id === config.defaultTenant!.id);
    if (!existing) {
      await gateway.createTenant(config.defaultTenant);
    }
  }

  // BI[13] dashboard-core P6: start the static server AFTER the gateway
  // exists. The dashboard caps + handlers were registered through the
  // gateway-core extraOwners + extraSessionLessCapabilities seam in the
  // createGateway call above (see config.dashboardPort branch there). The
  // server itself only needs the gateway reference for per-GET / token
  // minting; the inner invoke path goes through the registered handlers.
  let dashboardServer: DashboardServer | undefined;
  if (config.dashboardPort !== undefined) {
    dashboardServer = await createDashboardServer({
      gateway,
      clock: config.clock ?? { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} },
      port: config.dashboardPort,
    });
  }

  // Start the runtime AFTER the gateway is built so SDKs hitting
  // backend-sdk-* capabilities during their auth+caps handshake get
  // routed immediately (no first-dispatch race).
  if (backendRuntime !== undefined) {
    await backendRuntime.start();
  }

  // CID:platform-factory-002 - mcpAdapter wiring (BI[9])
  // Auto-register the MCP adapter per GRILL Q6 unless the caller opts out
  // (CLI does, because it spins a short-lived platform per invocation and
  // binding 7100 races). Order: start AFTER the gateway is built (so the
  // kernel's invocation pipeline is ready), AFTER the backendRuntime (so
  // business-cap dispatches have a target). Stop in reverse order: mcpAdapter
  // first (closes the HTTP port), then backend runtime, so in-flight JSON-RPC
  // requests get a clean "closed port" rather than a hung dispatch.
  let mcpAdapter: McpAdapter | undefined;
  if (config.adapterMcp !== false) {
    mcpAdapter = createMcpAdapter(gateway, {
      host: config.adapterMcpHost ?? DEFAULT_ADAPTER_MCP_HOST,
      port: config.adapterMcpPort ?? DEFAULT_ADAPTER_MCP_PORT,
      ...(gateway.oauthTokenHandler !== undefined ? { oauth: gateway.oauthTokenHandler } : {}),
      ...(gateway.oidc !== undefined ? { oidc: gateway.oidc } : {}),
    });
    await mcpAdapter.start();
  }

  let wsAdapter: WebSocketAdapter | undefined;
  if (config.adapterWs !== false) {
    const storedSecret = (await config.fs.readFile(secretPath)).replace(/\n$/, "");
    const tokenSecret = new Uint8Array(Buffer.from(storedSecret, "base64"));
    wsAdapter = createWebSocketAdapter(gateway, eventBus, {
      host: config.adapterWsHost ?? DEFAULT_ADAPTER_WS_HOST,
      port: config.wsPort ?? DEFAULT_ADAPTER_WS_PORT,
      tokenSecret,
      clock: config.clock,
    });
    await wsAdapter.start();
  }

  // CID:platform-factory-003 - restAdapter wiring (A9)
  // Auto-register the REST adapter per A9 lock when config.adapterRestPort is set.
  // Bearer JWT per request, kernel-verified (lazy path) — no tokenSecret needed at
  // the door. The door binds AFTER WS so the port 7300/7400 binding order is
  // predictable; stop in reverse order (REST first, then WS).
  let restAdapter: RestAdapter | undefined;
  if (config.adapterRestPort !== undefined) {
    restAdapter = createRestAdapter(gateway, {
      host: config.adapterRestHost ?? DEFAULT_ADAPTER_REST_HOST,
      port: config.adapterRestPort,
    });
    await restAdapter.start();
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    // Stop the REST adapter FIRST (closes the HTTP port; in-flight
    // requests get a clean "connection closed" response).
    if (restAdapter !== undefined) {
      await restAdapter.stop();
    }
    // Stop the MCP adapter NEXT (closes the HTTP port; in-flight JSON-RPC
    // requests get a clean "port closed" rather than waiting for the
    // runtime to drain).
    if (wsAdapter !== undefined) {
      await wsAdapter.stop();
    }
    if (mcpAdapter !== undefined) {
      await mcpAdapter.stop();
    }
    // Stop the runtime NEXT so in-flight dispatches get rejected with
    // GATEWAY_SDK_UNREACHABLE rather than hanging on a closed socket.
    if (backendRuntime !== undefined) {
      await backendRuntime.stop();
    }
    // Stop the dashboard server if it was started (Q9 lifecycle).
    if (dashboardServer !== undefined) {
      await dashboardServer.stop();
    }
    // Reserved for future use (gateway-level adapter.stop() loop, audit flush).
  };

  return {
    eventBus,
    capabilityRegistry,
    sessionManager,
    pluginManager,
    gateway,
    backendRuntime,
    mcpAdapter,
    wsAdapter,
    restAdapter,
    dashboardServer,
    stop,
  };
}
