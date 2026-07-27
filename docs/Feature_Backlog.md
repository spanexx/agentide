# Agentide — Feature Backlog

> Lightweight sequencing list, not a doc pack. Each row becomes one `feature-pipeline` run
> (topic → Grill → PRD → EXPLAINED → TRD → FLOW → IMPL → Implement → Validate) when its turn
> comes up — not before. Derived from Agentide's Implementation Roadmap and Ownership Model.
>
> **Re-check this list before starting each new feature** — a completed feature can change an
> assumption an earlier-listed feature was built on. Update rather than silently drift.

## How to read this

- **Topic slug** — what `docs/features/<topic>/` will be named
- **Scope** — one line, not a PRD
- **Depends on** — must be implemented (not just designed) before this one starts
- **Source doc** — which Agentide doc/section this feature implements, for the Grill phase to reference

---

## Tier 1 — Control Plane foundations

No application, agent, or runtime can do anything until these exist. Build in this order —
each genuinely blocks the next.

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 1 | `event-bus` | Pub/sub delivery between components; no consumers required yet, just publish + subscribe + event immutability. **SHIPPED 2026-07-26** as `@platform/event-bus` — see [`packages/event-bus/`](../../packages/event-bus) and [`docs/features/event-bus/IMPL-event-bus.md`](features/event-bus/IMPL-event-bus.md). 29 behaviour tests pass; build/lint/typecheck clean. Upgraded to v2 API (prefix wildcards, PlatformEvent with id+publishedAt, Subscription object, normalized errors). | None | Terminology → Event Bus; Core Concept → Event |
| 2 | `capability-registry` | Store/query capability metadata (name, type, version, schema, permissions); `capability.list`/`search`/`describe`. **SHIPPED 2026-07-26** as `@platform/capability-registry` — see [`packages/capability-registry/`](../../packages/capability-registry) and [`docs/features/capability-registry/IMPL-capability-registry.md`](features/capability-registry/IMPL-capability-registry.md). 18 behaviour tests pass; build/lint/typecheck/check-banned-types clean. Public surface: createCapabilityRegistry(eventBus) returning register, list, search, describe. | `event-bus` (emits `capability.*` lifecycle events) | Capability System → Capability Structure/Lifecycle |
| 3 | `session-manager` | Create/resume/cleanup sessions; session-owns-resources model; timeout handling. **SHIPPED 2026-07-27** as `@platform/session-manager` — lifecycle, timers, events, resources, and archive purge implemented; full suite/typecheck/lint/build clean. | `event-bus` | Core Concept → Session; Terminology → Session Manager |
| 4 | `plugin-manager` | Install/update/uninstall plugins from a Plugin Manifest; dependency validation; plugin lifecycle | `event-bus`, `capability-registry` (plugins register capabilities here) | Terminology → Plugin Manifest; Agentide → Section 5 |

## Tier 2 — Gateway and entry points

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 5 | `gateway-core` | Auth, session creation, capability discovery, routing to a runtime — no execution logic | Tier 1 complete | Agentide → Section 9; Terminology → Control Plane |
| 6 | `platform-capabilities` | Expose `session.*`, `plugin.*`, `runtime.*`, `gateway.*`, `capability.*`, `system.*` as invocable capabilities with the read/write permission split | `gateway-core` | Platform Capabilities |
| 7 | `permission-tiering` | Implement the `read`/`act`/`destructive` scope convention platform-wide (not just documented) | `gateway-core`, `platform-capabilities` | Runtime Capabilities → Permissions and Risk Tiers; Goals → Security by Default |

## Tier 3 — Getting an application connected

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 8 | `sdk-node` | Register Business Capabilities via a Capability Manifest, connect to Gateway, execute handlers, emit lifecycle events. Package: `@platform/sdk-node` (Backend SDK role, Node/TypeScript — first implementation) | `gateway-core`, `capability-registry` | Business Capabilities; Agentide → Section 6, Phase 3 |
| 9 | `mcp-adapter` | Translate MCP protocol messages into Gateway requests — first way an agent can actually reach a connected app | `gateway-core` | Agentide → Section 8 |
| 10 | `rest-adapter` | REST adapter for non-MCP integrations | `gateway-core` | Agentide → Section 8 |

*(CLI and WebSocket adapters slot in here too, same dependency — order between the four is
mostly a priority call, not a technical blocker.)*

