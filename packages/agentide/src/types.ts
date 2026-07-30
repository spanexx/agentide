/*
 * Code Map: createPlatform configuration types
 * - CreatePlatformConfig: factory config (dataDir, fs, optional paths/limits)
 * - Platform: handle returned by createPlatform(); exposes wired components + stop()
 *
 * discovery/issues: file paths default to ${dataDir}/tenants.json +
 *   ${dataDir}/audit.log + ${dataDir}/gateway-secret +
 *   ${dataDir}/plugins/installed.json.
 *
 * Uses: gateway-core types (FileSystem), platform defaults (defaultTenant)
 * Used by: createPlatform()
 *
 * CID Index:
 * CID:platform-types-001 -> CreatePlatformConfig
 * CID:platform-types-002 -> Platform
 */

// CID:platform-types-001 - CreatePlatformConfig
// Purpose: configuration for createPlatform(); all persistence paths derived
//   from dataDir unless overridden. backendRuntimePort (BI[8b]) auto-creates a
//   BackendRuntime that accepts WebSocket connections from @platform/sdk-node
//   clients on the given port (use 0 for OS-assigned).
// discovery/issues: file paths default to ${dataDir}/tenants.json +
//   ${dataDir}/audit.log + ${dataDir}/gateway-secret +
//   ${dataDir}/plugins/installed.json.
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
   * Optional plugin-manager cleanup-confirmation timeout. When set, this is
   * forwarded to createPluginManager. Default (in plugin-manager) is 5000ms;
   * tests typically set a small value (e.g. 50ms) to avoid waiting the full
   * timeout when a plugin never confirms cleanup.
   */
  readonly cleanupTimeoutMs?: number;
  /**
   * Optional bootstrap tenant. When provided AND the tenant does not already exist,
   * it is created. Pass this from `agentide init` only; other commands should omit it
   * to avoid leaking a "default" tenant into a freshly-init'd install.
   */
  readonly defaultTenant?: { readonly id: string; readonly name: string };

  /**
   * CID:platform-types-003 - backendRuntimePort
   * BI[8b]: when set, createPlatform() auto-creates a BackendRuntime bound to
   *   this port (0 = OS-assigned). The runtime accepts @platform/sdk-node
   *   WebSocket connections and dispatches `backend-sdk-*` capabilities through
   *   the gateway. When undefined, no runtime is created and `backend-sdk-*`
   *   invocations return GATEWAY_SDK_UNREACHABLE (preserves v1 behavior).
   *
   *   The runtime uses the gateway's JWT secret (same file-backed HS256 key)
   *   so tokens minted by `gateway.issueToken()` are accepted at the auth
   *   handshake. The secret is read from `secretPath` (or its default).
   */
  readonly backendRuntimePort?: number;
}

// CID:platform-types-002 - Platform
// Purpose: handle returned by createPlatform(); exposes the wired components + stop() lifecycle.
// discovery/issues: stop() is idempotent (can be called multiple times).
//   backendRuntime is undefined unless backendRuntimePort was set on the config.
// Uses: components composed from Tier 1 + gateway-core
// Used by: CLI, integration tests, custom boot scripts
export interface Platform {
  readonly eventBus: import("@platform/event-bus").EventBus;
  readonly capabilityRegistry: import("@platform/capability-registry").CapabilityRegistry;
  readonly sessionManager: import("@platform/session-manager").SessionManager;
  readonly pluginManager: import("@platform/plugin-manager").PluginManager;
  readonly gateway: import("@platform/gateway-core").Gateway;
  /**
   * CID:platform-types-004 - backendRuntime
   * BI[8b]: present when createPlatform was called with backendRuntimePort.
   *   Undefined otherwise — preserves v1 behavior of returning GATEWAY_SDK_UNREACHABLE
   *   for backend-sdk-* owner-prefixed capabilities.
   * Used by: integration tests, custom boot scripts that want to introspect the runtime.
   */
  readonly backendRuntime?: import("@platform/backend-runtime").BackendRuntime;
  stop(): Promise<void>;
}