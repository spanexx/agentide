# PRD: Gateway Core

## Status

- Type: Product requirements document
- Audience: Platform engineering, QA, plugin authors, operators
- Scope: The control-plane component that authenticates callers, authorizes capability invocations, manages sessions, dispatches to capability handlers, audits every invocation, applies rate limits, and enforces tenant isolation. Ships with one default adapter (MCP) bundled; additional adapters are separate packs.

## Summary

The Gateway is the Control Plane's primary entry point. Every capability invocation — from any adapter (MCP, REST, CLI, WebSocket) — flows through the Gateway. It performs authn (JWT bearer token), authz (tier-hierarchy permission check), session resolution, capability lookup (with optional version pin), dispatch (to in-process platform managers, in-process runtime plugins, or Backend Runtime → SDKs), rate limiting (per-caller token bucket), audit logging (append-only file + Event Bus), and failure surfacing (one stable `GATEWAY_*` code per failure mode). v1 enforces tenant isolation as a first-class concept: every token carries a tenantId, every audit record and rate-limit bucket is tenant-scoped, and tenant lifecycle (`create`/`list`/`suspend`/`delete`) ships in v1 so the same Gateway serves both self-hosted (one tenant per install) and hosted (many tenants per process) deployments.

The Gateway ships as part of the `@platform/agentide` meta-package, which provides a one-line install (`curl -fsSL https://agentide.io/install.sh | bash`), a `agentide` CLI for day-2 operations, and the default MCP adapter bundled but replaceable per the project's PHILOSOPHY.

## Problem

Without a Gateway, the platform's capability model is unusable: capabilities registered with the Capability Registry cannot be invoked by external callers (AI agents, dashboards, ops tools). Operators have no auditable entry point. SDKs have no place to register their capabilities where agents can find them. Sessions — the unit that owns runtime resources like browser tabs — have no controlled lifecycle. Permission scopes documented in `Goals § 7 (Security by Default)` have no enforcement layer.

The cost of not having a Gateway: the platform cannot ship v1 as a usable system, no matter how many runtime plugins or business SDKs are built. Every component below the Gateway (Session Manager, Plugin Manager, Capability Registry) is operational but unreachable from outside.

## Product Goals

1. **Operators can install the platform with one command** — `curl -fsSL https://agentide.io/install.sh | bash` produces a running Agentide process with MCP adapter listening on `localhost:7100`, default tenant provisioned, and bootstrap operator token printed. No code written by the operator.
2. **AI agents can invoke capabilities via MCP out of the box** — without installing any additional adapter pack, agents using the MCP protocol can call `tools/list` (paginated discovery) and `tools/call` (canonical invocation) against the platform.
3. **Every capability invocation is authenticated, authorized, rate-limited, and audited** — no caller reaches a handler without all four checks passing (or returning a stable `GATEWAY_*` error on failure).
4. **Tenants are isolated by default** — a caller scoped to tenant A cannot read, invoke, or discover tenant B's data, sessions, plugins, capabilities, or audit records. Self-hosted deployments get one auto-provisioned tenant; hosted deployments provision many tenants via the `tenant.*` capabilities.
5. **Operators can manage the platform via CLI without writing code** — `agentide status / logs / stop / start / upgrade`, `agentide tenant create / list / suspend / delete`, `agentide plugin install`, `agentide token issue`, `agentide capability list / describe`. Every operator action either succeeds or returns a clear error.
6. **The Gateway's behavior is verifiable through tests + manual QA** — 100+ behaviour tests cover happy paths, all error codes, version resolution, tenant isolation, rate limiting, and audit; the QA checklist from FLOW can be walked end-to-end.
7. **The default MCP adapter is replaceable without changing the kernel** — operators swap it for REST/CLI/WS adapters via a single CLI flag or config change. The PHILOSOPHY test ("replace this component tomorrow, how much must change? Nothing.") is satisfied.

## Non-Goals

These are explicit exclusions for v1. Listed to prevent scope creep during implementation.

