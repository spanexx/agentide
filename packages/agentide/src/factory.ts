/*
 * Code Map: agentide composition factory
 * - createPlatform: composes the full Tier 1 stack + gateway-core into a single
 *   started Platform handle. Phase 6 (BI[8b]): auto-creates a BackendRuntime
 *   when config.backendRuntimePort is set; lifecycle wired (start after gateway,
 *   stop before).
 *
 * discovery/issues: factory order matters — EventBus first (no deps), then
 *   CapabilityRegistry, then SessionManager, then PluginManager (async factory),
 *   then Gateway. We do NOT register a default adapter — per PHILOSOPHY §
 *   Tiny Kernel, the kernel does not depend on a transport. Operators wire
 *   adapters in their boot script.
 *
 * Uses: @platform/event-bus, @platform/capability-registry,
 *   @platform/session-manager, @platform/plugin-manager, @platform/gateway-core,
 *   @platform/backend-runtime (Phase 6)
 * Used by: CLI (packages/agentide/src/cli.ts), integration tests, custom operators
 *
 * CID Index:
 * CID:platform-factory-001 -> createPlatform
 */

import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager } from "@platform/session-manager";
import { createPluginManager } from "@platform/plugin-manager";
import { createGateway } from "@platform/gateway-core";
import { createBackendRuntime, type BackendRuntime } from "@platform/backend-runtime";
import type { Platform, CreatePlatformConfig } from "./types.js";

const DEFAULT_RATE_LIMIT = { capacity: 100, tokensPerSecond: 50 };
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;

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
    ...(backendRuntime !== undefined ? { backendRuntime } : {}),
  });

  // Bootstrap default tenant when caller provided one (idempotent — re-creating Platform against the same dataDir must not fail).
  if (config.defaultTenant) {
    const existing = gateway.listTenants().find((t) => t.id === config.defaultTenant!.id);
    if (!existing) {
      await gateway.createTenant(config.defaultTenant);
    }
  }

  // Start the runtime AFTER the gateway is built so SDKs hitting
  // backend-sdk-* capabilities during their auth+caps handshake get
  // routed immediately (no first-dispatch race).
  if (backendRuntime !== undefined) {
    await backendRuntime.start();
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    // Stop the runtime FIRST so in-flight dispatches get rejected with
    // GATEWAY_SDK_UNREACHABLE rather than hanging on a closed socket.
    if (backendRuntime !== undefined) {
      await backendRuntime.stop();
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
    stop,
  };
}