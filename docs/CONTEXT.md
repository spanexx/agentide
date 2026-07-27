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
- 2026-07-27 — plugin-manager grilling — Manifest shape: top-level key (`runtime:`, `service:`, or `developer:`) names the plugin type and contains the plugin's `id`. Only one of these keys per manifest. Install source: `plugin.install` accepts both a registry id (lookup against the future Plugin Marketplace) and a local source path (`--source <local-path-or-private-url>`). v1 implements the local-source path; registry-id path is designed for but stubs out with a clear "marketplace unavailable" error until the marketplace pack ships. Disable = soft pause (capabilities stay registered, new invocations rejected with "plugin disabled", in-flight finish). Update = swap install record, re-register capabilities; in-flight invocations complete against the old version, new invocations route to the new. v1 validation: manifest schema valid + capability name format valid + no collision with already-registered capabilities. Platform-version constraints, cross-plugin dependencies, and source integrity are deferred to later packs. Storage (v1): install records persist to `./data/installed-plugins.json` (id, version, source path, install timestamp, enabled/disabled). On startup Plugin Manager reads the file and re-installs each plugin; missing source file at startup = re-install fails for that plugin with a clear error (existing install record preserved, operator can fix the source and run `plugin.reload` to recover). `plugin.reload` is a separate command from `plugin.update` — same mechanics, different entry point: reload re-reads the install record's source and refreshes the version field if the manifest version differs, but leaves source path / id / install timestamp / enable-disable state alone. Uninstall fires `plugin.cleanup` first (plugin cleans up its own resources), then `plugin.uninstalled` (install record removed, capabilities unregistered). In-flight capability invocations complete against the old version; idle sessions lose access on next call. Events: `plugin.installed`, `plugin.updated`, `plugin.reloaded`, `plugin.uninstalled`, `plugin.enabled`, `plugin.disabled`, `plugin.cleanup` — all separate, all under the `plugin.*` namespace. Errors: structured `{ code, message, details }` shape, terminal-only (no `plugin.error` event in v1).
