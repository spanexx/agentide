# adapter-core — Wayfinder map

> **Map title:** adapter-core — finding the way to a shipped `@spanexx/adapter-core` that
> every Adapter (existing and future) stands on.
>
> **Status:** milestone reached 2026-08-07 — `@spanexx/adapter-core` SHIPPED + released
> (0.2.1) + post-release validated (22/0/2). Map dormant; remaining frontier = **A8 (MCP
> migration)** → **A9 (REST proof adapter)** for a future effort session.
> Research resolved; build frontier = A8 (MCP migration) → A9 (REST proof adapter).
> Drift review 2026-08-07: **Minor Drift — ship**; sim script + docs fixed, drifts
> D-95..D-99 logged, publish pipeline wired (16th package).
> Live tracker: this map + the child tickets under `tickets/`.

## Destination

`@spanexx/adapter-core` shipped: the shared **server-side pipeline** every Adapter stands
on — identity/scope policy, session resolution policy, invocation builder, capability
lookup, error envelope, response-strategy seam (single reply / stream packaging /
subscription). `adapter-mcp` and `adapter-websocket` server pipelines migrate onto it with
**zero behavior delta** (all existing adapter tests + both server sims green; the CLI
consumer is untouched — the wire client and W1–W6 frame envelope stay in
adapter-websocket). A third Adapter — **REST** (backlog row 10) — ships on the same
foundation as the proof consumer.

