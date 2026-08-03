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
| 4 | `plugin-manager` | Install/update/uninstall plugins from a Plugin Manifest; dependency validation; plugin lifecycle. **SHIPPED 2026-07-27** as `@platform/plugin-manager` — see [`packages/plugin-manager/`](../../packages/plugin-manager) and [`docs/features/plugin-manager/IMPL-plugin-manager.md`](features/plugin-manager/IMPL-plugin-manager.md). 107 behaviour tests pass; build/lint/typecheck/check-banned-types clean. Public surface: async `createPluginManager(eventBus, capabilityRegistry, config?)` returning `{ install, installFromRegistry, update, reload, disable, enable, uninstall, list, get }`. Startup re-install reads `./data/installed-plugins.json` and re-registers every plugin (sets `lastError` on failure, does NOT fire `plugin.installed` on startup). Seven `plugin.*` events. Structured `{ code, message, details }` errors. `installFromRegistry` is a stub (`PLUGIN_MARKETPLACE_UNAVAILABLE`) until the marketplace pack ships. | `event-bus`, `capability-registry` (plugins register capabilities here) | Terminology → Plugin Manifest; Agentide → Section 5 |

## Tier 2 — Gateway and entry points

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 5 | `gateway-core` | Auth, session creation, capability discovery, routing to a runtime — no execution logic | Tier 1 complete | Agentide → Section 9; Terminology → Control Plane |
| 6 | `platform-capabilities` | Expose `session.*`, `plugin.*`, `runtime.*`, `gateway.*`, `capability.*`, `system.*` as invocable capabilities with the read/write permission split | `gateway-core` | Platform Capabilities |
| 7 | `permission-tiering` | Implement the `read`/`act`/`destructive` scope convention platform-wide (not just documented). **SHIPPED 2026-07-29** — see [`docs/features/permission-tiering/`](features/permission-tiering/) and source in five packages: `packages/capability-registry/src/{types,validate}.ts` (tier field on `CapabilityRecord`/`CapabilityCard`, validateRecord tier rules, deriveTier helper); `packages/plugin-manager/src/{tier-convention,lifecycle-helpers}.ts` (verb lookup + TIER_REQUIRED error); `packages/platform-capabilities/src/caps.ts` (explicit `tier:` on all 25 caps); `packages/gateway-core/src/authz.ts` + `factory.ts:383-399` (tier-hierarchy checkAuthz + tier-aware `capability.list` filter); `packages/agentide/src/cli.ts:213-235` (`--tier` filter and tier column). 394 behaviour tests pass across 37 vitest files (was 383; +11 tier-convention tests); build/lint/typecheck/check-banned-types clean. Drift review verdict "Minor Drift" — 7 gaps all resolved this session (see `docs/drift.md` D-14 through D-27). Unblocks Tier 4 (`browser-runtime` tier-aware authz) and Tier 5 (`dashboard-core` tier badges). | `gateway-core`, `platform-capabilities` | Runtime Capabilities → Permissions and Risk Tiers; Goals → Security by Default |

