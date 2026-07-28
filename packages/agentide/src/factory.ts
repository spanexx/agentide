// CID:platform-factory-001 - createPlatform
// Purpose: compose the full Tier 1 stack + gateway-core into a single started Platform handle.
// discovery/issues: factory order matters — EventBus first (no deps), then CapabilityRegistry, then SessionManager, then PluginManager (async factory), then Gateway. We do NOT register a default adapter — per PHILOSOPHY § Tiny Kernel, the kernel does not depend on a transport. Operators wire adapters in their boot script.
// Uses: @platform/event-bus, @platform/capability-registry, @platform/session-manager, @platform/plugin-manager, @platform/gateway-core
// Used by: CLI (packages/agentide/src/cli.ts), integration tests, custom operators
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager } from "@platform/session-manager";
import { createPluginManager } from "@platform/plugin-manager";
import { createGateway } from "@platform/gateway-core";
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

  const gateway = await createGateway(eventBus, capabilityRegistry, sessionManager, pluginManager, {
    fs: config.fs,
    clock: config.clock,
    handlerTimeoutMs: config.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
    rateLimit: config.rateLimit ?? DEFAULT_RATE_LIMIT,
    auditLogPath,
    tenantsPath,
    secretPath,
  });

  // Bootstrap default tenant when caller provided one (idempotent — re-creating Platform against the same dataDir must not fail).
  if (config.defaultTenant) {
    const existing = gateway.listTenants().find((t) => t.id === config.defaultTenant!.id);
    if (!existing) {
      await gateway.createTenant(config.defaultTenant);
    }
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    // Currently the kernel has no explicit stop() — but we still resolve adapters + flush events.
    // Reserved for future use (adapter.stop() loop, audit flush).
  };

  return {
    eventBus,
    capabilityRegistry,
    sessionManager,
    pluginManager,
    gateway,
    stop,
  };
}