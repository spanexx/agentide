# Implementation Plan: Gateway Core

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: In-process control-plane component (`@platform/gateway-core`) that authenticates callers, authorizes capability invocations, manages sessions, dispatches to capability handlers, audits every invocation, applies rate limits, and enforces tenant isolation. Plus the default MCP adapter (`@platform/adapter-mcp`) and the operator-facing meta-package (`@platform/agentide`).
- PRD: [PRD-gateway-core.md](./PRD-gateway-core.md)
- TRD: [TRD-gateway-core.md](./TRD-gateway-core.md)
- FLOW: [FLOW-gateway-core.md](./FLOW-gateway-core.md)
- GRILL: [GRILL-gateway-core.txt](./GRILL-gateway-core.txt)

## 1. Planning Principles

1. **Kernel before adapters.** `@platform/gateway-core` ships first with `handleInvocation()` as the canonical entry point. The MCP adapter (`@platform/adapter-mcp`) is a thin translation layer over it. The meta-package (`@platform/agentide`) is composition. Each layer is independently testable. Per PHILOSOPHY § Tiny Kernel — the kernel is the boring part.
2. **Trust Tier 1 components; don't reimplement.** Session lifecycle is owned by `@platform/session-manager`. Capability storage is owned by `@platform/capability-registry`. Plugin lifecycle is owned by `@platform/plugin-manager`. The Gateway composes them — it doesn't replace them.
3. **Strict TDD per phase.** Each phase below is one tracer-bullet cycle: a test that exercises the phase's behavior through the public interface, then minimum code to pass. No writing code before its test. No refactor while red. Per the `tdd` skill.
4. **Audit is a side effect, not the main loop.** Audit must NOT break invocations. File write failure is logged to stderr; invocation still succeeds. Tests must cover this contract.
5. **Per-call timeout always, even when handler doesn't.** The Gateway enforces `config.handlerTimeoutMs` (default 30s). Handlers that respect this are rewarded; handlers that don't time out cleanly via race.
6. **Tokens are stateless in v1.** No revocation deny-list in v1; tokens remain valid until `exp`. Hot-path revocation deferred to TRD-level future trigger.
7. **No protocol-shape leakage.** The kernel's `CanonicalInvocation` and `CanonicalResponse` types contain no JSON-RPC, no MCP, no HTTP. Adapters own the protocol translation.

## 2. Current Baseline

What already works (Tier 1 shipped 2026-07-26 / 2026-07-27) and must not regress:

- **`@platform/event-bus`** (29 tests): `createEventBus()` → `publish(name, payload)` (shallow-freezes payload), `subscribe(pattern, handler)` (returns `Subscription` with idempotent `unsubscribe()`). Async handlers via `Promise.allSettled`; failures surfaced as `event.handler_failed` (never silent). Prefix wildcards. `event.*` reserved.
- **`@platform/capability-registry`** (18 tests): `createCapabilityRegistry(eventBus)` → `{ register, list, search, describe }`. Owner-scoped manifests; cross-owner collision detection inside `register`. `describe(name, version?)` returns latest when no version.
- **`@platform/session-manager`** (67 tests): `createSessionManager(eventBus, config?)` → `SessionManager` with `{ create, resume, touch, destroy, getStatus, attachResource, detachResource, listResources }`. Idle suspend + suspended TTL auto-archive. Events `session.created/suspended/resumed/destroyed/cleanup_resources`.
- **`@platform/plugin-manager`** (175 tests, async factory, registry-failure rollback): `createPluginManager(eventBus, capabilityRegistry, config?) → Promise<PluginManager>` with 9 methods. Startup re-install from disk. 7 `plugin.*` events.

Regression check for every phase: `npm run precommit` + `npm run test -- --run` across all packages (event-bus, capability-registry, session-manager, plugin-manager) plus the new gateway-core.

## 3. Phase Plan

---

### Phase 0: Package scaffold + types + GATEWAY_* error codes

**Goal**: Create `@platform/gateway-core` package. Define all public types. Define error code constants. Wire workspace deps. No runtime behavior yet.

**Why this phase first**: Every subsequent phase depends on these types being importable.

#### Backend tasks

