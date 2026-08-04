/*
 * Code Map: gateway-core public contracts
 * - YamlValue: recursive type (avoids banned `unknown` outside catch clauses)
 * - CallerIdentity: tenantId + callerId + scope, attached to every invocation
 * - CanonicalInvocation: the input to handleInvocation (no protocol shape leakage)
 * - CanonicalResponse: discriminated union {output} | {error}
 * - GatewayErrorPayload: structured error shape (code/message/details/retryable)
 * - AuditRecord: one per invocation, persisted to disk + emitted on Event Bus
 * - TenantRecord: durable tenant state
 * - TokenClaims: JWT payload (sub: {tenantId, callerId}, scope, expectedOrigins, iat, exp)
 * - RateLimitBucketConfig: capacity + tokensPerSecond per (tenantId, callerId)
 * - GatewayConfig: factory config (paths, timeouts, rate limit, clock)
 * - Adapter: protocol-translator interface (MCP, REST, CLI, WS plug in here)
 * - Gateway: kernel interface — handleInvocation + tenant + token + adapter lifecycle
 *
 * CID Index:
 * CID:types-001 -> YamlValue
 * CID:types-002 -> CallerIdentity
 * CID:types-003 -> CanonicalInvocation
 * CID:types-004 -> GatewayErrorPayload
 * CID:types-005 -> CanonicalResponse
 * CID:types-006 -> AuditRecord
 * CID:types-007 -> TenantRecord
 * CID:types-008 -> TokenClaims
 * CID:types-009 -> RateLimitBucketConfig
 * CID:types-010 -> GatewayConfig
 * CID:types-011 -> Clock (time abstraction for tests)
 * CID:types-012 -> FileSystem (in-memory or node fs.promises)
 * CID:types-013 -> Adapter
 * CID:types-014 -> GatewayStatus
 * CID:types-015 -> IssueTokenRequest
 * CID:types-016 -> CreateTenantRequest
 * CID:types-017 -> Gateway
 *
 * Quick lookup: rg -n "CID:types-" packages/gateway-core/src/types.ts
 */

// CID:types-001 - YamlValue
// Purpose: recursive type covering scalars, sequences, mappings — replaces `unknown` to satisfy the project's banned-types check
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue };

// CID:types-002 - CallerIdentity
// Purpose: who is making the call (tenantId + callerId + scope); extracted from JWT sub claim and attached to every invocation
export interface CallerIdentity {
  readonly tenantId: string;
  readonly callerId: string;
  readonly scope: readonly string[];
}

// CID:types-003 - CanonicalInvocation
// Purpose: the input to handleInvocation; protocol-agnostic (no JSON-RPC, no MCP, no HTTP); adapters translate to/from this shape.
//   `token` is REQUIRED — the kernel verifies it (HS256 via verifyToken) and uses the
//   verified claims as the source of truth for caller identity. `caller` is OPTIONAL
//   (adapters may pass it for downstream convenience); the kernel overrides it with
//   the verified claims and rejects if a passed `caller` disagrees with the token.
export interface CanonicalInvocation {
  readonly token: string;
  readonly caller?: CallerIdentity;
  readonly capability: { readonly name: string; readonly version?: string };
  readonly input: YamlValue;
  readonly sessionId?: string;
}

// CID:types-004 - GatewayErrorPayload
// Purpose: structured error shape returned by every failure path; consumers match on `code`, not `message`
// Locally redefined with YamlValue-aware details (the @platform/errors
// version uses `unknown` to avoid a YamlValue dependency; the gateway-core
// boundary tightens back to YamlValue for its public API).
export interface GatewayErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, YamlValue>>;
  readonly retryable: boolean;
}

// CID:types-005 - CanonicalResponse
// Purpose: discriminated union of success or failure returned by handleInvocation
export type CanonicalResponse =
  | { readonly output: YamlValue }
  | { readonly error: GatewayErrorPayload };