- **OAuth 2.1 / Authorization Server Discovery** — MCP's standard auth flow. The MCP spec marks auth as OPTIONAL; we ship the simpler `Authorization: Bearer <jwt>` in v1 and add OAuth 2.1 in a later pack.
- **Multi-process / distributed state** — v1 runs as a single process. Rate-limit buckets, sessions, and audit log live in memory + a single file. Horizontal scaling (Redis-backed buckets, DB-backed audit, sticky session routing) is v2+.
- **Streaming or async invocations** — every `tools/call` is sync-only. Long-running work is modeled in the handler as multiple sync calls (e.g., `migration.start` returns `jobId`; caller polls `migration.status` and `migration.result`).
- **MCP `prompts/*`, `resources/*`, server-initiated `notifications/*`, `subscriptions/listen`, sampling, elicitation** — out of v1 scope. The Gateway exposes only `tools/list` and `tools/call`.
- **Capability input validation** — the Gateway trusts the handler to validate inputs against the capability's `inputSchema`. JSON Schema validation in the Gateway is deferred.
- **Per-capability timeout** — single default timeout (30s, configurable) for all handlers. Per-call `timeoutMs` override is deferred.
- **Plugin Manager integration in `tools/list`** — v1's `tools/list` returns platform capabilities (`session.*`, `plugin.*`, `gateway.*`, `capability.*`) and runtime plugin capabilities (`browser.*`, etc.); business capabilities registered by Backend SDKs are deferred to a follow-up pack (Backend Runtime + SDK pack).
- **Auto-update mechanism** — operators upgrade manually (`docker pull`, `agentide upgrade` for binary). Signed auto-update is v2.
- **Capability deprecation / version-range pinning** — `latest` is the only auto-resolution policy; explicit `version` pinning is supported; no deprecation semantics.
- **Browser-native extensions, dashboards, hosted-platform provisioning UI** — out of v1 scope (covered by other packs).

## Canonical Product Language

Every term used in this PRD is either defined here or already in `docs/CONTEXT.md`. The Gateway introduces or sharpens:

- **Gateway**: the control-plane entry point that authenticates, authorizes, routes, audits, and rate-limits every capability invocation. (Already in CONTEXT.md glossary; refined here.)
- **Capability Invocation**: the canonical unit of work `{ caller, session?, capability, input } → { output } or { error }`. Every adapter (MCP, REST, CLI, WS) translates to and from this shape. (New in CONTEXT.md glossary.)
- **Audit Log**: append-only structured log (default `~/.agentide/data/audit.log`) where the Gateway records one JSON object per capability invocation, mirrored on the Event Bus as `gateway.invocation`. (New in CONTEXT.md glossary.)
- **Tenant**: an isolated organization within a platform installation. Every token's `sub` is `{ tenantId, callerId }`; every audit record, rate-limit bucket, and session record carries `tenantId`. The Gateway refuses any cross-tenant operation. (New in CONTEXT.md glossary.)
- **Backend Runtime**: the in-process component that maintains persistent connections to SDKs running in user apps, translating Gateway invocations into SDK-handler calls. (Already in CONTEXT.md / `Agentide.md §5`.)
- **Adapter**: a separate package that translates a transport-specific protocol (MCP, REST, CLI, WS) into the canonical Capability Invocation. The Gateway's kernel does not know which adapters are connected.
- **`@platform/agentide`**: the meta-package that composes all Tier 1 components (event-bus, capability-registry, session-manager, plugin-manager) + `@platform/gateway-core` + the default MCP adapter, and ships the `agentide` CLI. Operators install this single package to run the platform.

## Product Scope

### Core flow — first-time operator onboarding

1. Operator runs `curl -fsSL https://agentide.io/install.sh | bash`.
2. Install script detects environment (Linux/macOS/WSL; amd64/arm64; presence of Docker, Node.js), picks the best distribution (binary download / Docker image / npx fallback), downloads + installs to `/usr/local/bin/agentide` (or `~/.local/bin/agentide` if permission denied), and prints a brief summary.
3. Operator runs `agentide init`. First-run creates one auto-provisioned tenant (`default`), generates one bootstrap operator JWT (tenant=`default`, caller=`default-admin`, scope=`*`), writes default config to `~/.agentide/config.yaml`, and prints the bootstrap token prominently with a "save this now" warning.
4. Operator runs `agentide start`. The platform boots the Event Bus, Capability Registry, Session Manager, Plugin Manager (loads 0 installed plugins in fresh install), Gateway, and bundled MCP adapter. The MCP adapter listens on `localhost:7100` (Streamable HTTP transport).
5. Operator configures their AI agent with the MCP URL (`http://localhost:7100`) and the bootstrap token. Agent connects.
6. Platform is operational. Operator can install plugins, create tenants, issue tokens, view audit logs — all via CLI.

