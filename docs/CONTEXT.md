# CONTEXT.md

Glossary + standing conventions for the Agentide project, maintained as features are built.
This is a working reference for `feature-pipeline` grilling sessions — a stability signal is
a term or decision already captured here rather than re-litigated per feature.

Full architecture docs live in `docs/architecture/` (Vision, Goals, Agentide, Terminology,
Core Concept, Capability System, Business/Platform/Runtime Capabilities, Architectural
Refinement V1, Plugin Marketplace). This file is the condensed, code-facing version — update
it whenever a `feature-pipeline` run settles something new. `docs/Feature_Backlog.md` and
`docs/drift-issue-log.md` track sequencing and known design gaps respectively.

**Governing philosophy:** [PHILOSOPHY.md](/home/spanexx/Shared/Learn/Agent-Bridge-SDK/PHILOSOPHY.md)
governs every architecture decision. Every component, interface, and dependency must satisfy
the replaceability test: *"If we replace this component tomorrow, how much of the rest must
change?"* The ideal answer is nothing.

---

## Glossary

| Term | Meaning |
|---|---|
| **Platform** | The whole system: Gateway, Session Manager, Capability Registry, Plugin Manager, Event Bus, SDKs, Runtimes, Adapters, Dashboard |
| **Application** | Software built by a developer that connects to the platform via an SDK — never installed into the platform itself |
| **SDK** | A role (Backend or Frontend), not a single package — see SDK Naming Convention below |
| **Capability** | Smallest invocable unit — `<domain>.<action>`, typed `business` / `platform` / `runtime` |
| **Capability Registry** | Catalog of every capability; discovery only, no execution |
| **Gateway** | Entry point — auth, session creation, discovery, routing. Never executes |
| **Control Plane** | Gateway + Session Manager + Capability Registry + Plugin Manager — coordinates, doesn't execute |
| **Execution Plane** | All Runtimes (Browser, Backend, Docker, Git, etc.) — executes, doesn't coordinate |
| **Session** | An execution context (not chat history) — owns its runtime resources, auto-cleaned on destroy. Lifecycle: Active (running) ⇄ Suspended (paused, resources retained) → Archived (soft-delete, metadata retained for TTL) |
| **Session Manager** | Creates/resumes/destroy sessions. Tracks runtime resources per session. Part of the Control Plane |
| **Session Suspend** | Moving a session from Active to Suspended — resources preserved, execution paused. Triggered by idle timeout or Gateway policy |
| **Session Resume** | Moving a session from Suspended to Active — resources restored, execution continues. Called by Gateway via session ID only |
| **Session Archive** | Soft-delete state after destroy — session metadata kept for configurable TTL, resources already cleaned up |
| **Runtime** | An execution environment (Browser Runtime, Backend Runtime, etc.), owns its own resources |
| **Adapter** | Pure protocol translator (MCP, CLI, REST, WebSocket) — no business logic, no state |
| **Audit Log** | Append-only structured log (default `./data/audit.log`) where the Gateway records one JSON object per capability invocation. Mirrored on the Event Bus as `gateway.invocation` for downstream consumers. Records `caller`, `session`, `capability`, `owner`, `status` (`ok` / `denied` / `error`), `denyReason` / `errorCode`, `durationMs`. Input payloads are NOT logged (PII stays in the application) |
| **Tenant** | An isolated organization within a platform installation. v1 gateway-core ships full tenant-lifecycle capabilities (`tenant.create`, `tenant.list`, `tenant.suspend`, `tenant.delete`) usable by both self-hosted operators (who may run a single tenant per install) and hosted platforms (who provision many tenants per process). Every token's `sub` is `{ tenantId, callerId }`; every audit record, rate-limit bucket, and session record carries `tenantId`. The Gateway refuses any cross-tenant operation. Self-hosted operators ignore `tenant.create` and live with one auto-provisioned tenant; hosted platforms use the full lifecycle |
| **Capability Invocation** | The canonical unit of work the Gateway routes: `{ caller, session?, capability, input } → { output } or { error }`. Every platform, business, and runtime capability call is shaped this way inside the Gateway, regardless of which adapter (MCP/CLI/REST/WS) the caller used |
| **Plugin** | Extends the platform without touching core — Runtime Plugin / Service Plugin / Developer Plugin |
| **Plugin Manager** | Installs/updates/removes plugins from a Plugin Manifest |
| **Plugin Manifest** | Declarative plugin identity + version + capabilities it registers. Top-level key indicates the plugin type: `runtime:`, `service:`, or `developer:` (exactly one per manifest) — the key both names the type and contains the plugin's `id`. Runtime example: `runtime: { id: browser }`. Service plugins expose no capabilities (observe-only); developer plugins likewise. |
| **Capability Manifest** | An application's declarative capability list, published at startup |
| **Event / Event Bus** | Immutable fact + the pub/sub delivery mechanism between components. Custom (not EventEmitter). Sync dispatch in subscription order. Async handlers via `Promise.allSettled`. One handler failure never blocks others. Dot-delimited prefix wildcard: `*` as final segment matches any remaining depth (e.g. `browser.*` matches `browser.page.loaded`); bare `*` matches every event. `Object.freeze()` shallow immutability at publish. Subscribe returns `Subscription` with `.unsubscribe()`. Failures surfaced as `event.handler_failed` with `{ eventName, subscriberPattern, error: { message, stack? } }` — never silent. `event.*` is reserved for bus-internal events. |
| **Resource** | Anything owned by a session (browser tab, temp file, DB transaction) — cleaned up with the session |
| **Tenant** | Isolated org/customer in a hosted deployment — **not yet fully designed**, see Open Items |