// CID:types-006 - AuditRecord
// Purpose: one durable record per invocation; persisted to disk and emitted on Event Bus as gateway.invocation
//   `tenantId` is recorded explicitly (Q8: every record is tenant-scoped).
export interface AuditRecord {
  readonly schemaVersion: 1;
  readonly ts: number;
  readonly tenantId: string;
  readonly caller: { readonly id: string; readonly scope: readonly string[] };
  readonly session?: { readonly id: string };
  readonly capability: { readonly name: string; readonly version: string };
  readonly owner: string;
  readonly status: "ok" | "denied" | "error";
  readonly denyReason?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly durationMs: number;
}

// CID:types-007 - TenantRecord
// Purpose: durable tenant state; persisted to ~/.agentide/data/tenants.json
export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly suspended: boolean;
}

// CID:types-008 - TokenClaims
// Purpose: JWT payload shape; signed with HS256; verified on every invocation
export interface TokenClaims {
  readonly sub: { readonly tenantId: string; readonly callerId: string };
  readonly scope: readonly string[];
  readonly expectedOrigins?: readonly string[];
  readonly iat: number;
  readonly exp: number;
}

// CID:types-009 - RateLimitBucketConfig
// Purpose: per-(tenantId, callerId) token bucket config; defaults: capacity 100, refill 10/sec, idle ttl 1h
export interface RateLimitBucketConfig {
  readonly capacity: number;
  readonly tokensPerSecond: number;
  readonly idleTtlMs?: number;
}

// CID:types-011 - Clock
// Purpose: time abstraction; tests inject a fake Clock; production uses Date.now()
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

// CID:types-012 - FileSystem
// Purpose: filesystem seam; production uses Node fs.promises; tests use an in-memory fake
//   writeFile is APPEND (mirrors fs.appendFile) so append-only log files don't lose history.
//   The optional `mode` parameter carries POSIX file mode (e.g., 0o600 for secrets).
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string, mode?: number): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// CID:types-010 - GatewayConfig
// Purpose: factory config — paths, timeouts, rate limit, clock (defaults documented)
export interface GatewayConfig {
  readonly installRecordPath?: string;
  readonly auditLogPath?: string;
  readonly tenantsPath?: string;
  readonly secretPath?: string;
  readonly cleanupTimeoutMs?: number;
  readonly rateLimit?: RateLimitBucketConfig;
  readonly handlerTimeoutMs?: number;
  readonly clock?: Clock;
  readonly fs?: FileSystem;
  readonly eventBus?: import("@spanexx/event-bus").EventBus;
  readonly backendRuntime?: import("@spanexx/backend-runtime").BackendRuntime;
}

// CID:types-013 - Adapter
// Purpose: protocol-translator interface (MCP, REST, CLI, WS); the kernel knows nothing about adapters
export interface Adapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// CID:types-014 - GatewayStatus
// Purpose: snapshot returned by Gateway.status() — uptime, tenant/plugin counts, audit log size
export interface GatewayStatus {
  readonly uptimeMs: number;
  readonly tenantCount: number;
  readonly pluginCount: number;
  readonly auditLogBytes: number;
}

// CID:types-015 - IssueTokenRequest
// Purpose: input shape for Gateway.issueToken() — used by operators to mint tokens for apps
export interface IssueTokenRequest {
  readonly tenantId: string;
  readonly callerId: string;
  readonly scope: readonly string[];
  readonly expiresInMs?: number;
  readonly expectedOrigins?: readonly string[];
}

// CID:types-016 - CreateTenantRequest
// Purpose: input shape for Gateway.createTenant()
export interface CreateTenantRequest {
  readonly id: string;
  readonly name: string;
}

// CID:types-017 - Gateway
// Purpose: kernel interface — handleInvocation (canonical entry point) + tenant/token lifecycle + adapter registration
export interface Gateway {
  handleInvocation(req: CanonicalInvocation): Promise<CanonicalResponse>;
  registerAdapter(adapter: Adapter): Promise<void>;
  unregisterAdapter(name: string): Promise<void>;
  issueToken(req: IssueTokenRequest): Promise<{ readonly token: string; readonly claims: TokenClaims }>;
  createTenant(req: CreateTenantRequest): Promise<TenantRecord>;
  listTenants(): readonly TenantRecord[];
  suspendTenant(id: string): Promise<TenantRecord>;
  deleteTenant(id: string): Promise<void>;
  status(): Promise<GatewayStatus>;
}