- [ ] Create `packages/gateway-core/` with `package.json` (`@platform/gateway-core`, ESM, private, workspace deps on event-bus + capability-registry + session-manager + plugin-manager)
- [ ] Create `tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`, `outDir: dist`
- [ ] Add workspace reference in root `tsconfig.json`
- [ ] Define types in `src/types.ts`:
  - `CanonicalInvocation` (caller, capability, input, sessionId?)
  - `CallerIdentity` (tenantId, callerId, scope)
  - `CanonicalResponse` (`{ output }` | `{ error: GatewayErrorPayload }`)
  - `GatewayErrorPayload` (code, message, details, retryable)
  - `AuditRecord` (schemaVersion=1, ts, caller, session?, capability, owner, status, denyReason?, errorCode?, errorMessage?, durationMs)
  - `TenantRecord` (id, name, createdAt, suspended)
  - `TokenClaims` (sub: {tenantId, callerId}, scope, iat, exp)
  - `RateLimitBucketConfig` (capacity, tokensPerSecond)
  - `Gateway` interface (`handleInvocation`, `registerAdapter`, `unregisterAdapter`, `issueToken`, `createTenant`, `listTenants`, `suspendTenant`, `deleteTenant`, `status`)
  - `Adapter` interface (`name`, `start`, `stop`)
  - `GatewayConfig` (installRecordPath, auditLogPath, tenantsPath, secretPath, cleanupTimeoutMs, rateLimit, handlerTimeoutMs, clock)
- [ ] Define `GATEWAY_ERROR_CODES` constant object (16 codes per TRD §2.2): `AUTH_FAILED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INSUFFICIENT_SCOPE`, `UNAUTHORIZED_OPERATION`, `SESSION_REQUIRED`, `RATE_LIMIT_EXCEEDED`, `CAPABILITY_NOT_FOUND`, `PLUGIN_NOT_INSTALLED`, `PLUGIN_DISABLED`, `SDK_UNREACHABLE`, `MANAGER_UNAVAILABLE`, `HANDLER_TIMEOUT`, `INTERNAL_ERROR`, `TENANT_MISMATCH`, `INVALID_REQUEST`
- [ ] Define `GatewayError` class extending `Error`, implements the `{ code, message, details, retryable }` shape
- [ ] Create `src/index.ts` re-exporting types + errors + factory placeholder (will throw "not implemented" until Phase 5)
- [ ] Create `src/__tests__/types.test.ts` with type-only smoke tests (types are exported, error codes are correct strings, `GatewayError` has the right shape)
- [ ] Create `src/__tests__/fixtures/` directory placeholder

#### Validation condition

> `npm run build` (or `tsc --build`) compiles successfully. `import { ... } from "@platform/gateway-core"` resolves. `npm test -- --run` passes for the placeholder test. Existing event-bus, capability-registry, session-manager, plugin-manager tests still pass. `npm run precommit` clean.

#### Regression check

> `npm run precommit` + `npm run test -- --run` across all packages. All 174 pre-existing tests + 3-5 new type tests pass.

---

### Phase 1: Audit log writer

**Goal**: Pure append-only writer that takes an `AuditRecord` and writes one JSON line to a file. Mirror the same record on the Event Bus as `gateway.invocation`.

**Why this phase first**: Audit is a side-effect dependency for every `handleInvocation` call. Building it as a pure module first lets subsequent phases use it without worrying about I/O.

#### Backend tasks

- [ ] Implement `AuditWriter` class in `src/audit.ts`:
  - Constructor: `installRecordPath` (derives `auditLogPath = ${path}/audit.log`)
  - `append(record: AuditRecord): Promise<void>` — appends one JSON line to file
  - Atomic-ish: open file, append, close (Node `fs.promises.appendFile`)
  - On failure: log to stderr via `console.warn`, do NOT throw (best-effort)
- [ ] Implement `AuditEventPayload` type (one per `gateway.invocation` event)
- [ ] Add `audit.write` free function: takes `(record, fs, clock, eventBus)`; writes file AND publishes Event Bus event
- [ ] Tests for `AuditWriter`:
  - Writes valid JSON line on append
  - JSON line is parseable end-to-end (round-trip)
  - One append = one line (newline-delimited)
  - File write failure doesn't throw (best-effort)
  - Event Bus event payload mirrors record shape

#### Validation condition

> `AuditWriter` round-trips records through a fake `FileSystem`. Event Bus event payload matches the record exactly.

#### Regression check

> Existing packages unaffected. Precommit + tests pass.

---

### Phase 2: Token verification

**Goal**: Pure module that takes a JWT string and returns either `{ ok: true, claims: TokenClaims }` or `{ ok: false, error: "TOKEN_INVALID" | "TOKEN_EXPIRED" }`. Plus the bootstrap-token issuer (operator-side).

**Why this phase next**: Every `handleInvocation` call begins with token verification. Building it as a pure function means it can be exercised in isolation.

#### Backend tasks

- [ ] Implement `verifyToken(token: string, clock: Clock, secret: Uint8Array): VerifyResult` in `src/auth.ts`:
  - Parse JWT (header.payload.signature)
  - Verify HS256 signature with `crypto.createHmac`
  - Check `exp > clock.now()` (clock injection for testability)
  - Return `{ok: true, claims}` or `{ok: false, code: "TOKEN_INVALID" | "TOKEN_EXPIRED"}`
