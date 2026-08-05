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
  readonly fs: import("@spanexx/gateway-core").FileSystem;
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
  readonly clock?: import("@spanexx/gateway-core").Clock;
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

  /**
   * CID:platform-types-005 - adapterMcp
   * BI[9] GRILL Q6: when true (default), createPlatform() auto-creates and
   *   starts an MCP adapter that exposes the registered capability catalog
   *   as MCP `tools` over Streamable HTTP (POST /mcp). The adapter speaks
   *   JSON-RPC 2.0, validates the caller's bearer token, and translates
   *   `tools/call` into `gateway.handleInvocation()`.
   *
   *   The CLI sets this to `false` because each CLI invocation spins a
   *   short-lived platform; binding 7100 per invocation would waste a port
   *   and risk `EADDRINUSE` races across rapid commands. Daemons and boot
   *   scripts leave it `true`.
   */
  readonly adapterMcp?: boolean;

  /**
   * CID:platform-types-006 - adapterMcpPort
   * BI[9]: TCP port the MCP adapter listens on. Default `7100`. Use `0` for
   *   OS-assigned (tests). Ignored when `adapterMcp: false`.
   */
  readonly adapterMcpPort?: number;

  /**
   * CID:platform-types-007 - adapterMcpHost
   * BI[9]: bind host for the MCP adapter. Default `"127.0.0.1"`. Ignored
   *   when `adapterMcp: false`.
   */
  readonly adapterMcpHost?: string;

  /**
   * CID:platform-types-009 - adapterWs
   * websocket-adapter (BI[24]): when true (default), createPlatform() auto-creates
   *   and starts a WebSocket adapter that exposes the registered capability catalog
   *   over a flat `{type, ...}` envelope (16 frame types per the PRD-TRD). The
   *   adapter speaks the same JWT-auth handshake as the MCP adapter, enforces the
   *   origin-binding claim (browser clients), and offers both `invoke` (universal
   *   pull) and `subscribe`/`event` (verbatim event-bus fan-out) on the same
   *   socket. The CLI sets this to `false` for the same short-lived-process reason
   *   it opts out of MCP (port-binding race).
   */
  readonly adapterWs?: boolean;
  readonly wsPort?: number;
  readonly adapterWsHost?: string;

  /**
   * CID:platform-types-010 - enableOidc
   * BI[29] Phase 7: when true, the gateway exposes the OIDC auth-code grant
   * dev stub (GET /oauth/authorize + GET /oauth/callback on the MCP adapter).
   * Default false. oidcBaseUrl is where the gateway lives (used for the
   * dev-stub-approve redirect); defaults to http://127.0.0.1:{adapterMcpPort}.
   */
  readonly enableOidc?: boolean;
  readonly oidcBaseUrl?: string;
}

// CID:platform-types-002 - Platform
// Purpose: handle returned by createPlatform(); exposes the wired components + stop() lifecycle.
// discovery/issues: stop() is idempotent (can be called multiple times).
//   backendRuntime is undefined unless backendRuntimePort was set on the config.
// Uses: components composed from Tier 1 + gateway-core
// Used by: CLI, integration tests, custom boot scripts
export interface Platform {
  readonly eventBus: import("@spanexx/event-bus").EventBus;
  readonly capabilityRegistry: import("@spanexx/capability-registry").CapabilityRegistry;
  readonly sessionManager: import("@spanexx/session-manager").SessionManager;
  readonly pluginManager: import("@spanexx/plugin-manager").PluginManager;
  readonly gateway: import("@spanexx/gateway-core").Gateway;
  /**
   * CID:platform-types-004 - backendRuntime
   * BI[8b]: present when createPlatform was called with backendRuntimePort.
   *   Undefined otherwise — preserves v1 behavior of returning GATEWAY_SDK_UNREACHABLE
   *   for backend-sdk-* owner-prefixed capabilities.
   * Used by: integration tests, custom boot scripts that want to introspect the runtime.
   */
  readonly backendRuntime?: import("@spanexx/backend-runtime").BackendRuntime;
  /**
   * CID:platform-types-008 - mcpAdapter
   * BI[9]: present when createPlatform was called with adapterMcp !== false.
   *   Undefined otherwise. Exposed so tests and operators can introspect the
   *   bound port (port 0 = OS-assigned at start time) and stop the adapter
   *   independently of the rest of the platform.
   * Used by: integration tests, custom boot scripts.
   */
  readonly mcpAdapter?: import("@spanexx/adapter-mcp").McpAdapter;
  readonly wsAdapter?: import("@spanexx/adapter-websocket").WebSocketAdapter;
  stop(): Promise<void>;
}