### Core flow — agent invocation

1. AI agent sends MCP `tools/list` request.
2. MCP adapter translates to canonical packet: `{ caller: { id, scope, tenantId }, capability: { name: '*' }, input: {} }` filtered by caller's scopes (capabilities whose permissions aren't covered by caller's scopes are excluded).
3. Gateway: authn ✓ → authz ✓ → rate-limit ✓ → audit ✓ → `capability.list()` (filtered) → return.
4. MCP adapter wraps result: `{ result: { tools: [...] } }`.
5. AI agent sends MCP `tools/call { name: "customer.read", arguments: { id: 42 } }`.
6. MCP adapter translates to: `{ caller, capability: { name: "customer.read" }, input: { id: 42 }, sessionId? }`.
7. Gateway: authn → authz (caller's scope covers `customer.read`'s permission) → rate-limit → audit → capability lookup (registry.describe) → version resolution (auto-latest) → dispatch to handler (in-process or via Backend Runtime).
8. Handler returns `{ output: { customer: {...} } }` or throws structured error.
9. Gateway: audit (with durationMs, status) → return.
10. MCP adapter wraps: `{ result: { content: [{type:"text", text: ...}], structuredContent: {...} } }` (or `{ result: {...}, isError: true }` for handler-originated errors; `{ error: { code: ..., message: ... } }` for protocol-level errors).

### Core flow — token issuance and lifecycle

1. Operator runs `agentide token issue --tenant <id> --caller <id> --scope <comma-separated-scopes> --expires-in <duration>`.
2. Gateway validates the operator's own token (must have `platform.token.issue` scope); rejects if not.
3. New JWT minted, signed with Gateway's secret. Claims: `sub: { tenantId, callerId }`, `scope: [...]`, `exp: <unix>`, `iat: <unix>`.
4. Token printed to operator's terminal. Not persisted (operator responsible for distributing it).
5. Subsequent calls using this token carry `Authorization: Bearer <jwt>`. Gateway verifies on each call.

### Core flow — tenant lifecycle

1. Operator runs `agentide tenant create <id> <name>` (or invokes `tenant.create` capability programmatically).
2. Tenant record created (in-memory + persisted to install-record-like file).
3. Bootstrap operator token for the new tenant printed (same flow as fresh install).
4. Operator distributes tokens to apps/services in the new tenant.
5. Operator runs `agentide tenant list` to see all tenants; `agentide tenant suspend <id>` to disable; `agentide tenant delete <id>` to remove.
6. Cross-tenant operation (any invocation with a token whose tenantId doesn't match the target tenant's data) is refused with `GATEWAY_TENANT_MISMATCH` (planned error code; final name in TRD).

### Edge cases

- **Caller invokes a capability without a session where one is required**: Gateway returns `GATEWAY_SESSION_REQUIRED` (planned code). Caller invokes `session.create`, gets `sessionId`, retries with `sessionId` in `_meta`.
- **Capability is missing required input fields**: handler returns tool error (`isError: true`); MCP adapter wraps and returns to agent. Caller fixes and retries.
- **Two callers race to install the same plugin**: Plugin Manager serializes; second caller gets `PLUGIN_ID_ALREADY_INSTALLED`.
- **Operator runs `agentide start` when a platform is already running on the port**: CLI checks, refuses with clear error pointing at PID file.
- **Bootstrap token expired**: re-run `agentide init` to generate a new one (or use `agentide token issue` with operator scope).
- **MCP client sends a request without required `_meta.io.modelcontextprotocol/protocolVersion`**: MCP adapter rejects with HTTP 400 / JSON-RPC `-32602` (Invalid params) per MCP spec.
- **MCP client tries to call a capability whose permission the caller's scope doesn't cover**: Gateway returns protocol-level error `GATEWAY_INSUFFICIENT_SCOPE` (mapped to JSON-RPC `-32001`).
- **Plugin Manager publishes `plugin.installed` event**: Gateway updates its in-memory cache of capabilities exposed via `tools/list`; emits `notifications/tools/list_changed` to subscribed MCP clients (per MCP spec). v1 may defer this notification emission — `tools/list` per-request filtering (current capability) is sufficient for correctness.