- [ ] Implement `issueToken(claims: TokenClaims, secret: Uint8Array, clock: Clock): string` — produces a JWT string
- [ ] Implement `generateSecret(): Uint8Array` — 32 random bytes for HS256
- [ ] Implement `loadOrCreateSecret(path: string, fs: FileSystem): Promise<Uint8Array>` — reads from file or generates + persists (mode 0600)
- [ ] Tests for `verifyToken`:
  - Valid token → ok
  - Tampered signature → `TOKEN_INVALID`
  - Expired token → `TOKEN_EXPIRED`
  - Malformed token (not 3 parts) → `TOKEN_INVALID`
  - Algorithm confusion (RS256 token verified as HS256) → `TOKEN_INVALID`
  - Round-trip: `issueToken` followed by `verifyToken` returns same claims

#### Validation condition

> Round-trip tests pass with both real-time and frozen-clock scenarios. Tamper and expiry tests fail with the right error codes.

---

### Phase 3: Rate-limit bucket

**Goal**: Pure in-memory token-bucket implementation. Configurable capacity + refill rate. Per-key (one bucket per `(tenantId, callerId)`). Consumes one token per `tryConsume(key)` call.

#### Backend tasks

- [ ] Implement `RateLimiter` class in `src/rate-limit.ts`:
  - Constructor: `config: RateLimitBucketConfig`, `clock: Clock`
  - `tryConsume(key: string): boolean` — true if token consumed, false if empty
  - `peek(key: string): number` — current tokens (for `gateway.metrics`)
  - Refill: lazy on each `tryConsume` call (compute elapsed, add `elapsed * tokensPerSecond`, cap at `capacity`)
  - No persistence; in-memory only
- [ ] Tests for `RateLimiter`:
  - First `capacity` calls succeed
  - `capacity + 1`th call fails
  - After `1s` of elapsed time, `tokensPerSecond` tokens refilled
  - Different keys have independent buckets
  - Frozen-clock tests deterministic

#### Validation condition

> `RateLimiter` round-trips tokens correctly under frozen-clock and advancing-clock scenarios.

---

### Phase 4: Tenant lifecycle + persistence

**Goal**: In-memory tenant records with disk persistence (`~/.agentide/data/tenants.json`, atomic write). Plus `createTenant`, `listTenants`, `suspendTenant`, `deleteTenant` methods on the Gateway.

#### Backend tasks

- [ ] Implement `TenantStore` class in `src/tenant-store.ts`:
  - Constructor: `tenantsPath: string`, `fs: FileSystem`
  - `load(): Promise<void>` — reads tenants.json
  - `save(): Promise<void>` — atomic write (write to .tmp, rename)
  - `get(id): TenantRecord | null`
  - `set(record): TenantRecord` — inserts or replaces
  - `delete(id): boolean` — removes; returns whether anything was deleted
  - `list(): readonly TenantRecord[]` — insertion order
  - On malformed JSON: throw `GatewayError("INVALID_REQUEST", ...)`
- [ ] Add tenant methods to the (still-stubbed) Gateway factory:
  - `createTenant({id, name}): Promise<TenantRecord>` — validates, generates bootstrap token, returns both
  - `listTenants(): readonly TenantRecord[]`
  - `suspendTenant(id): Promise<TenantRecord>` — toggles `suspended` flag
  - `deleteTenant(id): Promise<void>` — removes from store, persists
- [ ] Tests for `TenantStore`:
  - Atomic writes (fake FS fails mid-write, original intact)
  - Malformed JSON → `INVALID_REQUEST`
  - get/set/delete/list semantics
- [ ] Tests for tenant methods on the Gateway:
  - `createTenant` rejects duplicate IDs
  - `suspendTenant` is idempotent
  - `deleteTenant` then `get` → null

#### Validation condition

> Tenant records round-trip through TenantStore. All four Gateway tenant methods work end-to-end against a fake FS + fake clock.

---

### Phase 5: handleInvocation pipeline + capability registrations

**Goal**: The core of the Gateway. `handleInvocation(req)` performs authn → rate-limit → session check → authz → version resolve → dispatch → audit → return. Plus registration of `auth.*`, `session.*`, `tenant.*`, `capability.*`, `gateway.*` capabilities with the Capability Registry.

**Why this phase now**: All the building blocks (audit, token, rate-limit, tenant store) are in place. This phase composes them.

#### Backend tasks

- [ ] Implement `dispatch()` in `src/dispatch.ts`:
  - Read `capability.owner` from registry
  - Three-path routing per Q5:
    - `owner` starts with `platform-*` (or matches a known manager name) → call manager method directly
    - `owner` starts with `plugin:` → call `pluginManager.handleInvocation(req)` (or equivalent)
    - `owner` starts with `backend-sdk-` → return `SDK_UNREACHABLE` (no SDK pack yet; reserved for future)
  - Apply `config.handlerTimeoutMs` via `Promise.race`
