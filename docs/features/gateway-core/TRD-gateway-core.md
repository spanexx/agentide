# TRD: Gateway Core

## Status

- Type: Technical requirements document
- Audience: Backend, QA
- Scope: In-process control-plane component that authenticates callers, authorizes capability invocations, manages sessions, dispatches to capability handlers, audits every invocation, applies rate limits, and enforces tenant isolation. Ships with a separable adapter interface and one default MCP adapter. Plus a meta-package (`@platform/agentide`) that composes Tier 1 + gateway-core + the default adapter and ships the `agentide` CLI + binary/Docker distribution.
- PRD: [PRD-gateway-core.md](./PRD-gateway-core.md)
- EXPLAINED: [EXPLAINED-gateway-core.txt](./EXPLAINED-gateway-core.txt)
- GRILL: [GRILL-gateway-core.txt](./GRILL-gateway-core.txt)

## 1. Current Baseline

### 1.1 Data model

The relevant existing types in the platform are:

- **Event Bus types** (`packages/event-bus/src/types.ts:75-78`): `PlatformEvent<TPayload>`, `EventHandler<TPayload>`, `HandlerFailedPayload`, `Subscription`, `EventBus` interface (`publish()`, `subscribe()`), `RESERVED_INTERNAL_PREFIX = "event."`
- **Capability Registry types** (`packages/capability-registry/src/types.ts:30-106`): `CapabilityType = "business" | "platform" | "runtime"`, `CapabilityRecord { name, version, type, description, inputSchema?, outputSchema?, permissions: readonly string[], owner }`, `DescribeResult`, `UpdatedRecord`, `RegisterResult`, `CapabilityRegisteredPayload`, `CapabilityUpdatedPayload`, `CapabilityRemovedPayload`, `CapabilityRegistry` (4 methods: `register`, `list`, `search`, `describe`)
- **Session Manager types** (`packages/session-manager/src/types.ts`): `SessionRecord`, `ResourceRecord`, `SessionManager` interface (`create`, `resume`, `touch`, `destroy`, `getStatus`, `attachResource`, `detachResource`, `listResources`), `SessionManagerConfig`, `Clock`
- **Plugin Manager types** (`packages/plugin-manager/src/types.ts`): `PluginType = "runtime" | "service" | "developer"`, `PluginManifest`, `InstallRecord { id, type, version, source, installedAt, enabled, lastError? }`, `PluginError`, `PluginManagerConfig`, `PluginManager` interface (9 methods: `install`, `installFromRegistry`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get`), `YamlParser`, `YamlValue` (recursive type), event payload types (PluginInstalledPayload etc.), `PluginManagerError` class

No Gateway-specific types exist anywhere. No canonical Invocation shape, no Audit Record, no Rate Limit Bucket, no Tenant Record, no GATEWAY_* error codes.

### 1.2 API surface

The current public API surfaces are:

- `@platform/event-bus`: `createEventBus()` → `EventBus.publish()`, `EventBus.subscribe()`
- `@platform/capability-registry`: `createCapabilityRegistry(eventBus)` → `{ register, list, search, describe }`
- `@platform/session-manager`: `createSessionManager(eventBus, config?)` → `SessionManager` (8 methods)
- `@platform/plugin-manager`: `createPluginManager(eventBus, capabilityRegistry, config?)` → `Promise<PluginManager>` (9 methods)

No Gateway exists. No adapter interface exists. No `handleInvocation` exists. No `auth.token.issue` exists. No `tenant.*` capabilities exist. No operator CLI exists.

### 1.3 Frontend surface

None. (The eventual Dashboard, Browser DevTools, VS Code extension are separate packs.)

### 1.4 What is missing

- No canonical Invocation packet type
- No `Gateway` interface or `createGateway` factory
- No `Adapter` interface for protocol translation
- No `Caller`, `Session`, `Capability`, `Input` data models
- No JWT signing/verification utilities (we'll write HS256 ourselves using Node `crypto`)
- No `Audit Record` type or append-only writer
- No `Rate Limit Bucket` type or token-bucket algorithm
- No `Tenant Record` type or tenant lifecycle methods
- No `GATEWAY_*` error code constants
- No `auth.token.issue` capability
- No `tenant.{create,list,suspend,delete}` capabilities
- No operator CLI
- No install.sh / binary / Docker image distribution
- No MCP adapter package

## 2. Target Architecture

### 2.1 Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│                 @platform/agentide                          │
│  - Composition: createPlatform(config)                     │
│  - CLI: agentide init / start / stop / status / logs / ...   │
│  - Distribution: install.sh + binary + Docker image + npx  │
└────────────────────────────────────────────────────────────┘
            │                                │
            │ uses                            │ uses
            ▼                                ▼
┌─────────────────────────────────┐    ┌──────────────────────┐
│   @platform/gateway-core         │    │ @platform/adapter-mcp │
│   (the kernel)                    │    │ (default adapter)    │
│                                  │    │ Streamable HTTP       │
│  ┌───────────────────────────┐   │    │ on localhost:7100     │
│  │ createGateway(...)        │   │    └──────────────────────┘
│  │ returns Gateway           │   │            │
│  │                           │   │   registers via
│  │   Gateway.handleInvocation│◄──┼─── Adapter.register(gateway)
│  │   (canonical entry point) │   │
│  │                           │   │
│  │   Internal helpers:       │   │
│  │   - verifyToken           │   │
│  │   - checkAuthz            │   │
│  │   - resolveSession        │   │
│  │   - rateLimit             │   │
│  │   - audit                 │   │
│  │   - dispatch              │   │
│  └───────────────────────────┘   │
└─────────────────────────────────┘
   │      │       │       │       │
   ▼      ▼       ▼       ▼       ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────────┐
│Event ││Capa- ││Sess- ││Plugin││(reserved)│
│Bus   ││bility││ion   ││Mgr   ││Backend   │
│      ││Reg.  ││Mgr   ││      ││Runtime   │
└──────┘└──────┘└──────┘└──────┘└──────────┘
```

The Gateway is a kernel. Adapters are pluggable. The CLI is a shell over kernel capabilities. The meta-package wires it all together. Per PHILOSOPHY § Tiny Kernel, the Gateway knows nothing about MCP, REST, CLI, or any transport.

### 2.2 New or changed data models

All new. Lives in `@platform/gateway-core`.

#### `CanonicalInvocation` (the input to `handleInvocation`)

```ts
interface CanonicalInvocation {
  readonly caller: CallerIdentity;       // required
  readonly capability: { readonly name: string; readonly version?: string };
  readonly input: unknown;               // JSON value matching the capability's inputSchema (handler validates)
  readonly sessionId?: string;            // required for some capabilities; see Q3 split
}
```

#### `CallerIdentity` (carried through every check)

```ts
interface CallerIdentity {
  readonly tenantId: string;              // always set; from token.sub.tenantId
  readonly callerId: string;              // always set; from token.sub.callerId
  readonly scope: readonly string[];      // always set; from token.scope
}
```

#### `AuditRecord` (one line per invocation)

```ts
interface AuditRecord {
  readonly schemaVersion: 1;              // reserved for forward compat
  readonly ts: number;                     // Date.now()
  readonly caller: { readonly id: string; readonly scope: readonly string[] };
  readonly session?: { readonly id: string };
  readonly capability: { readonly name: string; readonly version: string };  // version resolved
  readonly owner: string;                 // CapabilityRecord.owner
  readonly status: "ok" | "denied" | "error";
  readonly denyReason?: string;           // when status="denied" (a GATEWAY_* code)
  readonly errorCode?: string;            // when status="error" (a GATEWAY_* code)
  readonly errorMessage?: string;         // when status="error"
  readonly durationMs: number;            // stop - start
}
```

Required by PRD. Not serialized to JSON Schema in v1 (the schema evolves as needed; reserved `schemaVersion: 1`).

#### `RateLimitBucket` (in-memory only)

```ts
interface RateLimitBucketConfig {
  readonly capacity: number;               // default 100
  readonly tokensPerSecond: number;        // default 10
}

// Per-caller state held in a Map<BucketKey, RateLimitBucket>:
//   BucketKey = `${tenantId}:${callerId}`
```

Not exported as a type — implementation detail of the Gateway.

#### `TenantRecord` (one per tenant)

```ts
interface TenantRecord {
  readonly id: string;                     // unique
  readonly name: string;                   // human-readable
  readonly createdAt: number;
  readonly suspended: boolean;             // toggled by tenant.suspend
}
```

Persisted to `~/.agentide/data/tenants.json` (atomic write, same pattern as Plugin Manager's `installed-plugins.json`).

#### `BootstrapToken`

Not a type — just a runtime JWT string. Signed via HS256 with the Gateway's secret. Claims:

```ts
{
  sub: { tenantId: string, callerId: string },
  scope: string[],
  iat: number,
  exp: number,
}
```

The secret lives in `~/.agentide/data/gateway-secret` (auto-generated on first run, persisted with mode 0600). Not exposed publicly.

#### `GatewayError` (the structured error class)

```ts
class GatewayError extends Error implements PluginError {
  // (re-uses the same shape as the Plugin Manager's PluginManagerError)
  public readonly code: string;            // a GATEWAY_* code
  public readonly details: Readonly<Record<string, YamlValue>>;
  public readonly retryable: boolean;       // hint to caller
}
```

#### GATEWAY_* error codes (16 codes, stable)

```ts
const GATEWAY_ERROR_CODES = {
  AUTH_FAILED: "GATEWAY_AUTH_FAILED",
  INSUFFICIENT_SCOPE: "GATEWAY_INSUFFICIENT_SCOPE",
  SESSION_REQUIRED: "GATEWAY_SESSION_REQUIRED",
  RATE_LIMIT_EXCEEDED: "GATEWAY_RATE_LIMIT_EXCEEDED",
  CAPABILITY_NOT_FOUND: "GATEWAY_CAPABILITY_NOT_FOUND",
  PLUGIN_NOT_INSTALLED: "GATEWAY_PLUGIN_NOT_INSTALLED",
  PLUGIN_DISABLED: "GATEWAY_PLUGIN_DISABLED",
  SDK_UNREACHABLE: "GATEWAY_SDK_UNREACHABLE",
  MANAGER_UNAVAILABLE: "GATEWAY_MANAGER_UNAVAILABLE",
  HANDLER_TIMEOUT: "GATEWAY_HANDLER_TIMEOUT",
  INTERNAL_ERROR: "GATEWAY_INTERNAL_ERROR",
  TENANT_MISMATCH: "GATEWAY_TENANT_MISMATCH",
  TOKEN_INVALID: "GATEWAY_TOKEN_INVALID",
  TOKEN_EXPIRED: "GATEWAY_TOKEN_EXPIRED",
  INVALID_REQUEST: "GATEWAY_INVALID_REQUEST",   // bad canonical packet
  UNAUTHORIZED_OPERATION: "GATEWAY_UNAUTHORIZED_OPERATION",
} as const;
```

Codes map to JSON-RPC errors per the MCP adapter (see §2.3).

#### `Adapter` interface

```ts
interface Adapter {
  readonly name: string;                   // "mcp", "rest", etc.
  start(): Promise<void>;                 // begin listening; adapter calls gateway.handleInvocation internally
  stop(): Promise<void>;                  // graceful shutdown
  // Adapter holds its own transport (HTTP server, etc.); no port/schema leak into the kernel.
}
```

The adapter is given a reference to the Gateway at registration time (passed by the meta-package or by a custom boot script). The adapter calls `gateway.handleInvocation(...)` for each inbound request.

#### `Gateway` interface

```ts
interface Gateway {
  // Kernel entry point. The only function adapters call.
  handleInvocation(req: CanonicalInvocation): Promise<CanonicalResponse>;

  // Adapter lifecycle
  registerAdapter(adapter: Adapter): Promise<void>;
  unregisterAdapter(name: string): Promise<void>;

  // Tenant + token lifecycle (also exposed as capabilities — see §2.3)
  issueToken(req: IssueTokenRequest): Promise<{ token: string; claims: TokenClaims }>;
  createTenant(req: CreateTenantRequest): Promise<TenantRecord>;
  listTenants(): readonly TenantRecord[];
  suspendTenant(id: string): Promise<TenantRecord>;
  deleteTenant(id: string): Promise<void>;

  // Configuration introspection
  status(): GatewayStatus;
}

type CanonicalResponse =
  | { readonly output: unknown }                     // success
  | { readonly error: GatewayErrorPayload };         // failure
```

### 2.3 API contracts

#### Factory

```ts
async function createGateway(
  eventBus: EventBus,
  capabilityRegistry: CapabilityRegistry,
  sessionManager: SessionManager,
  pluginManager: PluginManager,
  config?: GatewayConfig,
): Promise<Gateway>;
```

| Parameter | Required | Notes |
|---|---|---|
| `eventBus` | Yes | For publishing `gateway.invocation` events |
| `capabilityRegistry` | Yes | For lookup + per-request collision check |
| `sessionManager` | Yes | For `session.*` capability dispatch |
| `pluginManager` | Yes | For `plugin.*` capability dispatch + runtime plugin handler lookup |
| `config.installRecordPath` | No | Default `~/.agentide/data/gateway-state.json` (audit log path, tenant path, secret path derive from this) |
| `config.auditLogPath` | No | Default `${dataDir}/audit.log` |
| `config.tenantsPath` | No | Default `${dataDir}/tenants.json` |
| `config.secretPath` | No | Default `${dataDir}/gateway-secret` (mode 0600) |
| `config.cleanupTimeoutMs` | No | Default 5000 |
| `config.rateLimit` | No | Default `{ capacity: 100, tokensPerSecond: 10 }` |
| `config.handlerTimeoutMs` | No | Default 30000 |
| `config.clock` | No | Default system clock |

The factory is async (per Q1 grilling — I/O can't be sync in Node). Startup performs initial state load (tenants from disk, secret from disk).

#### `handleInvocation(req): Promise<CanonicalResponse>`

The canonical entry point. Flow (per PRD §Product Scope — Core flow — agent invocation):

1. Validate `req` shape (reject with `GATEWAY_INVALID_REQUEST` if malformed).
2. Verify caller's token. If invalid → `GATEWAY_AUTH_FAILED` (or `GATEWAY_TOKEN_EXPIRED` / `GATEWAY_TOKEN_INVALID`).
3. Rate-limit check (consume 1 token; if empty → `GATEWAY_RATE_LIMIT_EXCEEDED`).
4. If `req.sessionId` present: verify session belongs to caller's tenant (else `GATEWAY_SESSION_REQUIRED` or `GATEWAY_TENANT_MISMATCH`).
5. Resolve `capability.version` (omit → auto-latest via `capabilityRegistry.describe(name)`).
6. Capability requires session check (Q3 split). If required and missing → `GATEWAY_SESSION_REQUIRED`.
7. Authz check (tier-hierarchy, per Q4). If denied → `GATEWAY_INSUFFICIENT_SCOPE`.
8. Audit: append `{ status: "denied", ... }` if any check above failed. (Or `{ status: "ok", ... }` after success.)
9. Dispatch (per Q5 three-path model).
10. Apply `config.handlerTimeoutMs` (default 30s) → if exceeded, `GATEWAY_HANDLER_TIMEOUT` returned with `isError: true` in MCP shape.
11. Audit: append `{ status: "ok" | "error", durationMs, ... }`.
12. Emit `gateway.invocation` event.
13. Return `CanonicalResponse`.

#### Capabilities exposed by the Gateway itself (via Plugin Manager registration)

The Gateway's own capabilities (auth, sessions, tenants, capability list) are registered with the Capability Registry during factory setup. Plugin Manager is told the Gateway as `owner: "gateway"`. Owners on these capabilities are `gateway` — dispatch routes them in-process.

| Capability | Permission | Notes |
|---|---|---|
| `auth.token.issue` | `platform.token.issue` | Issues a JWT. Requires operator scope. |
| `auth.token.revoke` | `platform.token.issue` | Revokes a token (adds to a deny-list; v1 may be a no-op since JWTs are stateless) |
| `session.create` | `platform.session.create` | Creates a session; no scope required for caller |
| `session.resume` | `platform.session.read` | Resumes by `sessionId` |
| `session.destroy` | `platform.session.delete` | Destroys by `sessionId` |
| `session.touch` | `platform.session.write` | Resets idle timer |
| `session.list` | `platform.session.read` | Lists sessions in caller's tenant |
| `tenant.create` | `platform.tenant.write` | Creates a tenant + bootstrap token |
| `tenant.list` | `platform.tenant.read` | Lists tenants in caller's view (own tenant only in v1 self-hosted) |
| `tenant.suspend` | `platform.tenant.write` | Suspends a tenant |
| `tenant.delete` | `platform.tenant.write` | Deletes a tenant (with confirmation prompt) |
| `capability.list` | `platform.capability.read` | Lists all capabilities in the catalog (filtered by caller's tenant + scope) |
| `capability.describe` | `platform.capability.read` | Describes a single capability |
| `gateway.status` | `platform.gateway.read` | Returns runtime status: uptime, tenant count, plugin count, request rate, audit log size |
| `gateway.metrics` | `platform.gateway.read` | Returns counters: invocations by status, rate-limit denials, authz denials, etc. |
| `gateway.configuration` | `platform.gateway.read` | Returns effective config (with secrets redacted) |

Note: `session.*`, `capability.*`, `tenant.*`, `auth.*`, `gateway.*` are all "platform" capabilities (`CapabilityType = "platform"`).

#### MCP adapter (`@platform/adapter-mcp`)

The default adapter. Lives in a separate npm package. Implements `Adapter` interface. Uses Streamable HTTP transport (per MCP spec).

Maps `tools/list` → `handleInvocation({capability: {name: "capability.list"}, input: {}})`. Filters returned capabilities by caller's scope.

Maps `tools/call {name, arguments}` → `handleInvocation({capability: {name, version?}, input: arguments, sessionId?})`. Where `sessionId` is read from `_meta.dev.agentide/sessionId`.

Maps responses:
- `{ output }` → `{ result: { content: [{type: "text", text: <serialized JSON>}], structuredContent: <output> } }` (or just `content` if output isn't JSON-shaped)
- `{ error: { code: "GATEWAY_HANDLER_TIMEOUT", ... } }` → `{ result: { content: [...], isError: true } }` (tool-level error per MCP spec)
- `{ error: { code: <other GATEWAY_*> } }` → JSON-RPC error with custom code (per the mapping table below)

**MCP error code mapping** (per Phase 0.5 opensrc findings):

| Our `GATEWAY_*` | MCP surface | JSON-RPC code |
|---|---|---|
| `GATEWAY_AUTH_FAILED`, `GATEWAY_TOKEN_INVALID`, `GATEWAY_TOKEN_EXPIRED` | Protocol error | `-32001` (custom; data: `{code: "GATEWAY_AUTH_FAILED", ...}`) |
| `GATEWAY_INSUFFICIENT_SCOPE`, `GATEWAY_UNAUTHORIZED_OPERATION` | Protocol error | `-32001` (data: `{code: "GATEWAY_INSUFFICIENT_SCOPE", ...}`) |
| `GATEWAY_RATE_LIMIT_EXCEEDED` | Protocol error | `-32001` (data: `{code: "GATEWAY_RATE_LIMIT_EXCEEDED", ...}`) |
| `GATEWAY_CAPABILITY_NOT_FOUND` | Protocol error | `-32601` Method not found |
| `GATEWAY_PLUGIN_NOT_INSTALLED`, `GATEWAY_PLUGIN_DISABLED` | Protocol error | `-32001` (custom) |
| `GATEWAY_SDK_UNREACHABLE` | Protocol error | `-32003` (custom; data: `{code: "GATEWAY_SDK_UNREACHABLE", ...}`) |
| `GATEWAY_MANAGER_UNAVAILABLE` | Protocol error | `-32004` (custom) |
| `GATEWAY_HANDLER_TIMEOUT` | **Tool error** → `isError: true` in result | (not a JSON-RPC error) |
| `GATEWAY_INTERNAL_ERROR` | Protocol error | `-32603` Internal error |
| `GATEWAY_SESSION_REQUIRED` | Protocol error | `-32001` (custom) |
| `GATEWAY_TENANT_MISMATCH` | Protocol error | `-32001` (custom) |
| `GATEWAY_INVALID_REQUEST` | Protocol error | `-32602` Invalid params (for malformed requests) |

All JSON-RPC errors include `data: { code: "GATEWAY_*", message, details, retryable }` so MCP clients can branch on the structured code.

#### CLI surface (`@platform/agentide`)

Thin shell over gateway-core. Subcommands:

| Command | Maps to |
|---|---|
| `agentide init` | First-run bootstrap (create default tenant, generate operator token, write config) |
| `agentide start` | Compose all components + start MCP adapter (foreground) |
| `agentide start --daemon` | Background (systemd / launchd / Docker equivalent) |
| `agentide stop` | Stop the running platform |
| `agentide status` | Gateway.status() |
| `agentide logs` | Tail `audit.log` |
| `agentide logs --follow` | `tail -f audit.log` |
| `agentide upgrade` | Binary: download latest. Docker: `docker pull`. (No auto-update mechanism in v1; just re-run.) |
| `agentide tenant create <id> <name>` | `gateway.createTenant(...)` |
| `agentide tenant list` | `gateway.listTenants()` |
| `agentide tenant suspend <id>` | `gateway.suspendTenant(...)` |
| `agentide tenant delete <id>` | `gateway.deleteTenant(...)` |
| `agentide token issue --tenant <id> --caller <id> --scope <...> [--expires-in <duration>]` | `gateway.issueToken(...)` |
| `agentide plugin install --source <path>` | `pluginManager.install(...)` (shell over Plugin Manager) |
| `agentide plugin list` | `pluginManager.list()` |
| `agentide capability list` | `gateway.handleInvocation({capability: {name: "capability.list"}})` |
| `agentide capability describe <name>` | `gateway.handleInvocation({capability: {name: "capability.describe"}, input: {name}})` |

Distribution: `agentide` is a single binary built with Node `--experimental-sea-config`. Same source builds the Docker image (multi-stage). npm CLI distribution via `npx @platform/agentide` for dev machines.

### 2.4 Frontend changes

None. (No browser-side work in v1.)

## 3. Dependency Analysis

For each external dependency, opensrc was run. Findings:

### 3.1: `@platform/event-bus`

**Version**: workspace `*` (resolved to `0.0.0`)
**Purpose**: publish `gateway.invocation` events; subscribe to `plugin.*` events from Plugin Manager

**opensrc inspection**: N/A — first-party workspace package. Source at `packages/event-bus/src/`.
- `packages/event-bus/src/types.ts:75-78` confirms `EventBus` interface has `publish(name, payload)` and `subscribe(pattern, handler)`
- `packages/event-bus/src/index.ts:63` confirms `createEventBus()` factory
- `event.*` is reserved; `gateway.*` is fair game

**Findings**: Source confirms standard pub/sub. Per-request sync handlers via `dispatchToSnapshot`; async handlers awaited via `Promise.allSettled`. Failures surfaced as `event.handler_failed` — never silent. We don't need to handle handler failures specially (we're a producer, not consumer of `event.handler_failed`).

**Why chosen over alternatives**: N/A — Tier 1 foundation.

### 3.2: `@platform/capability-registry`

**Version**: workspace `*`
**Purpose**: capability lookup (`describe`, `list`); collision check; per-request filtering

**opensrc inspection**: N/A — first-party. Source at `packages/capability-registry/src/`.
- `packages/capability-registry/src/types.ts:97-106` confirms `CapabilityRegistry.register(owner, manifest)` returns `Promise<RegisterResult>`
- `packages/capability-registry/src/index.ts:32-90` confirms `register` diffs against the owner's existing manifest; throws on cross-owner collision

**Findings**: `describe(name)` returns the latest version when no version specified. `describe(name, version)` returns a specific version. Cross-owner collision detection happens inside `register`. We use `describe` (not `register`) — we don't add or remove capabilities through the Gateway.

**Why chosen over alternatives**: N/A.

### 3.3: `@platform/session-manager`

**Version**: workspace `*`
**Purpose**: `session.*` capability dispatch; session lifecycle ownership

**opensrc inspection**: N/A — first-party. Source at `packages/session-manager/src/`.
- `packages/session-manager/src/index.ts:51-56` confirms `createSessionManager(eventBus, config?) → SessionManager`
- `create()`, `resume()`, `destroy()`, `touch()`, `getStatus()`, `attachResource()`, `detachResource()`, `listResources()` available

**Findings**: We only need `create / resume / destroy / touch / listResources` from the Session Manager — the rest are for SDKs and runtimes. We call these through the Plugin Manager's dispatch layer (Q5 path a — platform built-ins), not directly.

**Why chosen over alternatives**: N/A.

### 3.4: `@platform/plugin-manager`

**Version**: workspace `*`
**Purpose**: `plugin.*` capability dispatch; runtime plugin handler reference

**opensrc inspection**: N/A — first-party. Source at `packages/plugin-manager/src/`.
- `packages/plugin-manager/src/index.ts:50` confirms `createPluginManager` is async
- `packages/plugin-manager/src/lifecycle.ts` contains the `install`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get` methods

**Findings**: We use `list()` to enumerate installed plugins (for `plugin.list` capability) and the dispatch-via-owner mechanism (the Gateway invokes the Plugin Manager's capability-handler lookup, which returns the runtime plugin's handler function in-process).

**Why chosen over alternatives**: N/A.

### 3.5: `yaml` (used by Plugin Manager; no direct gateway-core use)

The Gateway itself doesn't parse YAML. The Plugin Manager does, and the Gateway registers Plugin-Manager-owned capabilities (`plugin.list` → calls `pluginManager.list()`).

**Why chosen over alternatives**: N/A — not a gateway-core dep.

### 3.6: `@modelcontextprotocol/typescript-sdk` (only for the MCP adapter, NOT the kernel)

**Version**: not a runtime dep of `@platform/gateway-core`; will be a dep of `@platform/adapter-mcp` if we choose to use the SDK. **Or**: we implement Streamable HTTP ourselves using Node `http` / `express` and parse JSON-RPC by hand. Decision deferred to adapter pack's IMPL.

**opensrc inspection** (already run during Phase 0.5):
```bash
opensrc path modelcontextprotocol/typescript-sdk@latest
opensrc path modelcontextprotocol/modelcontextprotocol@latest
```

**Findings** (carried over from Phase 0.5):
- JSON-RPC 2.0 envelope required (`packages/modelcontextprotocol/modelcontextprotocol/latest/docs/specification/draft/basic/index.mdx:25-100`)
- `_meta.io.modelcontextprotocol/protocolVersion` + `clientCapabilities` required on every request
- Stateless protocol — every request carries context in `_meta` (line 184)
- Tool names: `[A-Za-z0-9_.\-]{1,128}` (strict subset of MCP allowance: lowercase-with-dot)
- Error model split: tool errors → `isError: true` in result; protocol-level errors → JSON-RPC error codes
- Streamable HTTP transport: `POST /mcp`, JSON or request-scoped SSE (`/transports/streamable-http.mdx`)
- OAuth 2.1 is the MCP-standard auth but marked OPTIONAL; `Authorization: Bearer <jwt>` is compliant
- v1 MCP adapter scope: `tools/list` + `tools/call` only

**Why chosen over alternatives** (for the adapter):
- Use the SDK: less code to write; matches MCP spec exactly; tested against reference clients. But: pulls in a non-trivial dep; potentially leaks MCP-shaped types into gateway-core.
- Implement by hand: zero new deps; full control over wire format; fewer abstraction layers. But: more code; we own the MCP conformance.
- **Decision deferred to adapter's IMPL** — both are viable. Likely default: use SDK for protocol parsing, keep our own types in the kernel.

**Why gateway-core itself doesn't depend on the SDK**: PHILOSOPHY § Tiny Kernel. The kernel's canonical API is the only contract. Adapters translate.

### Summary table

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| `@platform/event-bus` | workspace | Publish `gateway.invocation`; subscribe to `plugin.*` events | `publish`/`subscribe` interface at `types.ts:75-78`; `event.*` reserved | N/A (Tier 1) |
| `@platform/capability-registry` | workspace | Capability lookup; per-request collision | `describe(name, version?)` returns latest when version omitted | N/A (Tier 1) |
| `@platform/session-manager` | workspace | `session.*` capability dispatch | 8 lifecycle methods, idle suspend, archive purge | N/A (Tier 1) |
| `@platform/plugin-manager` | workspace | `plugin.*` capability dispatch; runtime handler ref | Async factory, 9 methods; install records persist to JSON file | N/A (Tier 1) |
| `@modelcontextprotocol/typescript-sdk` | `^1.x` (deferred to adapter) | MCP protocol parsing for the adapter (kernel does NOT depend) | Reference impl of JSON-RPC 2.0 + Streamable HTTP + tools/list/call | Implement by hand — viable but more code |
| `yaml` | `^2.6.0` (already in plugin-manager) | Plugin Manifest parsing (via Plugin Manager) | `parse()`, `YAMLParseError.linePos[0]` for error location | N/A — plugin-manager dep |
| Node `crypto` | built-in | HMAC-SHA256 for JWT signing (HS256) | No new dep needed | `jsonwebtoken` package — rejected (extra dep for ~30 lines of code we own) |
| Node `http` | built-in | (adapter) Streamable HTTP server | Built-in module | `express` — viable for adapter, deferred |

**No new runtime dependencies for `@platform/gateway-core` beyond the four Tier 1 workspace packages.** The adapter (`@platform/adapter-mcp`) may add `@modelcontextprotocol/typescript-sdk` or implement Streamable HTTP by hand — decision in adapter's IMPL.

## 4. Migration Strategy

### 4.1 Additive phase

gateway-core is entirely additive. No existing component depends on a Gateway. The Gateway depends on the four Tier 1 components but not the other way around.

Deployment:
- `@platform/agentide` (new meta-package) wires Tier 1 + gateway-core + the default MCP adapter. Operators install this single package.
- No flag day, no migration script, no coordination with downstream packages (downstream doesn't exist yet — `sdk-node`, `rest-adapter` etc. are all future packs).

### 4.2 Migration / transition phase

None. v1 is the first release.

### 4.3 Compatibility rails

None needed.

### 4.4 Rollback plan

If a critical bug is found post-release:
- Operators stop the platform (`agentide stop`).
- Reinstall prior version via `agentide upgrade --rollback` (binary) or `docker run ...:<prev-tag>` (Docker).
- Audit log + tenant records are versioned by date in their JSON payloads; rolling back to a prior gateway-core version re-reads them as-is.

No data loss because the audit log is append-only and tenant records are forward-compatible (no fields removed).

## 5. Open Questions

None. All design decisions were locked during Phase 0 grilling (Q1–Q12, recorded in `GRILL-gateway-core.txt` and `docs/CONTEXT.md` Decisions Log).

Implementation-level open questions (deferred to IMPL phase, per the feature-pipeline skill):
- [ ] Should the kernel validate `req.input` against the capability's `inputSchema` before dispatch, or trust the handler? → IMPL decision. PRD says "trust the handler"; IMPL can revisit if user feedback asks.
- [ ] Should the MCP adapter use the official TypeScript SDK or implement Streamable HTTP by hand? → Adapter IMPL.
- [ ] Should rate-limit buckets use a sliding window or strict token bucket? → Implementation detail; the public behavior is "capacity tokens, refill N per second."
- [ ] How does the `agentide` CLI surface Y/N confirmation prompts (`tenant.delete` requires confirmation)? → CLI IMPL.

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| OAuth 2.1 + Authorization Server Discovery (MCP standard auth) | MCP marks auth as OPTIONAL; v1 ships simpler `Authorization: Bearer <jwt>`. Adding OAuth requires an authorization server (could be the Gateway itself, but adds non-trivial code). | When the hosted pack ships OR when an external IdP integration is needed |
| Multi-process / distributed state (Redis buckets, DB audit, sticky session routing) | v1 is single-process; scaling assumptions baked into in-memory buckets and file-based audit. | When a customer requires horizontal scaling |
| Capability input validation in the Gateway (JSON Schema via Ajv or similar) | Trusts the handler in v1; PRD non-goal. Validation in the handler keeps the kernel simple. | When handlers commonly return malformed-input errors that the caller can't interpret |
| Per-capability timeout | Single default 30s in v1; per-call `timeoutMs` field is in the canonical packet but only platform-wide override is implemented. | When a capability legitimately needs longer than 30s |
| Streaming / async submit-and-poll / in-flight cancellation | Most capabilities are sync. Long-running ops modeled in handler. | When a v1 caller actually needs streaming |
| Auto-update mechanism (signed binary upgrades) | Operators upgrade manually in v1 (`agentide upgrade`, `docker pull`). | When distribution grows beyond manual operator effort |
| MCP `prompts/*`, `resources/*`, `subscriptions/listen`, server-initiated `notifications/*`, sampling, elicitation | Out of v1 MCP surface. Most agents use `tools/*` only. | When a concrete consumer asks |
| Capability deprecation semantics | Registry doesn't model deprecation. | Plugin Marketplace pack |
| Version-range pinning (`>=1.0.0 <2.0.0`) | Explicit version pin is supported; ranges are deferred. | When a capability author needs to express "I work with 1.x and 2.x but not 0.x" |
| Browser-native extensions, dashboards, observability UI | Covered by separate packs. Gateway exposes `gateway.*` for those. | When those packs ship |
| Hosted-platform provisioning UI | Hosted pack. v1 ships only `tenant.*` capabilities + `agentide tenant create` CLI. | Hosted pack |
| Backend Runtime / SDK connection lifecycle | `backend-sdk-*` dispatch path is wired but no SDK ships in v1. | Tier 3 #8 `sdk-node` |
| Token revocation enforcement (deny-list) | JWTs are stateless in v1; tokens remain valid until `exp`. Adding a deny-list is a hot-path check. | When a customer requires immediate revocation |
| Dynamic rate-limit per caller (e.g., premium tiers) | Single global config in v1. | Hosted pack (premium tier feature) |
| Backend SDK WebSocket transport details | Decided by the SDK pack, not gateway-core. | SDK pack |
| Adapter protocol specifics (REST shape, CLI parsing, WS subprotocol) | Each adapter is its own pack. | Adapter packs |
| Session-level audit query (`gateway.session.history`) | v1 audit log is per-invocation only. | Dashboard pack |
| Multi-region replication | Out of v1 scope. | v2+ |