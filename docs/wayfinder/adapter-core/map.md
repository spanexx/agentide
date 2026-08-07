# adapter-core — Wayfinder map

> **Map title:** adapter-core — finding the way to a shipped `@spanexx/adapter-core` that
> every Adapter (existing and future) stands on.
>
> **Status:** charting 2026-08-07 (destination locked via grill — defaults accepted).
> Research resolved; frontier = A1.
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
| A2 | Auth pipeline: verify-early vs verify-late | grilling (HITL) | A7, A8 |
| A3 | Session resolution: passthrough vs auto-mint | grilling (HITL) | A7, A8 |
| A4 | Response strategy seam | grilling (HITL) | A7, A8 |
| A5 | Error envelope | grilling (HITL) | A7, A8 |
| A6 | Capability lookup | grilling (HITL) | A7, A8 |

Closed: A10, A11 (research), A1 (boundary) — see Decisions so far.

Blocked: A4 (by A10 — resolved, now unblocked); A7, A8 (by A2–A6); A9 (by A1 — now
unblocked).

## Decisions so far

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