## Tier 3 — Getting an application connected

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 8 | `sdk-node` | Register Business Capabilities via a Capability Manifest, connect to Gateway, execute handlers, emit lifecycle events. Package: `@platform/sdk-node` (Backend SDK role, Node/TypeScript — first implementation). **SHIPPED 2026-07-29** — see [`packages/sdk-node/`](../../packages/sdk-node) and [`docs/features/sdk-node/`](features/sdk-node/). 55 behaviour tests pass across 7 vitest files (lifecycle.test.ts covers 30s reconnect backoff cap with ±20% jitter; register.test.ts covers async-rejection via 8th event `sdk.capability.rejected`); build/lint/typecheck/check-banned-types clean. Public surface: `createSdk(config)` → `SdkInstance` with `connect()`, `register()`, `invoke()`, `disconnect()`, `reset()`, `state()`. 8 lifecycle events on the bus (`sdk.connected`, `sdk.disconnected`, `sdk.capability.{registered,unregistered,rejected}`, `sdk.invoke.{started,completed,failed}`). Browser sim at `docs/features/sdk-node/simulate.html` drives the real SDK via a `ws→globalThis.WebSocket` shim and a dropper callback so the reconnect path is observable without a real Gateway. Drift review verdict "Minor Drift" — 5 gaps all resolved this session (see `docs/drift.md` D-2 → D-9). Not yet wired to Gateway dispatch — `gateway-sdk-dispatch` (BI[8b) follows. | `gateway-core`, `capability-registry` | Business Capabilities; Agentide → Section 6, Phase 3 |
| 9 | `mcp-adapter` | Translate MCP protocol messages into Gateway requests — first way an agent can actually reach a connected app. **SHIPPED 2026-08-01** — new package `@platform/adapter-mcp` (Streamable HTTP transport, JSON-RPC 2.0 handler, error code mapping -32001..-32006), wired into `@platform/agentide` factory (`adapterMcp?` / `adapterMcpPort?` / `adapterMcpHost?` on `CreatePlatformConfig`; auto-registers unless `adapterMcp: false`); CLI opts out per subcommand. 43 behaviour tests pass across 4 vitest files (18 translate + 7 server + 13 scenarios incl. the 8 PRD scenarios + 5 agentide integration scenarios); full repo: 536/536 pass; build/lint/typecheck/check-banned-types clean. 8/8 post-impl scenarios pass at `packages/agentide/scripts/simulate-mcp-adapter.mjs` — INTERCONNECTED (reads `tokens` fixtures from shared `data/sim-state.json`, mirrors real `gateway.invocation` events + audit records via `scripts/sim-state.mjs`) and INTERACTIVE (`-i` menu: single scenarios, custom `tools/call` with caller/capability/args/session prompts, run-all, state view). Drift review at `.reports/2026-08-01-drift-mcp-adapter.md` (Minor Drift): D-28 resolved by IMPL retro-fit ([`IMPL-mcp-adapter.md`](features/mcp-adapter/IMPL-mcp-adapter.md)); D-29..D-32 accepted and logged in `docs/drift-issue-log.md`; D-35..D-39 resolved (PRD-TRD review fixes). | `gateway-core` | Agentide → Section 8 |
| 10 | `rest-adapter` | REST adapter for non-MCP integrations | `gateway-core` | Agentide → Section 8 |
| 24 | `websocket-adapter` | WebSocket adapter (universal push + pull). New package `@platform/adapter-websocket` — flat `{type, ...}` 16-frame envelope (auth/subscribe/unsubscribe/invoke + auth.ok/subscribe.ok/event/invoke.result/invoke.error/invoke.partial/invoke.end/stats/error); JWT-in-first-message-after-onopen auth with mid-connection refresh + `event.connection.rotated` audit; per-token `expectedOrigins` origin binding (RFC 6125 §6.4.3 single-label `*.` wildcard, deny-by-default for browsers, Node bypass); verbatim event-bus topic subscriptions with per-pattern authz (`platform.<first>.read`); universal `invoke` (call + stream) passing the kernel token through `gateway.handleInvocation`; per-connection 1 MiB FIFO backpressure with `{type:"stats", dropped:N}` recovery; 1 MiB inbound + outbound frame cap (close 1009); 30s ping / 10s pong heartbeat (close 1011); 30s pre-auth timeout (close 1008); default ON in `createPlatform` (port 7300), CLI opts out (`adapterWs: false`). **SHIPPED 2026-08-03** — see [`packages/adapter-websocket/`](../../packages/adapter-websocket) and [`docs/features/websocket-adapter/`](features/websocket-adapter/). 30 vitest tests across the new pack + 3 wiring tests + 31/31 post-impl assertions at `packages/agentide/scripts/simulate-websocket-adapter.mjs`. Build/lint/typecheck/check-banned-types all clean. Drift review `.reports/2026-08-03-drift-final-websocket-adapter.md` — initial Minor Drift (16 items) all addressed; D-51 (validatePattern export) closed. Cross-pack follow-up: backend-runtime still does not enforce `expectedOrigins` on its browser-token path (sdk-browser-only); tracked for a future pack. Unblocks `dashboard-core` (BI[13]) + `cli-adapter` (BI[23]). | `gateway-core` | Agentide → Section 8 |
| 23 | `cli-adapter` | Rust static binary (`platform`) over the websocket adapter — reads AND writes in v1; one generic `invoke` + 5 aliases (`capabilities`/`sessions`/`plugins`/`status`/`health`); TOML config (`gateway_url`+`token`, `path:` indirection, flag > env > config > prompt); TTY-aware output + exit codes 0–5; `--watch` on aliases (NDJSON events, no reconnect); crate at `crates/cli-adapter/`, precommit via `scripts/precommit-rust.sh`. **CHARTED 2026-08-03** — wayfinder Q1–Q5 all locked (destination: Rust binary over `websocket-adapter`, the only door); feature-pipeline delivery run is unblocked now that row 24 has shipped. | `gateway-core`, `websocket-adapter` | Agentide → Section 8 |

*(CLI and WebSocket adapters slot in here too, same dependency — order between the four is
mostly a priority call, not a technical blocker.)*

## Tier 2.5 — Gateway execution destubbing

**Why this tier exists.** `gateway-core` already implements the kernel pipeline (authn → rate-limit → session check → authz → version resolve → dispatch → audit). The missing work is *not* new connectivity — adapters (#9, #10) and SDKs (#8) are the connectivity layer, and they already cover how the gateway reaches the outside world. The gap is the inverse: the gateway can authenticate a request and route it to a handler, but the two real execution paths inside `dispatch()` are still stubs.

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 8a | `gateway-plugin-dispatch` | Replace the `MANAGER_UNAVAILABLE` stub in `packages/gateway-core/src/dispatch.ts` for `owner.startsWith("plugin:")`. Add a `handleInvocation(owner, capability, input)` seam to `@platform/plugin-manager`. Wire the runtime plugin handler registry (currently absent) so that registered runtime plugins can actually serve their declared capabilities end-to-end. | `gateway-core`, `plugin-manager` | Runtime Capabilities → Runtime Registration; BI[6] plugin dispatch gap |
| 8b | `gateway-sdk-dispatch` | Replace the `SDK_UNREACHABLE` stub for `owner.startsWith("backend-sdk-")`. Promote `@platform/sdk-node`'s WebSocket connection into a first-class Backend Runtime component owned by the gateway. Define the `backend-sdk-*` owner routing so the gateway can invoke a registered SDK handler by owner prefix. | `gateway-core`, `sdk-node` | Business Capabilities; Agentide → Section 6, Phase 3 |

**Status of 8b:** SHIPPED 2026-07-30. New package `@platform/backend-runtime` (`server.ts` + `registry.ts` + `dispatch.ts` + `events.ts` + `verify.ts` + `types.ts`), integration with `gateway-core` (`backendRuntime` ctx field on `dispatch`), integration with `agentide` (`backendRuntimePort` on `CreatePlatformConfig` auto-creates + lifecycle-wires the runtime). 41 vitest files / 439 tests pass; build/lint/typecheck/check-banned-types all clean. Future pack `sdk-browser` reuses the same wire protocol.

**Status of 8a:** SHIPPED 2026-07-30. Plugin Manager gains `handleInvocation(name, input, sessionId)` + handler-loader (Node ESM `import()` of `runtime.entry`); kernel swap (`gateway-core/src/dispatch.ts:80-121`) routes `plugin:*` owners to PM + `translatePluginError` maps PM errors to `GATEWAY_*` codes per Option B; two new codes (`GATEWAY_HANDLER_NOT_FOUND`, `GATEWAY_HANDLER_ERROR`) added to public surface; `cleanupTimeoutMs` config passthrough for fast uninstall in tests. 26 tests total: 10 handler-loading + 8 dispatch (4 unit + 4 integration) + 8 e2e `gateway-plugin-dispatch.test.ts`. Post-impl sim at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs` — 8/8 PASS in 0.6s. Drift review at `/tmp/opencode/drift-bi8a-report.md` (Minor Drift, 4 accepted items D-29-D-33). Closes BI[8a] runtime dispatch gap; unblocks `browser-runtime` (Tier 4) and any other runtime plugin.

Without 8a and 8b, the kernel works but only for the 25 platform caps — runtime plugin capabilities and remote SDK capabilities are unreachable no matter how many adapters are wired. Everything in Tier 3 (adapters, SDKs) is only *genuinely* usable once 8a and 8b land.

## Tier 4 — Browser-native capability

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 11 | `sdk-browser` | Register browser capabilities, UI state, browser↔Gateway communication. Package: `@platform/sdk-browser` (Frontend SDK role — single package, no per-language variants since it's inherently browser JS/TS). **SHIPPED 2026-08-02** via feature-pipeline (GRILL T1–T7, phases 1–6, post-impl sim 10/10, 61 tests, drift clean). | `gateway-core`, `capability-registry` | Agentide → Section 6, Phase 4 |
| 12 | `browser-runtime` | Launch/close browser, tabs, navigate, click, type, screenshot — session-scoped, owns its own resources. **SHIPPED 2026-08-02** via feature-pipeline (GRILL T1–T5, PRD-TRD + IMPL, phases 1–8, post-impl sim 8/8 scenarios + demo verified, 31 tests, drift review → 9 items BR-1..BR-9 all resolved/accepted — see `docs/drift.md`). Package: `@platform/browser-runtime`. | `session-manager`, `sdk-browser`, `permission-tiering` | Runtime Capabilities → Browser Runtime example |

## Tier 5 — Visibility

| # | Topic slug | Scope | Depends on | Source doc |
|---|---|---|---|---|
| 13 | `dashboard-core` | `dashboard.view.*` read caps (thin in-process wrappers over read-tier platform caps, type platform, owner `dashboard`, permission `platform.dashboard.read`, tier read, session-less) + web dashboard UI served by the dashboard package's own static server (`dashboardPort` 7200); all data over adapter-websocket (`invoke` + `subscribe`/`event`); browser-held read-only origin-bound token (mint per page load). **Charting DONE 2026-08-03** — map + tickets D1–D5 at [`docs/wayfinder/dashboard-core/`](wayfinder/dashboard-core/map.md); all decisions locked (D1 views, D2 cap shape, D4 token, D3 UI); drift D-50 (origin-claim mint side) is in-pack work. Execution starts after adapter-websocket ships | `adapter-websocket` (the only door — Q2/Q3 locks), `platform-capabilities` | Agentide → Section 14 |
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