## User Stories

1. As a **self-hosted operator**, I want to install the platform with one command, so that I can have a working Agentide in under a minute without reading documentation.
2. As a **self-hosted operator**, I want a bootstrap operator token generated and displayed on first run, so that I can configure my AI agent without manual API key setup.
3. As a **self-hosted operator**, I want day-2 operations (status, logs, plugin install, tenant create, stop, start) via CLI, so that I can manage the platform without writing scripts.
4. As a **hosted platform operator**, I want `tenant.create`, `tenant.list`, `tenant.suspend`, `tenant.delete` capabilities, so that I can provision and decommission customer organizations from automation.
5. As an **AI agent developer**, I want MCP `tools/list` to return only the capabilities my token's scope permits, so that the LLM doesn't see capabilities it can't actually invoke.
6. As an **AI agent developer**, I want to call `tools/call` and get a structured response (text or JSON), so that the LLM can read the result and the caller can branch on `isError`.
7. As a **plugin author**, I want the capabilities I register with the Capability Registry to automatically appear in MCP `tools/list`, so that I don't have to maintain a separate adapter-side manifest.
8. As a **plugin author**, I want my capabilities to be filtered by per-caller scope, so that I can register `browser.destructive` and have low-scope agents see only `browser.read`.
9. As an **SDK developer (Backend SDK, future pack)**, I want a Backend Runtime contract that lets me register handlers via a persistent connection, so that the Gateway can invoke my application's business capabilities.
10. As an **operator**, I want every invocation recorded in `~/.agentide/data/audit.log` AND emitted as a `gateway.invocation` event, so that I can grep for "what did agent X do" or subscribe a dashboard.
11. As an **operator**, I want rate-limited callers to receive `RATE_LIMIT_EXCEEDED` instead of silently failing, so that misbehaving SDKs are visible.
12. As an **operator**, I want to issue a new token without restarting the platform, so that I can rotate credentials or grant a new app access without downtime.
13. As an **operator**, I want the Gateway to fail fast (not retry silently) when a plugin is missing, an SDK is disconnected, or a handler times out, so that I see `GATEWAY_PLUGIN_NOT_INSTALLED` / `GATEWAY_SDK_UNREACHABLE` / `GATEWAY_HANDLER_TIMEOUT` in the audit log immediately.
14. As a **plugin author**, I want capability version resolution to default to the latest registered version, so that I don't have to bump versions to roll out bug fixes.
15. As a **plugin author**, I want capability version pinning (`{ name, version }` in the canonical packet), so that test agents and integrations with breaking changes have deterministic behavior.
16. As a **plugin author**, I want the Gateway to validate my capabilities' names match MCP's allowed character set, so that tools exposed via MCP are guaranteed valid.
17. As an **operator**, I want the install script to fall back gracefully when `/usr/local/bin/agentide` is not writable, so that I don't have to debug permission errors.
18. As an **operator**, I want the install script to detect Docker / Node.js and pick the best distribution, so that I don't have to choose between binary / Docker / npx manually.
19. As an **operator** in a hosted environment, I want cross-tenant operations to be refused with a clear error, so that a bug in one tenant's SDK can't accidentally expose another tenant's data.
20. As a **plugin author**, I want the `plugin.installed` event I emit to be reflected in subsequent MCP `tools/list` calls, so that newly-installed runtime capabilities become immediately available to agents.

## Acceptance Criteria

### Install + first boot