`delivery: feature-pipeline` for the REST adapter (row 10's own pack); the migration itself
resolves via this map's tickets.

## Notes

- **Domain:** AI agent platform, Adapter layer. Glossary terms apply verbatim: Adapter,
  Capability, Capability Invocation, Gateway, Session, Audit Log, Platform.
- **Locked at charting (defaults):** destination form = shipped refactor; scope = both
  server-side pipelines; behavior = strict zero-delta; proof = REST adapter in-effort.
- **Kernel contracts (exist, stable — adapter-core wraps, never rewrites):**
  `CanonicalInvocation` (`gateway-core/src/types.ts:56` — token REQUIRED, kernel
  verifies), `CanonicalResponse`, `GatewayErrorPayload` (code/message/details/retryable),
  `verifyToken` (`gateway-core/src/auth.ts:51`), `originMatches` (`@spanexx/origin`).
- **Kernel is single-shot.** Streaming today = adapter-side packaging
  (`adapter-websocket/src/invoke.ts:56` synthesizes `invoke.partial`/`invoke.end` around
  one kernel result). The response-strategy seam must anticipate future kernel streaming
  without building for it now (A4).
- **Auth timing fork (A2):** WS pre-verifies (`authenticateToken` — origin binding +
  tenant state before first invoke); MCP verifies late (kernel). adapter-core expresses
  both as a policy, not a fork in code.
- **Third duplication site (out of scope):** `backend-runtime/src/verify.ts` is a local
  copy of `verifyToken` ("Logic MUST stay in sync") — deliberate independence; merging it
  depends on the Phase 5 gateway-core↔backend-runtime dependency question. See Not yet
  specified.
- **Publish pipeline:** adapter-core becomes the 16th package — release-please-config.json,
  release.yml publish filter, `prepare-publish.sh`, no-cjs pin. Dep order:
  `errors → origin → gateway-core → adapter-core → adapters`. adapter-core may import
  gateway-core at runtime (no cycle — gateway-core depends on no adapter).
- **Convention:** local-markdown tracker (dashboard-core / websocket-adapter precedents).
  Every locked Q appends to `docs/CONTEXT.md` Decisions Log. Drift logged before doc edits
  (`docs/drift.md`).
- **Assumed shipped:** gateway-core, adapter-mcp, adapter-websocket, backend-runtime,
  sdk-node, agentide-cli-consumer, agentide-client-credentials, event-bus, errors,
  origin. Map invalidates if any reopens a settled question.
- **Cross-map deps:** websocket-adapter map closed (W1–W6 locked — envelope stays put);
  dashboard-core map closed (dashboard is a WS **wire client** — unaffected); backlog row
  10 `rest-adapter` = A9's delivery.

## Open Tickets (frontier)

| # | Ticket | Type | Blocks |
|---|---|---|---|
| — | (map frontier empty — A9 locks shipped into feature-pipeline) | — | — |

Design frontier (A1–A6) fully locked. A7 (WS server migration) shipped 2026-08-07 with
zero observable delta — gates held (core 50/50, WS 54/54 unedited, sim 37/37, full repo
1039/1039, post-impl sim 24/24 PASS, scenarios S1–S8 satisfied). A8 locked 2026-08-07
(decision-only, build runs in feature-pipeline). A9 locked 2026-08-07 (6 sub-questions
locked, build routes to feature-pipeline with pre-impl sim).

Closed: A1 (boundary), A2 (auth pipeline), A3 (session resolution), A4 (response strategy seam), A5 (error envelope), A6 (capability lookup), A7 (WS server migration), A8 (MCP migration), A9 (REST proof adapter) — see Decisions so far.

Future items beyond v1: `future.md`.

## Decisions so far

- [A9 — REST proof adapter](../tickets/A9-rest-proof-adapter.md) — locked 2026-08-07. **v1 spec:**
  (1) `POST /invoke` only — single endpoint, capability + input + sessionId? body; the adapter is a
  protocol translator (CONTEXT.md), capability names are dynamic. (2) Bearer JWT per request,
  kernel-verified — the `lazy` path the platform already does at `handle-invocation.ts:145`; no
  client-credentials grant in v1 (kernel `gateway.oauthTokenHandler` is available for adapters that
  need it, not REST); no origin binding (early-path only). (3) Verb→tier mapping = none — single verb
  POST; tiers declared on the capability record, enforced by `checkAuthz`. (4) Error body =
  `GatewayErrorPayload` verbatim (`{code, message, details, retryable}`), status mapping at the door:
  token-* → 401, scope-* → 403, session-required / invalid-request → 400, not-found set → 404,
  rate-limit → 429, runtime-* → 500. `retryable` rides in the body, not the status. (5) Discovery =
  `GET /capabilities` only (list, via `createCapabilityLookup.list`); `GET /capabilities/{name}`
  deferred — `createCapabilityLookup.describe()` is broken against the kernel (A9-R1 §14.2). Other
  surfaces stay out: `/sessions`, `/health`, `/status`, plugins, organizations, clients — all are
  session-less capabilities already reachable over `POST /invoke`. (6) Pre-impl HTML sim
  (`docs/features/rest-adapter/simulate-pre.html`) + post-impl shell sim
  (`simulate-rest-adapter.mjs`, drives a real `createRestAdapter` + `createPlatform` on port 7400,
  loopback only) per the [interconnected-simulation skill](../../../.agents/skills/interconnected-simulation/SKILL.md).
  Pack path: `docs/features/rest-adapter/`. `delivery: feature-pipeline`.
- [A8 — MCP migration plan](../tickets/A8-mcp-migration.md) — locked 2026-08-07: MCP becomes the first real `lazy` auth consumer (kernel per-call verify; closes the D-95 deferral); door keeps transport + MCP-shaped rendering + error table + OAuth routes; acceptance = unedited tests (4 files, 8 PRD scenarios) + 8/8 sim, lazy gets its own new test; five green-at-each-step commits (claims → envelope → lookup → pipeline/strategy → real lazy). `delivery: feature-pipeline`.
- [A7 — WebSocket server migration](../tickets/A7-ws-server-migration.md) — **DELIVERED**: pack shipped `0bc1046`, drift review 2026-08-07 (Minor Drift — ship), fixes in `c7d968b` + `1639f67`, released as part of v0.2.1/0.7.1 publish (PR #58), post-release validated 22/0/2 (incl. adapter-core under the hood). Zero-delta held end-to-end.

- [A7 — WS server migration](../tickets/A7-ws-server-migration.md) — `@spanexx/adapter-core` v0.1.0 ships; WS door (`auth.ts`, `invoke.ts`, `registry.ts`) delegates to core while keeping its own bytes (W1–W6 envelope, close 1008/1009/1011, `AUTH_ERROR_CODES`, `WS_ERROR_CODES`, `WS_INTERNAL` invalidFrame, 1MiB queue, fanout). **Seven shared primitives:** `readClaims`, `createAuthPolicy` (early mode), `createErrorConverter` (shared `-32006` + `${code}: ${message}` fallback + door-configurable `defaultError`), `createResponseChannel` (per-invocation, end exactly-once, emit/event only before end), generic `RecordRegistry<T>` (factory template), `createAdapterPipeline` (A1 seam: gateway + ErrorConverter + door-sink factory), `createCapabilityLookup` (A6: list/describe, scope via `readClaims(token).scope`, tier filter delegated to kernel). **Zero-edit gate held:** `__tests__/` + `client.ts` untouched; `packages/agentide/src/consumer.ts` untouched. **Gates green:** core 50/50, WS 54/54 unedited, sim 37/37, full repo 1039/1039, post-impl sim 24/24 PASS (PRD scenarios S1–S8). Source: `docs/features/adapter-core/{PRD-TRD,IMPL,simulate.sh}`. `delivery: shipped`.
- [A6 — Capability lookup](../tickets/A6-capability-lookup.md) — lean `list(token)` + `describe(name, token)` in core; NO tier logic in core (kernel `capability.list` already filters via `checkAuthz` — `factory.ts:554`); scope fed to kernel from `readClaims(token).scope`. Byte-identical migration: kernel order, verbatim fields, A5 converter, unedited MCP test suite as acceptance. `decodeScopeFromToken` → core `readClaims(token)` (A2 lock; full claims object; MCP thin alias or call-site swap; `[]` defensiveness kept). WS gains the utility but wires NOTHING new in v1 (no discovery frame; `capability.list` already works via plain invoke). Future items → `future.md`. `delivery: decision-only`.
- [A5 — Error envelope](../tickets/A5-error-envelope.md) — `GatewayErrorPayload` IS the shared envelope; adapter-core re-exports it + `ERROR_CODES` (doors import ONLY adapter-core). Converter shared, tables door-local via `errors: table` (WS passthrough = rendering policy, not table entry). Unmapped codes → shared default = MCP's existing fallback (`-32006` + `${code}: ${message}`), door-configurable; optional setup-time catalog warn. Error surface FROZEN — no WS close codes / MCP codes change under migration; existing error-path tests run with ZERO edits as acceptance (A2 freeze inherited). `delivery: decision-only`.
- [A4 — Response strategy seam](../tickets/A4-response-strategy-seam.md) — per-invocation `ResponseChannel` created by the door's strategy, driven by the pipeline; primitives `emit(chunk)` / `end(result|error)` / `event(topic,payload)` share one call id (A10 shape). Chunks are the shared intermediate; packaging (WS `invoke.partial`+`end`, MCP merge into one `CallToolResult`) stays in the door (A1 rule). `subscribe` frame = adapter-local v1, unchanged; channel `subscribe` mode = FUTURE (real capability stream, e.g. `gateway.watch`), not shipped dormant; graduates to core only with a second consumer. Backpressure = adapter-local v1 (`queue.ts` untouched; `emit` never awaited by pipeline). Kernel real streaming = additive by construction; terminal guarantees locked now (`end` exactly once, `emit` after `end` error, `event` before `end` only). `delivery: decision-only`.
- [A3 — Session resolution](../tickets/A3-session-resolution.md) — pass-through only: adapter-core never decides a session exists, no `sessionPolicy`, no auto-mint helper; session lifecycle stays a consumer concern (`withAutoSession` in CLI stays put — zero-delta; D-91 is consumer-side, not adapter-core's). No sessionId → passthrough-undefined, kernel owns the verdict via `SESSION_LESS_CAPABILITIES` (read-only discovery + `session.*` lifecycle + `auth.token.*` proceed session-less; business caps with missing session → existing `GATEWAY_*` error, unchanged). No session lifecycle events (A1 lock); keep-alive is consumer policy (`session.touch` stays a capability). `delivery: decision-only`.
- [A2 — Auth pipeline](../tickets/A2-auth-pipeline.md) — one knob `auth: { mode: "early" | "lazy" }`; early = verify once at open, identity cached for connection lifetime + optional pre-verify hook (origin binding) + pipeline `re-verify(token)` for refresh; lazy = kernel verifies per call. `decodeScopeFromToken` moves to core as `readClaims(token)` (shared with A6). Auth-failure behavior FROZEN — asserted today = frozen forever (close 1008s, auth.error text, ORIGIN_MISMATCH, MCP JSON-RPC errors, audit denied records). `delivery: decision-only`.
- [A1 — Shared package boundary](../tickets/A1-shared-package-boundary.md) — "own bytes" rule: parse/render stay in the door, everything between is shared (connection registry shared; MCP tool-card rendering stays in MCP). adapter-core imports gateway-core at runtime; doors import ONLY adapter-core (re-exports). One-call setup `createAdapterPipeline({gateway, config, input, output, errors, response})`; transport lifecycle stays with the door. adapter-core emits no events; kernel keeps observability. `delivery: decision-only`.
- [A10 — Streaming/subscription patterns survey](../tickets/A10-research-streaming-patterns.md) — response channel with a terminal: `single | stream | subscribe`, primitives `emit/end/event` sharing one call id; unary = stream of length one, so kernel streaming later is additive by construction. Backpressure/authz/replay stay adapter-local in v1.
- [A11 — Duplication inventory](../tickets/A11-research-duplication-inventory.md) — 16 duplicated files (2,222 lines: 11 WS + 5 MCP), 14 test files, 2 sims; only file-level copy is backend-runtime `verify.ts`; only unsigned-JWT duplication is `decodeScopeFromToken`; Bearer extraction is in `server.ts:44`, not translate.ts.

## Not yet specified

- **Kernel-side real streaming** (browser-runtime era): A4's seam should anticipate it;
  how the seam extends is not sharp enough to ticket yet.
- **backend-runtime's local verifyToken copy**: merging into shared code depends on the
  Phase 5 dependency question — revisit after that resolves.
- **Wire client (`createWsClient`) eventual home**: CLI consumer path; out of scope now,
  revisit after the server-side migration lands.
- **sdk-browser / backend-runtime doors as future adapter-core consumers** (they share
  auth/session glue too).
- **Rate limiting per adapter**: none today (kernel `rate-limit.ts` covers token mint) —
  whether adapters gain limits is undecided.

## Out of scope

- **Wire envelope redesign** (W1–W6 frames) — locked in the websocket-adapter map;
  adapter-websocket keeps it.
- **CLI consumer (`agentide/src/consumer.ts`) behavior** — untouched by this effort.
- **Dashboard** — a WS wire client; no changes.
- **Kernel streaming support** — single-shot stays for now.
- **Merging backend-runtime's verify copy** — see Not yet specified.