- [ ] Implement `handleInvocation(req)` in `src/handle-invocation.ts`:
  - 13-step pipeline per TRD §2.3
  - All errors → `CanonicalResponse { error: {code, message, details, retryable} }`
  - Audit append on every exit path (success, denial, error)
  - Event Bus `gateway.invocation` emit on every exit path
- [ ] Implement `registerGatewayCapabilities(registry, gateway)` in `src/capabilities.ts`:
  - Register `auth.token.issue`, `auth.token.revoke` with owner `gateway`, permissions `platform.token.issue`
  - Register `session.create`, `session.resume`, `session.destroy`, `session.touch`, `session.list` with owner `gateway` (they dispatch to Session Manager internally)
  - Register `tenant.create`, `tenant.list`, `tenant.suspend`, `tenant.delete` with owner `gateway`, permissions `platform.tenant.*`
  - Register `capability.list`, `capability.describe` with owner `gateway`, permissions `platform.capability.read`
  - Register `gateway.status`, `gateway.metrics`, `gateway.configuration` with owner `gateway`, permissions `platform.gateway.read`
- [ ] Implement `verifyAuthz(caller, capabilityRecord)`:
  - Tier-hierarchy match (Q4)
  - Returns boolean
- [ ] Implement `resolveSession(sessionId, caller, sessionManager)`:
  - Look up session
  - Verify `session.tenantId === caller.tenantId` (else `TENANT_MISMATCH`)
  - Verify session is active (else `SESSION_REQUIRED`)
- [ ] Wire the factory `createGateway()`:
  - Load tenants from disk
  - Load/create secret
  - Create rate-limit buckets Map
  - Register all gateway capabilities with the Capability Registry
  - Return the Gateway interface
- [ ] Tests:
  - Authn pass / fail paths (verify + INVALID + EXPIRED)
  - Rate-limit pass / fail paths
  - Session-required / session-less capability split (Q3)
  - Authz tier hierarchy (read < act < destructive; read < write)
  - Capability not found
  - Dispatch to platform manager, dispatch to plugin, dispatch to backend-sdk (stubbed UNREACHABLE)
  - Handler timeout
  - All 16 GATEWAY_* error codes surface with correct codes + retryable flags
  - Audit record produced on every exit path (ok / denied / error)
  - Event Bus `gateway.invocation` emitted on every exit path

#### Validation condition

> A test exercising `handleInvocation()` through every accepted-and-rejected path produces the right audit, the right Event Bus event, the right error code. The 13-step pipeline is exercised end-to-end against fake FileSystem + fake Clock + fake CapabilityRegistry + fake PluginManager + fake SessionManager.

#### Regression check

> Existing Tier 1 packages still pass all tests. No regressions.

---

### Phase 6: Adapter interface + default MCP adapter

**Goal**: Implement the `Adapter` interface. Ship `@platform/adapter-mcp` as the default adapter — Streamable HTTP transport, `tools/list` + `tools/call` mapping.

**Why this phase after the kernel**: Adapter is the thin translation layer. Without the kernel, there's nothing to translate to.

#### Backend tasks