- [ ] `curl -fsSL https://agentide.io/install.sh | bash` on a clean Linux amd64 system with no Docker / Node.js installs the `agentide` binary to `/usr/local/bin/agentide` and prints a success summary.
- [ ] `curl ... | bash` on a system without `/usr/local/bin/` write permission installs to `~/.local/bin/agentide` and prints a clear message about updating `$PATH`.
- [ ] `curl ... | bash` on a system with Docker installed skips binary download and offers a `docker run` invocation (or runs it with a `--docker` flag).
- [ ] `agentide init` on a fresh install creates a `default` tenant, generates a bootstrap operator JWT, writes a default `~/.agentide/config.yaml`, and prints the token with a "save this now" warning.
- [ ] `agentide init` on a re-run (existing install) refuses to overwrite without a `--force` flag.
- [ ] `agentide start` boots all components and prints "Agentide vX.Y.Z is running" along with the MCP URL and Bearer token placeholder.
- [ ] `agentide status` reports running state, uptime, tenant count, plugin count, and audit log size.
- [ ] `agentide stop` shuts the platform down cleanly.
- [ ] `agentide logs` tails the audit log (or the structured log equivalent).

### Auth + token issuance

- [ ] `agentide token issue --tenant default --caller acme-admin --scope "platform.*,plugin.*" --expires-in 1h` returns a valid JWT whose claims include `sub: {tenantId, callerId}`, `scope`, `exp`, `iat`.
- [ ] JWT signed with HS256 (default Gateway secret). `Authorization: Bearer <jwt>` accepted on MCP requests.
- [ ] Tampered JWT (signature mismatch) rejected with `GATEWAY_AUTH_FAILED` (mapped to JSON-RPC custom error).
- [ ] Expired JWT rejected with `GATEWAY_AUTH_FAILED` and `details.reason: "expired"`.
- [ ] Missing `Authorization` header rejected with `GATEWAY_AUTH_FAILED`.
- [ ] Operator without `platform.token.issue` scope cannot mint tokens.

### Sessions

- [ ] `session.create` returns a `sessionId`; subsequent capability calls carry that `sessionId` (e.g., via MCP `_meta.dev.agentide/sessionId`).
- [ ] Capability calls requiring a session, when invoked without one, return `GATEWAY_SESSION_REQUIRED`.
- [ ] Session-resume works across MCP requests (stateless protocol, sessionId in `_meta`).
- [ ] `session.destroy` cleans up resources via Session Manager; `session.cleanup_resources` event fires.
- [ ] Read-only discovery (`capability.list`, `plugin.list`, `gateway.status`, `system.*`) works without a session.

### Authz (tier hierarchy)

- [ ] Caller with scope `runtime.browser.read` can invoke `browser.screenshot` (requires `runtime.browser.read`).
- [ ] Caller with scope `runtime.browser.act` can invoke `browser.screenshot`, `browser.navigate` (requires `act`), but NOT `browser.deleteCookies` (requires `destructive`).
- [ ] Caller with scope `platform.plugin.write` can invoke `plugin.install`, `plugin.update`, `plugin.uninstall`; caller with only `platform.plugin.read` cannot.
- [ ] Business capability (`customer.read`, declared with `permissions: ["customer.read"]`) requires EXACT match; tier hierarchy does NOT apply.
- [ ] `tools/list` returns ONLY capabilities whose permissions are covered by the caller's scopes.
- [ ] Insufficient scope returns `GATEWAY_INSUFFICIENT_SCOPE` (mapped to JSON-RPC custom error), with `retryable: false`.

### Dispatch

- [ ] Capability owned by `session-manager` (e.g., `session.create`) invoked → handled in-process by Session Manager.
- [ ] Capability owned by `plugin:<id>` (e.g., `browser.navigate`) invoked → handled in-process by Plugin Manager / runtime plugin.
- [ ] Capability owned by `backend-sdk-*` (future pack) invoked → routed to Backend Runtime → SDK.
- [ ] Capability not in registry → `GATEWAY_CAPABILITY_NOT_FOUND` (JSON-RPC `-32601`).
- [ ] Plugin disabled → `GATEWAY_PLUGIN_DISABLED` (custom `-32001`).
- [ ] Plugin missing source for startup re-install → `lastError` set on install record; no event fired.

### Audit log

- [ ] Every invocation (success, denial, error) produces one record in `~/.agentide/data/audit.log`.
- [ ] Record shape: `{ts, caller.id, caller.scope, session.id?, capability.name, capability.version, owner, status, denyReason?, errorCode?, durationMs}`. No input payload (PII).
- [ ] Same record emitted on Event Bus as `gateway.invocation`.
- [ ] File write failure does NOT fail the invocation (best-effort; logged to stderr).