---

## Established Conventions (apply to every feature, not just one)

### Capability typing
Every capability is `business` (app-owned), `platform` (platform-core-owned), or `runtime`
(runtime-plugin-owned). Classification test: what does it touch — your app's data, the
platform's own internals, or an external execution environment?

### Permission tiering
Runtime Capabilities use a three-tier scope convention:
```
runtime.<namespace>.read          — observe only
runtime.<namespace>.act           — normal, reversible action
runtime.<namespace>.destructive   — irreversible / high-impact action
```
Platform Capabilities use a two-tier read/write split (e.g. `platform.plugin.read` vs.
`platform.plugin.install`). Business Capabilities don't need tiering today — each one is
already a single named action.

### SDK naming
"Backend SDK" and "Frontend SDK" are roles, not packages. Concrete packages:

| Role | Language | Package |
|---|---|---|
| Backend | Node/TypeScript | `@platform/sdk-node` (reference implementation, Phase 3) |
| Backend | Python | `platform-sdk-python` |
| Backend | Go | `platform-sdk-go` |
| Backend | Rust | `platform-sdk-rust` |
| Backend | Java | `platform-sdk-java` |
| Backend | .NET | `platform-sdk-dotnet` (NuGet: `Platform.Sdk`) |
| Frontend | Browser only | `@platform/sdk-browser` — no per-language variants |

### Deployment model permissions
Self-hosted: the operator may hold the full `platform.*` range. Hosted/SaaS: write-tier
`platform.plugin.*` (and similarly infrastructure-affecting) permissions are reserved for the
platform operator, never an individual tenant. Tenants get Business Capability registration
(not a `platform.*` permission at all) plus read-tier platform visibility.

### Ownership model (where does a new feature belong?)
```
Applications  own  Business Logic
Platform      owns Coordination
Runtimes      own  Execution
Adapters      own  Communication
Plugins       own  Extensibility
```

### Future runtime ownership tracks
Every future runtime (Docker, Git, File, Kubernetes, Database) must be assigned one of:
core-team-built / community-contributed / customer-built, before it moves from "future" to
a scheduled implementation. None are assigned yet.

---

## Open Items (known unresolved — don't let a feature quietly re-decide these)

- **Tenant design** — multi-tenancy isolation semantics beyond the plugin-permission split
  above are not fully specified.
- **Plugin Marketplace operational details** — review SLA for Verified tier, revocation
  handling for already-installed malicious plugins, monetization, and runtime sandboxing are
  all explicitly out of scope in the current design.
- **Per-runtime ownership track assignment** — the framework exists; which specific track
  each future runtime lands on hasn't been decided.

---

## Decisions Log

Append here as each `feature-pipeline` run settles something. Format: `<date> — <topic> —
<decision>`.

- 2026-07-26 — project bootstrap — TypeScript/Node monorepo, npm workspaces, vitest for
  tests, flat-config ESLint. Reference stack for the whole platform core + first Backend SDK.
- 2026-07-26 — philosophy adoption — [PHILOSOPHY.md](/home/spanexx/Shared/Learn/Agent-Bridge-SDK/PHILOSOPHY.md)
  adopted as governing engineering philosophy. All future decisions measured against replaceability test.
