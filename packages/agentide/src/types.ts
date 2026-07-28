// CID:platform-types-001 - CreatePlatformConfig
// Purpose: configuration for createPlatform(); all persistence paths derived from dataDir unless overridden.
// discovery/issues: file paths default to ${dataDir}/tenants.json + ${dataDir}/audit.log + ${dataDir}/gateway-secret + ${dataDir}/plugins/installed.json.
// Uses: gateway-core types (FileSystem), platform defaults (defaultTenant)
// Used by: createPlatform()
export interface CreatePlatformConfig {
  readonly fs: import("@platform/gateway-core").FileSystem;
  readonly dataDir: string;
  readonly tenantsPath?: string;
  readonly auditLogPath?: string;
  readonly secretPath?: string;
  readonly installRecordPath?: string;
  readonly handlerTimeoutMs?: number;
  readonly rateLimit?: {
    readonly capacity: number;
    readonly tokensPerSecond: number;
  };
  readonly clock?: import("@platform/gateway-core").Clock;
  /**
   * Optional bootstrap tenant. When provided AND the tenant does not already exist,
   * it is created. Pass this from `agentide init` only; other commands should omit it
   * to avoid leaking a "default" tenant into a freshly-init'd install.
   */
  readonly defaultTenant?: { readonly id: string; readonly name: string };
}

// CID:platform-types-002 - Platform
// Purpose: handle returned by createPlatform(); exposes the wired components + stop() lifecycle.
// discovery/issues: stop() is idempotent (can be called multiple times).
// Uses: components composed from Tier 1 + gateway-core
// Used by: CLI, integration tests, custom boot scripts
export interface Platform {
  readonly eventBus: import("@platform/event-bus").EventBus;
  readonly capabilityRegistry: import("@platform/capability-registry").CapabilityRegistry;
  readonly sessionManager: import("@platform/session-manager").SessionManager;
  readonly pluginManager: import("@platform/plugin-manager").PluginManager;
  readonly gateway: import("@platform/gateway-core").Gateway;
  stop(): Promise<void>;
}