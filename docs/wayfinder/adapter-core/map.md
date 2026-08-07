# adapter-core — Wayfinder map

> **Map title:** adapter-core — finding the way to a shipped `@spanexx/adapter-core` that
> every Adapter (existing and future) stands on.
>
> **Status:** charting 2026-08-07 (destination locked via grill — defaults accepted).
> Research tickets fired; frontier ticketed below.
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
| A1 | Shared package boundary | grilling (HITL) | A2–A9 |
| A10 | Streaming/subscription patterns survey | research (AFK) | A4 |
| A11 | Duplication inventory | research (AFK) | — |

Blocked elsewhere: A2, A3, A4, A5, A6 (by A1); A4 (by A10); A7, A8 (by A1 + A2–A6); A9
(by A1).

## Decisions so far

<!-- one line per closed ticket: title — gist of the answer -->

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