- [ ] Implement `Adapter` interface in `src/adapter.ts` (already declared in types.ts — add an `AdapterRegistry` helper that calls `adapter.start()` and `adapter.stop()` and tracks active adapters)
- [ ] Create `packages/adapter-mcp/` (separate package per PHILOSOPHY)
- [ ] Implement MCP adapter in `packages/adapter-mcp/src/index.ts`:
  - **Decision point**: use `@modelcontextprotocol/typescript-sdk` (Phase 0.5 opensrc'd) OR implement Streamable HTTP by hand. **Default: use the SDK** for protocol parsing; keep kernel types clean of MCP-shape types.
  - Listen on `config.adapter.mcp.port` (default 7100)
  - Streamable HTTP transport (single `POST /mcp` endpoint)
  - Map `tools/list` → `gateway.handleInvocation({capability: {name: "capability.list"}, input: {}})`, filter returned tools by caller's scope
  - Map `tools/call {name, arguments}` → `gateway.handleInvocation({capability: {name, version?}, input: arguments, sessionId?})` (read sessionId from `_meta.dev.agentide/sessionId`)
  - Map responses per TRD §2.3:
    - `{output}` → `{result: {content: [{type:"text", text: <serialized>}], structuredContent: <output>}}`
    - `{error: {code: "GATEWAY_HANDLER_TIMEOUT", ...}}` → `{result: {content: [...], isError: true}}` (tool error)
    - Other `{error: {code: "GATEWAY_*", ...}}` → JSON-RPC error with custom code per TRD mapping table
  - Validate `_meta.io.modelcontextprotocol/protocolVersion` and `clientCapabilities` (reject missing with HTTP 400 / JSON-RPC `-32602`)
- [ ] Tests for MCP adapter:
  - `tools/list` returns paginated tools
  - `tools/list` filters by caller's scope
  - `tools/call` happy path → result + structuredContent
  - `tools/call` handler timeout → `isError: true` in result
  - `tools/call` protocol error (e.g., capability not found) → JSON-RPC `-32601`
  - Missing `_meta.protocolVersion` → HTTP 400 / `-32602`
  - Session propagation via `_meta.dev.agentide/sessionId`
  - Auth failure (no Bearer) → `-32001` with `data.code: "GATEWAY_AUTH_FAILED"`

#### Validation condition

> `@platform/adapter-mcp` passes its tests. An MCP client (`@modelcontextprotocol/inspector`) connecting to `localhost:7100` with a valid bootstrap token can `tools/list` and `tools/call` a real capability. All 7 MCP error mappings per TRD §2.3 verified.

---

### Phase 7: `@platform/agentide` meta-package + CLI + install.sh

**Goal**: Composition + CLI + distribution. Operators get `agentide` binary / `npx @platform/agentide` / Docker image. Zero operator code.

**Why this phase last**: Composition + CLI depend on every other component being stable.

#### Backend tasks

- [ ] Create `packages/agentide/` (separate package, depends on all Tier 1 + gateway-core + adapter-mcp)
- [ ] Implement `createPlatform(config)` in `packages/agentide/src/index.ts`:
  - Wires EventBus, CapabilityRegistry, SessionManager, PluginManager, Gateway, default MCP adapter
  - Single `start(config)` entry point that calls all factories + adapter.start()
- [ ] Implement CLI in `packages/agentide/src/cli.ts`:
  - `agentide init` — first-run bootstrap (create default tenant + write secret + write config)
  - `agentide start [--daemon]` — compose + start
  - `agentide stop` — graceful shutdown
  - `agentide status` — Gateway.status()
  - `agentide logs [--follow]` — tail audit log
  - `agentide upgrade` — download latest binary (or `docker pull`)
  - `agentide tenant {create|list|suspend|delete}` — shells over gateway.createTenant et al.
  - `agentide token issue --tenant --caller --scope [--expires-in]` — shells over gateway.issueToken
  - `agentide plugin {install|list}` — shells over pluginManager
  - `agentide capability {list|describe}` — shells over gateway.handleInvocation
- [ ] Implement `install.sh` (bash, ~100 lines):
  - Detect OS + arch + presence of Docker/Node.js
  - Pick distribution (binary download / Docker / npx)
  - For binary: download Node SEA-built `agentide` to `/usr/local/bin/agentide` (or `~/.local/bin/agentide` fallback)
  - Create `~/.agentide/data/`
  - Print "Run agentide init" + "Run agentide start"
  - Failure-path: permission denied → fall back; missing Docker / Node.js → fall back
- [ ] Build configuration:
  - `npm run build` for each package (Node tsc + composite refs)
  - `npm run build:binary` for agentide via `--experimental-sea-config` (Node SEA)
  - Multi-stage Dockerfile: builder stage (compiles) + runtime stage (alpine/distroless)
  - CI workflow: build binary, build image, publish both
- [ ] Tests:
  - `createPlatform(config)` returns a started platform
  - CLI: argument parsing + dispatch to gateway methods (use a stub binary or argv mock)
  - `install.sh` is static (not run in unit tests; covered by integration / manual QA)

#### Validation condition

> `npx @platform/agentide@X.Y.Z` boots the platform on a Node.js host. `./agentide` (the binary) does the same. `docker run agentide:vX.Y.Z` does the same. All three end with the same "running on localhost:7100" output.

---

### Phase 8: Integration tests + manual QA walkthrough

**Goal**: End-to-end tests across all phases. Walk the QA checklist from FLOW. Verify acceptance criteria from PRD.

#### Backend tasks

- [ ] Integration tests in `src/__tests__/integration.test.ts`:
  - Full lifecycle: install → init → start → MCP connect → tools/list → tools/call → audit verified
  - Restart simulation: createPlatform → close → createPlatform again → state preserved
  - Restart with missing source for plugin (similar pattern to plugin-manager test)
  - Restart with corrupted install-record file: throws `INVALID_REQUEST`
  - All error flows from FLOW §5 exercised end-to-end
- [ ] Manual QA walkthrough (operator-side):
  - Walk every item in `FLOW-gateway-core.md` §Manual QA Checklist
  - Verify each `[AC-N]` maps to a passing test
- [ ] Run `npm run precommit` and verify clean
- [ ] Run feature-pipeline-review (sub-agent) to validate code matches PRD/TRD/FLOW
- [ ] Address any gaps from the review

#### Validation condition

> Full test suite passes. `npm run precommit` clean. The Manual QA Checklist from FLOW can be executed step-by-step with passing assertions.

---

## 4. Dependency Checklist

This checklist is a **hard gate**. No phase may begin code implementation until all packages used in that phase have `opensrc` complete.

### `@platform/event-bus`

- **Version**: workspace (`*`)
- **Used in**: All phases
- **TRD section**: §3.1
- **opensrc command run**: N/A — first-party workspace package
- **Source files read**:
  - `packages/event-bus/src/types.ts:75-78` — `EventBus` interface (`publish(name, payload)`, `subscribe(pattern, handler)`)
  - `packages/event-bus/src/index.ts:63` — `createEventBus()` factory
  - `packages/event-bus/src/index.ts:91-122` — `dispatchToSnapshot` (sync handlers in subscription order, async via `Promise.allSettled`)
- **Call pattern confirmed from source**:
  ```ts
  import { createEventBus } from "@platform/event-bus";
  const bus = createEventBus();
  void bus.publish("gateway.invocation", payload);
  ```
- **Error cases to handle**:
  - Reserved namespace check: `publish("event.*", ...)` throws. We never publish under `event.*`.
- **opensrc complete**: Yes

### `@platform/capability-registry`

- **Version**: workspace (`*`)
- **Used in**: Phase 5+
- **TRD section**: §3.2
- **opensrc command run**: N/A — first-party
- **Source files read**:
  - `packages/capability-registry/src/types.ts:30-106` — `CapabilityType`, `CapabilityRecord`, `DescribeResult`, `RegisterResult`, `CapabilityRegistry`
  - `packages/capability-registry/src/index.ts:32-90` — `register` diffs against owner's existing manifest
  - `packages/capability-registry/src/store.ts:97-130` — `describe(name, version?)` returns latest when version omitted
- **Call pattern confirmed from source**:
  ```ts
  import { createCapabilityRegistry } from "@platform/capability-registry";
  const registry = createCapabilityRegistry(bus);
  const result = registry.describe("customer.read");        // latest version
  const result = registry.describe("customer.read", "1.0.0"); // specific version
  const list = registry.list();                              // all cards
  ```
- **Error cases to handle**:
  - `describe()` returns `{capability: null, ...}` when not found (NOT throw). Our handleInvocation maps null → `GATEWAY_CAPABILITY_NOT_FOUND`.
  - `register()` throws on cross-owner collision. We don't call `register` from the Gateway — capability registrations happen via `registerGatewayCapabilities` ONCE at factory time. Owner = `gateway` for all our capabilities; no collision expected.
- **opensrc complete**: Yes

### `@platform/session-manager`

- **Version**: workspace (`*`)
- **Used in**: Phase 5+ (for session.* capability dispatch)
- **TRD section**: §3.3
- **opensrc command run**: N/A — first-party
- **Source files read**:
  - `packages/session-manager/src/index.ts:51-56` — factory signature
  - `packages/session-manager/src/index.ts:101-118` — `create` method
  - `packages/session-manager/src/index.ts:120-129` — `resume` method
  - `packages/session-manager/src/index.ts:139-150` — `destroy` method
  - `packages/session-manager/src/index.ts:131-138` — `touch` method
- **Call pattern confirmed from source**:
  ```ts
  import { createSessionManager } from "@platform/session-manager";
  const sm = createSessionManager(bus, { defaultIdleTimeoutMs: 300000 });
  const session = sm.create({ ownerId: "agent", adapterType: "mcp", metadata });
  const active = sm.resume(session.id);
  ```
- **Error cases to handle**:
  - `resume` throws `SessionNotFoundError`, `SessionArchivedError`, `SessionAlreadyActiveError`. We translate these to `GATEWAY_SESSION_REQUIRED`.
  - `create` throws `ValidationError` on empty ownerId / invalid adapterType.
- **opensrc complete**: Yes

### `@platform/plugin-manager`

- **Version**: workspace (`*`)
- **Used in**: Phase 5+ (for plugin.* capability dispatch + runtime handler lookup)
- **TRD section**: §3.4
- **opensrc command run**: N/A — first-party
- **Source files read**:
  - `packages/plugin-manager/src/index.ts:50` — async factory
  - `packages/plugin-manager/src/lifecycle-helpers.ts:128-180` — `applyManifest` shared by update/reload + startup
  - `packages/plugin-manager/src/lifecycle.ts` — `install`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get`, `installFromRegistry`
- **Call pattern confirmed from source**:
  ```ts
  import { createPluginManager } from "@platform/plugin-manager";
  const pm = await createPluginManager(bus, registry, { fs, clock, installRecordPath: "/data/installed-plugins.json" });
  await pm.install("./browser.yaml");     // throws on validation failure
  const list = pm.list();                  // InsertRecord[]
  ```
- **Error cases to handle**:
  - `install` throws `PluginManagerError` (with `.code` field) on various failures. We translate via `error.code` mapping.
  - `applyManifest` rolls back on registry failure (per Phase 0.5 review fix).
- **opensrc complete**: Yes

### `@modelcontextprotocol/typescript-sdk` (Phase 6, adapter only)

- **Version**: latest (`^1.x`)
- **Used in**: Phase 6 (the MCP adapter)
- **TRD section**: §3.6
- **opensrc command run**:
  ```bash
  opensrc path modelcontextprotocol/typescript-sdk@latest
  opensrc path modelcontextprotocol/modelcontextprotocol@latest
  ```
- **Source files read**:
  - `~/.opensrc/repos/.../typescript-sdk/latest/packages/server/src/server/mcp.ts:1-120` — `McpServer` high-level class
  - `~/.opensrc/repos/.../typescript-sdk/latest/packages/server/src/server/streamableHttp.ts:1-50` — `WebStandardStreamableHTTPServerTransport`
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/docs/specification/draft/basic/transports/streamable-http.mdx` — Streamable HTTP spec
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/docs/specification/draft/server/tools.mdx:1-250` — tools/list, tools/call protocol
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/schema/draft/schema.ts:1796-1895` — `CallToolResult`, `CallToolRequest`, `ToolListChangedNotification`
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/schema/draft/schema.ts:1960-1999` — `Tool` shape (name, description, inputSchema)
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/docs/specification/draft/basic/index.mdx:25-100` — JSON-RPC 2.0 envelope, error codes
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/docs/specification/draft/basic/index.mdx:182-200` — Stateless protocol
  - `~/.opensrc/repos/.../modelcontextprotocol/latest/docs/specification/draft/basic/index.mdx:325-410` — `_meta` reserved keys + per-request fields
- **Call pattern confirmed from source**:
  ```ts
  import { McpServer } from "@modelcontextprotocol/typescript-sdk/server/mcp.js";
  import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/typescript-sdk/server/streamableHttp.js";

  const server = new McpServer({ name: "agentide", version: "0.1.0" });
  server.tool("customer.read", { ...inputSchema }, async (args) => {
    const result = await gateway.handleInvocation({ ... });
    return wrapAsToolResult(result); // {content, structuredContent, isError}
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);
  // Wire transport.handleRequest to your HTTP server.
  ```
- **Error cases to handle**:
  - JSON-RPC errors: use SDK's `McpError` class for protocol-level errors.
  - SDK calls `tools/call` handler — we map our errors back to SDK's expected shape.
  - SDK publishes `notifications/tools/list_changed` automatically when tools are added (re-list via `server.sendToolListChanged()`).
- **opensrc complete**: Yes

### Node `crypto` (built-in, HS256 JWT signing)

- **Used in**: Phase 2 (token verify)
- **opensrc**: N/A — built-in
- **Source**: Node.js docs + `node:crypto` types
- **Call pattern**:
  ```ts
  import { createHmac, randomBytes } from "node:crypto";
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  ```
- **opensrc complete**: N/A

### Node `http` / `node:http` (built-in, MCP adapter HTTP server)

- **Used in**: Phase 6 (MCP adapter)
- **opensrc**: N/A — built-in
- **Decision deferred to IMPL Phase 6**: use raw `node:http` or a thin framework like Express? Default: `node:http` — Streamable HTTP is straightforward, we don't need Express's full feature set. Less dep, more control.

---

**Summary table**:

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| `@platform/event-bus` | workspace | All | Yes | `publish` is async, fires event after dispatch; `subscribe` returns Subscription with idempotent unsubscribe |
| `@platform/capability-registry` | workspace | 5+ | Yes | `describe(name, version?)` returns latest when omitted |
| `@platform/session-manager` | workspace | 5+ | Yes | 8 lifecycle methods; idle suspend + suspended TTL auto-archive |
| `@platform/plugin-manager` | workspace | 5+ | Yes | Async factory; startup re-install; `applyManifest` rolls back on registry failure |
| `@modelcontextprotocol/typescript-sdk` | `^1.x` | 6 (adapter) | Yes | `McpServer` + `WebStandardStreamableHTTPServerTransport`; `server.tool()` for registration; auto `notifications/tools/list_changed` |
| Node `crypto` | built-in | 2 | N/A | HS256 via `createHmac`; secret generation via `randomBytes` |
| Node `http` | built-in | 6 (adapter) | N/A | Streamable HTTP server; transport hands `Request` → adapter returns `Response` |

**No new external dependencies for `@platform/gateway-core` beyond the four Tier 1 workspace packages.** The MCP adapter adds `@modelcontextprotocol/typescript-sdk`.

## 5. Test Requirements

Global test requirements across all phases.

- **External behavior only.** Tests verify state transitions, return values, published events, and error codes — not internal state structure (Map keys, etc.) beyond what the events enable.
- **Prior art**: follow the patterns in `packages/event-bus/src/__tests__/`, `packages/capability-registry/src/__tests__/`, `packages/session-manager/src/__tests__/`, `packages/plugin-manager/src/__tests__/`. Vitest. `describe`/`it` blocks. No `vi.useFakeTimers` — the Gateway uses injected `Clock` for any timing concerns.
- **Test doubles**:
  - `FileSystem` injected — tests use an in-memory fake (Map<string, string>)
  - `Clock` injected — tests use a fake that returns a controllable timestamp and supports `setTimeout`/`clearTimeout`
  - `EventBus` real — tests subscribe to verify events
  - `CapabilityRegistry` real — tests use `list()` to verify capabilities
  - `SessionManager` real (already shipped)
  - `PluginManager` real (already shipped, with rollback)
  - `YamlParser` real (yaml package — used by Plugin Manager)
- **Layer**: all unit + integration tests; no E2E (no Gateway-level browser harness in v1).
- **Test data strategy**:
  - Fixture JWTs: generate at test setup using `issueToken` (no hardcoded tokens)
  - Fixture manifests: inline YAML strings (no external files for unit tests; integration tests use real manifest files)
  - Test clock: `nowValue = 1_700_000_000_000`, advance via `clock.advance(ms)`
- **Coverage targets**:
  - All 16 `GATEWAY_*` error codes exercised (one test each, minimum)
  - All 13 pipeline steps (per TRD §2.3) exercised (one happy-path + at least one failure test each)
  - All 4 transport error mappings (MCP adapter; per TRD §2.3 table)
  - All 4 tenant methods + bootstrap-token round-trip
  - Tier-hierarchy authz: read/act/destructive × 3 capability types
  - Rate-limit: bucket-exhaustion + refill + per-key isolation
  - Audit: success/denial/error paths produce the right records

## 6. Rollout Notes

Implementation-specific rollout considerations.

- **Feature flag**: None. The Gateway ships fully enabled. Self-hosted install defaults put everything on `localhost:7100`. Operators can opt out by uninstalling the MCP adapter package.
- **Migration order**: gateway-core is purely additive. No existing data to migrate. Order of package rollouts:
  1. `@platform/event-bus`, `@platform/capability-registry`, `@platform/session-manager`, `@platform/plugin-manager` — all already shipped.
  2. `@platform/gateway-core` (this PR).
  3. `@platform/adapter-mcp` (separate package, bundled in distribution).
  4. `@platform/agentide` (meta-package, depends on all of the above).
  5. Install / Docker / npm publish.
- **Environment variables / CLI flags**:
  - `AGENTIDE_PORT` (default 7100)
  - `AGENTIDE_DATA_DIR` (default `~/.agentide/data`)
  - `AGENTIDE_AUDIT_LOG_PATH` (default `${dataDir}/audit.log`)
  - `AGENTIDE_SECRET_PATH` (default `${dataDir}/gateway-secret`)
  - `AGENTIDE_RATE_LIMIT_TOKENS_PER_SECOND` (default 10)
  - `AGENTIDE_RATE_LIMIT_CAPACITY` (default 100)
  - `AGENTIDE_HANDLER_TIMEOUT_MS` (default 30000)
  - `AGENTIDE_CLEANUP_TIMEOUT_MS` (default 5000)
  - All overridable via `--config <file>` (YAML) or per-flag CLI args.
- **Index / schema creation**: None. The on-disk schema is append-only JSONL for the audit log and a small JSON array for tenants — no indexes, no DB.
- **Secret rotation**: v1 doesn't support secret rotation. The secret is created on first run, persisted with mode 0600. Rotation is "operator deletes `gateway-secret`, re-runs `agentide init`" — invalidates all existing tokens. Documented limitation; future enhancement.
- **Drift watch**:
  - MCP spec is in active development (draft → 2025-11-25 → etc.). When the spec moves to "stable" and breaks our adapter, we update.
  - `@platform/capability-registry` may add new fields to `CapabilityRecord` (e.g., `annotations` per MCP `ToolAnnotations`). Our adapter should pick them up automatically.
  - `@platform/plugin-manager` may add events (e.g., `plugin.verified`). Our audit log will surface them automatically.