- 2026-07-26 — event-bus (v1) — Wildcards: `*` = one segment, `**` = any depth.
  `event.handler_failed` carries original event + handler index + error. Mixed sync/async
  handlers are invoked in subscription order, and `event.*` remains bus-internal only.
- 2026-07-26 — event-bus (v2 upgrade) — Wildcards switched to prefix model: `*` as final
  segment matches any remaining depth; bare `*` matches everything. `**` removed. Event type
  renamed to `PlatformEvent` with added `id` (UUID) + `publishedAt`. Subscribe returns
  `Subscription` object with `.unsubscribe()` instead of bare function. Failure payload
  changed to `{ eventName, subscriberPattern, error: { message, stack? } }`. Error objects
  normalized before surfacing. Malformed wildcard patterns (e.g. `br*wser.*`) rejected at
  subscribe time. All 29 existing tests updated and passing.
- 2026-07-26 — session-manager grilling — State machine: Active ⇄ Suspended → Archived (soft-delete). Suspend/destroy: Gateway + Session Manager combined policy (A + C). Resume: session ID only (Gateway is sole caller). Timeouts: 5 min idle → Suspend, 30 min TTL → Archive, both configurable per-session. Resource tracking: direct registration via Session Manager, cleanup triggered via Event Bus (`session.cleanup_resources`). Events: `session.created`, `session.suspended`, `session.resumed`, `session.destroyed`, `session.cleanup_resources`. Cleanup ordering: `cleanup_resources` fires before `destroyed`.
- 2026-07-28 — platform-capabilities grilling (Q1, ownership) — Platform capabilities are registered under the owner of the *module* that owns them, not under a single "gateway" owner. session.* → owner=`session-manager`, capability.* → owner=`capability-registry`, tenant.* / auth.* / gateway.* stay under owner=`gateway` (no separate module exists in v1). plugin.* (when added) → owner=`plugin-manager`. Dispatch already routes these owners in-process (`dispatch.ts` lines 207-212); this decision just makes the registration match what the dispatcher expected.
- 2026-07-28 — platform-capabilities grilling (Q2, scope) — BI[6] ships `plugin.*` (6 caps: install/list/uninstall/enable/disable/reload) and `system.*` (3 caps: info/version/health), plus the ownership migration from gateway-core's existing 16 caps. `runtime.*` (platform-owned runtime management) is punted until a Runtime Manager pack exists — no Runtime Manager in v1. `marketplace.*` is BI[16]; `dashboard.*` is BI[13]. Both stay separate backlog items.
- 2026-07-28 — platform-capabilities grilling (Q3, permission naming) — Every write-tier platform cap declares `platform.<domain>.write`. Every read-tier platform cap declares `platform.<domain>.read`. Renames: `platform.session.create/delete/write` → `platform.session.write`, `platform.tenant.write` stays, `platform.token.issue` → `platform.token.write`, plus new `platform.plugin.read|write` and `platform.system.read`. The wildcard scope `platform.*.read` covers every read-tier platform cap (authz tier-hierarchy already supports this).
- 2026-07-28 — platform-capabilities grilling (Q4, package location) — Ships as a new separate package `@platform/platform-capabilities` under `packages/platform-capabilities/`, not added to gateway-core. Same shape as `@platform/plugin-manager`: own package.json, own tests, own tsconfig, workspace ref in root tsconfig. Operators gain one extra import but read 25 caps in one place instead of mixing built-ins into the kernel package.
- 2026-07-28 — platform-capabilities grilling (Q5, registration wiring) — `@platform/platform-capabilities` exports `registerPlatformCapabilities(registry)` that registers ALL 25 platform caps: its own 9 new (`plugin.*` × 6 + `system.*` × 3) AND the migrated 16 from gateway-core (now under their real owners: `session-manager`, `capability-registry`, `gateway`). `createGateway()` calls `registerPlatformCapabilities(registry)` instead of the old `registerGatewayCapabilities`. The old function is removed from gateway-core — single source of truth for platform caps lives in the new package.
- 2026-07-28 — platform-capabilities grilling (Phase 0.5, uncertainty scan) — U1-U7 all classified. U2 (system.health depth) was the only detour candidate; user opted to skip the prototype and pick a default in IMPL: `system.health` returns `{status: "ok"}` in v1 single-process; "degraded" path deferred to v2 when there are runtimes to check. U3 (plugin.list tenant filter) and U6 (degraded test) punt to BI[7] permission-tiering. U4 / U5 / U7 resolved inline (consistent with BI[4] plugin-manager / standard read-tier exposure / semver + optional build-hash format).
- 2026-07-27 — plugin-manager grilling — Manifest shape: top-level key (`runtime:`, `service:`, or `developer:`) names the plugin type and contains the plugin's `id`. Only one of these keys per manifest. Install source: `plugin.install` accepts both a registry id (lookup against the future Plugin Marketplace) and a local source path (`--source <local-path-or-private-url>`). v1 implements the local-source path; registry-id path is designed for but stubs out with a clear "marketplace unavailable" error until the marketplace pack ships. Disable = soft pause (capabilities stay registered, new invocations rejected with "plugin disabled", in-flight finish). Update = swap install record, re-register capabilities; in-flight invocations complete against the old version, new invocations route to the new. v1 validation: manifest schema valid + capability name format valid + no collision with already-registered capabilities. Platform-version constraints, cross-plugin dependencies, and source integrity are deferred to later packs. Storage (v1): install records persist to `./data/installed-plugins.json` (id, version, source path, install timestamp, enabled/disabled). On startup Plugin Manager reads the file and re-installs each plugin; missing source file at startup = re-install fails for that plugin with a clear error (existing install record preserved, operator can fix the source and run `plugin.reload` to recover). `plugin.reload` is a separate command from `plugin.update` — same mechanics, different entry point: reload re-reads the install record's source and refreshes the version field if the manifest version differs, but leaves source path / id / install timestamp / enable-disable state alone. Uninstall fires `plugin.cleanup` first (plugin cleans up its own resources), then `plugin.uninstalled` (install record removed, capabilities unregistered). In-flight capability invocations complete against the old version; idle sessions lose access on next call. Events: `plugin.installed`, `plugin.updated`, `plugin.reloaded`, `plugin.uninstalled`, `plugin.enabled`, `plugin.disabled`, `plugin.cleanup` — all separate, all under the `plugin.*` namespace. Errors: structured `{ code, message, details }` shape, terminal-only (no `plugin.error` event in v1).
- 2026-07-27 — gateway-core grilling (Q1) — Adapter translation: each adapter (MCP/CLI/REST/WS) translates its native protocol into a single canonical `Capability Invocation` packet and back; the Gateway exposes one `handleInvocation(req) → response` function. All adapter-specific logic stays in the adapter; the Gateway's dispatch/auth/authz/session/routing logic lives in one place and can be exercised in tests by calling `handleInvocation` directly.
- 2026-07-27 — gateway-core grilling (Q2) — Auth strategy: bearer tokens (JWT) issued by the Gateway itself in v1. Operators invoke an `auth.token.issue` capability to mint a token; callers (SDKs, AI agents) present `Authorization: Bearer <token>` on every request. Tokens are signed by the Gateway (HS256 in v1), carry claims (`sub` = callerId, `scope` = permission strings, `exp` = expiry), and have a short lifetime (default 1h) with refresh. v1 is self-signed; upgrade to RS256 (public-key, multi-IdP) is a later concern.
- 2026-07-27 — gateway-core grilling (Q3) — Session lifecycle: explicit, caller-initiated. The Gateway exposes `session.create` / `session.destroy` as regular platform capabilities; the caller invokes `session.create` and receives a `sessionId`. All capability calls (other than session-management itself and read-only discovery) carry that `sessionId` in the canonical packet. Required-vs-optional split: `session.*` lifecycle calls and read-only discovery (`capability.*`, `plugin.list`, `plugin.describe`, `gateway.status`, `system.*`) do not require a session; `plugin.install/update/uninstall/disable/enable`, `business.*`, and `runtime.*` always require one. Matches MCP's connection-oriented agent model and lets runtime resources (browser tabs, temp files) be naturally session-scoped.
- 2026-07-27 — gateway-core grilling (Q4) — Authz algorithm: tier-hierarchy match, scoped per namespace. Runtime caps: `read` < `act` < `destructive` (higher tier covers lower). Platform caps: `read` < `write` (same). Business caps: exact match — each capability is its own action, no tier implied. Matching rule: for each permission the capability declares, look up the matching scope in the caller's token by `(prefix, tier)`; if the caller's tier rank ≥ the capability's required tier rank → allowed. If none of the capability's declared permissions are covered → deny with `INSUFFICIENT_SCOPE`. Lets ops tokens carry one high-tier scope covering many capabilities; capability authors declare the *minimum tier* required (one entry), not every tier that grants access.
- 2026-07-27 — gateway-core grilling (Q5) — Dispatch model: three paths keyed by owner prefix on the CapabilityRecord. (a) `platform-*` built-ins (`session-manager`, `plugin-manager`, `capability-registry`) → in-process direct call. (b) `plugin:<id>` runtime plugins → in-process via Plugin Manager, which returns the runtime's handler reference. (c) `backend-sdk-*` business capabilities → forward to a Backend Runtime component (in-process with the Gateway in v1) which maintains persistent connections to SDKs running in user apps. Gateway never holds SDK connections itself; it just calls `runtime.invoke(owner, capability, input)`. Backend Runtime encapsulates the SDK-transport complexity. Matches the architecture docs' flow (`Gateway → Backend Runtime → Backend SDK → Application` for business capabilities).
- 2026-07-27 — gateway-core grilling (Q6) — Audit logging: two complementary surfaces — durable + observable. (1) The Gateway appends one JSON record per capability invocation to `./data/audit.log` (configurable path), one JSON object per line, persistent. Record fields: `ts`, `caller.id`, `caller.scope`, `session.id` (if present), `capability.name`, `capability.version`, `owner`, `status` (`ok` / `denied` / `error`), `denyReason` or `errorCode`, `durationMs`. Input payloads are NOT logged (PII stays in the application). (2) Same record shape emitted on the Event Bus as `gateway.invocation` for downstream observability (dashboards, analytics plugins, future SIEM integrations). Denials and errors produce audit records too — Gateway never silently drops an invocation from the log. Event Bus failures don't lose audit records (file is durable copy); file write failures don't break the invocation (best-effort, error logged to stderr).
- 2026-07-27 — gateway-core grilling (Q7) — Rate limiting: per-caller token bucket, configurable rate and capacity. Each `callerId` (from token `sub`) gets its own bucket. Capacity default 100, refill rate default 10/sec, both configurable. Every invocation attempt — successful, denied, or errored — consumes one token. Empty bucket → `RATE_LIMIT_EXCEEDED` returned without dispatch. Buckets are in-memory (single-process in v1; restart resets). Buckets keyed on `callerId` (NOT sessionId) so a malicious caller can't open new sessions to bypass; NOT keyed per-capability for v1 (audit log already shows who spammed which capability; per-capacity buckets can layer on later if needed).
- 2026-07-27 — gateway-core grilling (Q8) — Tenant isolation: full tenant lifecycle in v1 (option B). Every token's `sub` is `{ tenantId, callerId }`; every audit record, rate-limit bucket, and session record carries `tenantId`. The Gateway refuses any cross-tenant operation. v1 ships `tenant.create`, `tenant.list`, `tenant.suspend`, `tenant.delete` capabilities + per-tenant admin tokens. Self-hosted operators ignore `tenant.create` and live with one auto-provisioned tenant (bootstrap token generated at install); hosted platforms use the full lifecycle to provision customer orgs. Reasons B over A in v1: hosted pack becomes purely additive (consumes gateway-core's tenant API); self-hosted users see extra capabilities they ignore (cosmetic); tenant enforcement is identical in both shapes — only provisioning differs. Token issuance API: `auth.token.issue --tenant <id> --caller <id> --scope ...`. Bucket key: `(tenantId, callerId)`. Cross-tenant session resume refused. Cross-tenant capability invocation refused.
- 2026-07-27 — gateway-core grilling (Q9) — Dispatch failure model: fail-fast, no silent retries, one stable `GATEWAY_*` error code per failure mode, every failure produces an audit record with `status: "error"`. Codes: `GATEWAY_CAPABILITY_NOT_FOUND` (typo / unregistered), `GATEWAY_PLUGIN_NOT_INSTALLED` (runtime plugin absent), `GATEWAY_PLUGIN_DISABLED` (runtime plugin paused), `GATEWAY_SDK_UNREACHABLE` (business SDK disconnected), `GATEWAY_MANAGER_UNAVAILABLE` (platform manager in degraded state), `GATEWAY_HANDLER_TIMEOUT` (handler exceeded timeout), `GATEWAY_INTERNAL_ERROR` (anything else). Each error response carries `retryable: boolean` so the caller can decide whether to retry; Gateway doesn't enforce a retry policy on the caller. Auto-reconnect / circuit-breaker on SDK loss lives in Backend Runtime, NOT in the Gateway — Gateway's job is to surface failures clearly; Backend Runtime's job is to keep connections healthy.
- 2026-07-27 — gateway-core grilling (Q10) — Capability version resolution: auto-latest by default, explicit pinning available. Canonical packet carries `capability: { name, version? }`. When `version` is omitted, the Gateway calls `capabilityRegistry.describe(name)` and gets the latest registered version. When supplied, `describe(name, version)` returns that specific version. Resolved version recorded in the audit log so operators see what actually executed even when callers pinned. Calling a non-existent version returns `GATEWAY_CAPABILITY_NOT_FOUND`. No deprecation concept in v1 (the Capability Registry doesn't model it); when marketplace ships with deprecation, the Gateway refines to "latest non-deprecated" without breaking default behavior.
- 2026-07-27 — gateway-core grilling (Q11) — Invocation semantics: strict sync only in v1. No submit-and-poll, no streaming, no in-flight invocation tracking beyond a timeout. Caller blocks on `handleInvocation(req)` and gets `{output}` or `{error}` back. Default handler timeout 30s (configurable per-call via `timeoutMs` field in the canonical packet). Long-running operations are modeled in the HANDLER, not the Gateway — e.g., a `migration.start` capability returns `{jobId}`; the caller then uses `migration.status` and `migration.result` as separate sync calls. Streaming, async submit-and-poll, and in-flight cancellation all deferred to v2+ (no v1 caller needs them; complexity is significant).
- 2026-07-27 — gateway-core grilling (Q12) — Distribution + default adapter: ship as a binary + Docker image + npm CLI, all built from the same source. Primary install is the one-liner `curl -fsSL https://agentide.io/install.sh | bash` which auto-detects environment (binary/Docker/npx), initializes `~/.agentide/data/`, generates a bootstrap operator token, starts the platform with MCP adapter listening on `localhost:7100`, and prints the token + connection URL. The MCP adapter is bundled in the default distribution but replaceable via `--no-default-adapters` or `--adapter /path/to/custom-adapter.js` — PHILOSOPHY.md "Nothing Is Special" applied. The adapter package (`@platform/adapter-mcp`) stays a separate npm package; the binary bundles it but doesn't own it. Day-2 operator lifecycle is CLI: `agentide status / logs / stop / start / upgrade` plus shells over gateway-core capabilities (`agentide tenant create / list / suspend / delete`, `agentide plugin install`, `agentide token issue`). No operator code, ever. Backlog implications: new pack `@platform/agentide` provides the composition + CLI + distribution. Tier 2 #5 gateway-core + #6 platform-capabilities + #7 permission-tiering stay as planned; `@platform/agentide` slots in between gateway-core and platform-capabilities as the operator entry point.
- 2026-07-27 — gateway-core grilling (Q6) — Audit logging: two complementary surfaces, same record shape. (a) Append-only structured file at `./data/audit.log` (configurable via `config.auditLogPath`) — one JSON object per line, includes `ts`, `caller.{id,scope}`, `session.{id}`, `capability.{name,version}`, `owner`, `status` (`ok`/`denied`/`error`), optional `denyReason` / `errorCode`, and `durationMs`. Best-effort write — file write failures do not block the invocation but are surfaced to stderr. (b) Event Bus event `gateway.invocation` with the same payload shape, so dashboards / analytics plugins / future SIEM integrations can subscribe without coupling to the file format. v1 logs input *shape* (capability name + version) but NOT the actual input payload — sensitive data stays in the application. Log rotation is external (logrotate) in v1; reserved `schemaVersion: 1` field for forward compatibility.
- 2026-07-28 — platform-capabilities ship (BI[6]) — 25 caps registered under their real owners (12 gateway + 5 session-manager + 2 capability-registry + 6 plugin-manager). Permission split standardized to `platform.<domain>.<read|write>`. New wildcard `platform.*.read` covers every read-tier platform cap — implemented via a 3-line authz.ts fix in `tierCovers` (parts[1] === '*' → rank check). The 4-call `registerPlatformCapabilities` migration handles the upgrade path cleanly: phase 1 re-registers `gateway` with only its 12 caps (registry diff removes the 7 legacy caps under `gateway` whose owners moved); phase 2 registers the other 13 caps under their new owners. CLI gains `--owner` and `--tier` filters on `capability list`. `SESSION_LESS_CAPABILITIES` set extended to include `plugin.list`, `system.*`, `auth.token.*` per GRILL Q3. The legacy `registerGatewayCapabilities` is removed. Total: 307 tests pass (was 242). Zero new third-party deps.
- 2026-07-29 — permission-tiering ship (BI[7]) — `read`/`act`/`destructive` tier hierarchy enforced end-to-end across 5 packages. `CapabilityTier` added to `@platform/capability-registry` types; `validateRecord()` rejects business caps with tier, runtime caps without tier, and wrong-tier values; `deriveTier()` helper for platform caps that don't declare one. `@platform/plugin-manager` ships `tierFromConvention()` verb lookup (READ/ACT/DESTRUCTIVE verb sets); `buildCapabilityRecords()` calls convention + accepts explicit override; unknown verb throws `PLUGIN_TIER_REQUIRED`. `@platform/platform-capabilities` declares explicit `tier:` on all 25 caps. `@platform/gateway-core` `authz.ts` adds tier-hierarchy `checkAuthz()` with namespace scoping (same kind + same namespace + caller rank ≥ required rank); `platform.*.<tier>` namespace wildcard already from BI[6] covers every domain under one scope. `capability.list` filter now hides catalog entries the caller cannot invoke — a non-bootstrap caller cannot enumerate capabilities they can't call. `@platform/agentide` CLI `--tier` filter uses first-class `card.tier` field (fixed from permission-string parsing). Tier 2 complete. Drift review verdict "Minor Drift" — 7 gaps all resolved this session (stale IMPL status, "No new flags" claim, Scenario 4 error-vs-null, missing tier-convention unit tests, CLI filter parsing, sim `stageTier()` theater, missing `stageInvoke()`/`stageAudit()`); see `docs/drift.md` D-14 → D-27. Also resolved D-1 (session-manager docs reconciliation: `touch()` API contract, attach-permits-suspended, timeout minimum `>= 1`, touch-throws-on-non-active) as D-28. Total: 394 tests pass across 37 vitest files (was 383 before this session; +11 tier-convention tests). Zero new third-party deps. Unblocks Tier 4 `browser-runtime` and Tier 5 `dashboard-core` tier badges.
- 2026-07-29 — sdk-node ship (BI[8]) — `@platform/sdk-node` shipped as the reference Backend SDK (Node/TypeScript). Connects to the Gateway over WebSocket via `WsClient` (with 30s reconnect backoff cap and ±20% jitter per PRD Scenario 5), registers Business Capabilities from a manifest, executes handlers locally on inbound invocations, and emits 8 lifecycle events on the Event Bus: `sdk.connected`, `sdk.disconnected`, `sdk.capability.registered`, `sdk.capability.unregistered`, `sdk.capability.rejected` (8th event added in Phase 7 for async Gateway rejection), `sdk.invoke.started`, `sdk.invoke.completed`, `sdk.invoke.failed`. Public surface: `createSdk(config)` → `SdkInstance` with `connect()`, `register()` (async — Gateway rejection surfaces via `sdk.capability.rejected`, not a synchronous throw), `invoke()`, `disconnect()` (sets `closed=true`; no auto-reconnect on explicit disconnect), `reset()`, `state()`. Wire types are concrete: `WirePrimitive | WireObject | readonly WirePrimitive[] | readonly WireObject[]` for handler input/output; meta on Logger is scalar-only `Record<string, string | number | boolean | null>`. Each SDK instance gets its own Event Bus so subscribers don't see events from unrelated SDKs. 55 tests pass across 7 vitest files. Drift review verdict "Minor Drift" — 5 gaps all resolved this session (8th event added to PRD-TRD table; `register()` contract rewritten as async event-driven; Scenario 5 rewritten to distinguish explicit `disconnect()` from unexpected Gateway drop; IMPL Phase 3 module-layout note pointing to `index.ts:121-130` for inlined `connect()` and `lifecycle.test.ts` for 9 consolidated tests); see `docs/drift.md` D-2 → D-9. Browser sim at `docs/features/sdk-node/simulate.html` drives the real SDK via `ws→globalThis.WebSocket` shim + dropper callback so reconnect is observable. Not yet wired to Gateway dispatch — `gateway-sdk-dispatch` (BI[8b) replaces `GATEWAY_SDK_UNREACHABLE` with real `backend-sdk-*` owner routing. Adds one third-party dep: `ws`.