## Tier 4 — Browser-native capability

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 11 | `sdk-browser` | Register browser capabilities, UI state, browser↔Gateway communication. Package: `@platform/sdk-browser` (Frontend SDK role — single package, no per-language variants since it's inherently browser JS/TS) | `gateway-core`, `capability-registry` | Agentide → Section 6, Phase 4 |
| 12 | `browser-runtime` | Launch/close browser, tabs, navigate, click, type, screenshot — session-scoped, owns its own resources | `session-manager`, `sdk-browser`, `permission-tiering` | Runtime Capabilities → Browser Runtime example |

## Tier 5 — Visibility

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 13 | `dashboard-core` | Active sessions, installed plugins, registered capabilities, runtime health, logs, metrics — polls `platform-capabilities` | `platform-capabilities`, `browser-runtime` (for Browser Inspector) | Agentide → Section 14 |
| 14 | `devtools-extension` | Chrome DevTools surface for platform activity | `dashboard-core` | Agentide → Section 14 → Extended Tooling |
| 15 | `vscode-extension` | Capability autocomplete, manifest validation, runtime/session inspection in-editor | `dashboard-core`, `capability-registry` | Agentide → Section 14 → Extended Tooling |

## Tier 6 — Ecosystem growth (each needs an explicit go-ahead, not just a slot in this list)

| # | Topic slug | Scope | Depends on | Source doc | Blocker before starting |
|---|---|---|---|---|---|
| 16 | `plugin-marketplace-core` | Registry, trust tiers, publishing pipeline, `marketplace.*` capabilities, install resolution | `plugin-manager`, `platform-capabilities` | Plugin Marketplace | None — this one's ready to sequence in |
| 17 | `docker-runtime` | `docker.*` namespace, resource ownership (containers/networks/images/volumes) | `permission-tiering`, `plugin-marketplace-core` (if published, not core-team-only) | Runtime Capabilities → Docker Runtime example | **Needs an ownership-track decision** (core-team / community / customer-built) — see Agentide § 7 |
| 18 | `git-runtime` | `git.*` namespace via a native library (not CLI shell-out, per Agentide's recommendation) | Same as above | Runtime Capabilities → Git Runtime example | **Needs an ownership-track decision** + confirm library choice (`isomorphic-git` vs. `libgit2` bindings) |
| 19 | `file-runtime` | `filesystem.*` namespace | Same as above | Runtime Capabilities → Filesystem Runtime example | **Needs an ownership-track decision** |
| 20 | `kubernetes-runtime` | Container orchestration runtime, not yet namespaced in any doc | Same as above | (not yet written — would need its own capability naming pass first) | **Needs an ownership-track decision** + capability namespace design |
| 21 | `database-runtime` | `database.*` namespace incl. transactions | Same as above | Runtime Capabilities → Database Runtime example | **Needs an ownership-track decision** |
| 22 | `additional-backend-sdks` | `platform-sdk-go`, `platform-sdk-python`, `platform-sdk-rust`, `platform-sdk-java`, `platform-sdk-dotnet` — same Backend SDK role as `sdk-node`, additional languages | `sdk-node` (as the reference implementation) | Agentide → Phase 8 | None — ready once Tier 3 is proven out |

---

## Notes on sequencing logic

- **Tier 1 is a strict chain.** Don't parallelize — Session Manager and Plugin Manager both
  lean on Event Bus and Capability Registry existing first.
- **Tiers 2–5 mostly chain but have some real parallel opportunity** — e.g. once
  `gateway-core` lands, `sdk-node` and `mcp-adapter` don't block each other and
  could run as two separate pipeline instances if there's bandwidth for it.
- **Tier 6 is explicitly gated**, not just sequenced — items 17–21 all carry the same
  unresolved blocker from the drift/issue log follow-ups: no future runtime has an ownership
  track assigned yet. Don't let a `feature-pipeline` run start on any of them until that
  decision is made; otherwise the PRD phase will just rediscover the same open question this
  backlog is already flagging.
- **Re-verification checkpoint:** after Tier 1 and again after Tier 3, re-read this whole
  list. Those are the two points most likely to surface "wait, now that X is real, Y needs to
  change."

---

## What this list deliberately does not include

- No PRDs, TRDs, or any doc-pack content for anything beyond what's already in the Agentide
  doc set — that content gets generated per-feature, when that feature's pipeline run starts.
- No estimates or dates — this is a dependency-ordered list, not a schedule.
- No commitment that every Tier 6 item ships — several are still open design questions
  (ownership track, ecosystem demand) rather than committed work.