### Rate limiting

- [ ] Default token bucket: capacity 100, refill 10/sec, per `(tenantId, callerId)`.
- [ ] Empty bucket → `GATEWAY_RATE_LIMIT_EXCEEDED` (custom `-32001`), `retryable: true`.
- [ ] Successful invocations, denials, and errors all consume one token.
- [ ] Buckets are in-memory; process restart resets them (documented limitation for v1).

### Tenant isolation

- [ ] Token issued for tenant A cannot read, invoke, or discover tenant B's data, sessions, plugins, capabilities, or audit records.
- [ ] Cross-tenant operation attempt returns `GATEWAY_TENANT_MISMATCH`.
- [ ] `agentide tenant create <id> <name>` provisions a new tenant and emits a bootstrap token.
- [ ] `agentide tenant list` shows all tenants.
- [ ] `agentide tenant suspend <id>` prevents new sessions/calls for that tenant (in-flight finish).
- [ ] `agentide tenant delete <id>` removes the tenant and all its records (with confirmation prompt).
- [ ] Self-hosted default install produces one tenant (`default`); hosted deployments produce many.

### MCP adapter (default)

- [ ] Streamable-HTTP transport on port 7100 (configurable).
- [ ] `POST /mcp` accepts JSON-RPC 2.0 requests; returns JSON or request-scoped SSE stream.
- [ ] `tools/list` returns paginated tools with `name`, `description`, `inputSchema`. Per-request scope filtering applied.
- [ ] `tools/call` translates to canonical invocation; returns `CallToolResult` with `content[]` (text wrap) and `structuredContent` (raw JSON) where applicable.
- [ ] `isError: true` reserved for handler-originated errors (handler threw / handler timed out).
- [ ] Protocol-level errors (capability not found, insufficient scope, rate limit, plugin disabled, SDK unreachable) returned as JSON-RPC `error` with custom codes in `-32001` to `-32099`.
- [ ] Required `_meta.io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` enforced; missing → HTTP 400 / JSON-RPC `-32602`.
- [ ] `Authorization: Bearer <jwt>` accepted; agent connecting without a token gets `GATEWAY_AUTH_FAILED`.
- [ ] `_meta.dev.agentide/sessionId` propagated as `sessionId` in the canonical packet.

### Replaceability / PHILOSOPHY

- [ ] Swap MCP adapter for a different adapter package via CLI flag (`--no-default-adapters` + `--adapter <path>` or `--adapter-package <name>`); no kernel changes required.
- [ ] Replaceability test passes: tomorrow's "new agent transport" requires only a new adapter package + registration; gateway-core, session-manager, plugin-manager, capability-registry unchanged.

### Tests + verification

- [ ] 100+ behaviour tests pass.
- [ ] QA checklist (in FLOW doc) is executable end-to-end against a fresh `agentide start`.
- [ ] `npm run precommit` clean (check-banned-types + typecheck + lint + build) across all packages.
- [ ] No banned types (`any`, `unknown` outside catch clauses) in source.

## Rollout and Risk

- **Migration risk**: none at the install layer — no other component depends on the Gateway yet. Tier 3 packs (`sdk-node`, adapters other than MCP) are additive.
- **Compatibility risk**: low. The MCP adapter matches the current draft MCP spec (2025-11-25); spec is in active development but the core `tools/list` / `tools/call` are stable across recent revisions.
- **Rollout strategy**: single npm workspace package `@platform/gateway-core` + meta-package `@platform/agentide`. No feature flags. Operators opt in by installing. Self-hosted default install gives them MCP working immediately.
- **Drift watch**:
  - If MCP's spec changes (it's actively evolving — draft, 2025-06-18, 2025-11-25, etc.), the adapter must follow. Track `modelcontextprotocol/modelcontextprotocol` releases.
  - If `CapabilityRecord` schema adds fields (description / outputSchema / annotations) that MCP supports, extend the translation layer.
  - If the OAuth 2.1 flow becomes a hard MCP requirement (currently OPTIONAL), add an OAuth pass-through adapter; v1 ships simpler JWT.
- **Atomic install-record writes**: POSIX guarantee (write-temp-then-rename) — already established in Plugin Manager; same pattern for Gateway audit log and tenant records.
- **Audit log corruption**: append-only JSON-lines format is crash-safe (last partial line may be truncated, but prior lines are intact). Operators can `tail` it during write.

## Out of Scope

| Item | Reason deferred |
|---|---|
| OAuth 2.1 / Authorization Server Discovery for MCP | MCP marks auth as OPTIONAL; v1 ships simpler JWT. Add in a hosted-pack / OAuth pack when external IdP integration is needed. |
| Multi-process / distributed state (Redis buckets, DB audit, sticky session routing) | v1 is single-process. v2 once a customer requires horizontal scaling. |
| Streaming or async invocations | Most capabilities are sync. Long-running ops modeled as multiple sync calls per handler. Add when a v1 caller actually needs streaming. |
| MCP `prompts/*`, `resources/*`, `subscriptions/listen`, server-initiated `notifications/*`, sampling, elicitation | Out of v1 MCP surface. Most agents use `tools/*` only. Add when a concrete consumer asks. |
| Capability input validation in the Gateway | Trusts the handler. Add JSON Schema validation in v2 if user-facing validation errors become common. |
| Per-capability timeout configuration | Single default 30s (configurable). Per-call `timeoutMs` override in the canonical packet is deferred. |
| Backend SDK connection lifecycle (Backend Runtime pack) | The Gateway's `backend-sdk-*` dispatch path is wired but no SDK ships in v1. Owned by Tier 3 #8 `sdk-node`. |
| Hosted-platform provisioning UI | Hosted pack. v1 ships only the `tenant.*` capabilities + `agentide tenant create` CLI. |
| Auto-update mechanism for binary / Docker image | Operators upgrade manually. Signed auto-update is v2. |
| Capability deprecation semantics | Registry doesn't model deprecation. Add with Plugin Marketplace pack. |
| Version-range pinning (`>=1.0.0 <2.0.0`) | Explicit version pin is supported; ranges are deferred. |
| Browser-native extensions, dashboards, observability UI | Covered by separate packs. The Gateway exposes `gateway.*` capabilities for those packs to consume. |

## Further Notes

- **Architecture docs cross-references**: `docs/architecture/Agentide.md §9 (Gateway)`, `docs/architecture/Terminology.md → Gateway / Control Plane / Event Bus`, `docs/architecture/Business_Capability.md §Execution Flow (Gateway → Backend Runtime → Backend SDK → Application)`, `docs/architecture/Platform_Capabilities.md → Capability Categories`, `docs/architecture/Capability_System.md → Capability Manifest / Capability Types`, `docs/architecture/Goals.md §7 (Security by Default)`.
- **Grilling transcript**: `docs/CONTEXT.md` Decisions Log entries for 2026-07-27, `gateway-core grilling (Q1)` through `(Q12)`. Each decision is traceable to a question that was grilled.
- **Opensrc findings**: `~/.opensrc/repos/github.com/modelcontextprotocol/{typescript-sdk,modelcontextprotocol}/latest/` (cached locally). MCP contract captured in PRD sections "Product Scope — Core flow — agent invocation" and "Acceptance Criteria — MCP adapter".
- **Install UX prototype**: `agentide/prototypes/install-ux/simulate-install.ts`. Throwaway. Run with `npx tsx prototypes/install-ux/simulate-install.ts` to see the simulated output. The wording in this prototype becomes the spec for the real `install.sh` + `agentide init` + `agentide start` in `@platform/agentide`.
- **PHILOSOPHY alignment check**: "if we replace this component tomorrow, how much must change?" for MCP — nothing. For Gateway — nothing (the adapter package is replaceable). For Tier 1 components — nothing (the Gateway composes them). The kernel stays boring.
- **Related packs in flight**: `@platform/plugin-manager` (shipped 2026-07-27), `@platform/session-manager` (shipped 2026-07-27). Both consumed by `@platform/gateway-core`.
- **Open items carried forward from CONTEXT.md**: tenant design (resolved in this PRD — full lifecycle in v1); Plugin Marketplace operational details (separate pack); per-runtime ownership track (orthogonal).
- **Drift watch**: `docs/drift.md` is currently empty for gateway-core. If grilling decisions diverge from CONTEXT.md during TRD or implementation, log a drift entry.