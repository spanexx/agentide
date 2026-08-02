# sdk-browser — Wayfinder map

> **Map title:** sdk-browser — finding the way to a shipped `@platform/sdk-browser`.
>
> **Status:** charting complete (5/7 tickets closed, 2 open). Live tracker: this issue + the 7 child ticket issues.

## Destination

`@platform/sdk-browser` shipped as a v1 Frontend SDK. The package lives in
`packages/sdk-browser/`, tests pass, and the canonical feature-pipeline sim
demonstrates the contract end-to-end. Per Wayfinder's planning-not-doing default,
tickets resolve decisions; the build itself happens via `delivery: feature-pipeline`
once the way is clear. No override — this map does not carry execution.

## Notes

- **Domain:** AI agent platform. A web-app developer installs `@platform/sdk-browser`
  to expose business capabilities from a browser. The same wire protocol a Node
  app uses with `@platform/sdk-node` carries the traffic.
- **Reuse from sdk-node (`@platform/sdk-node`, BI[8], shipped):** wire-protocol
  shape (8 lifecycle events), public API surface (`createSdk`/`connect`/`register`/
  `invoke`/`disconnect`/`reset`/`state`), JWT auth handshake, reconnect-with-jitter
  pattern, async `register()` surfacing Gateway rejection via `sdk.capability.rejected`.
- **Reuse from backend-runtime (`@platform/backend-runtime`, BI[8b], shipped):** wire
  messages (`sdk.invoke`/`sdk.invoke.result`/`sdk.invoke.error`), error-mapping
  matrix (HANDLER_NOT_FOUND → GATEWAY_CAPABILITY_NOT_FOUND, etc.), `BackendValue`
  recursive type for typed payloads.
- **Out of scope this map:** `browser-runtime` (#12), Service plugins for browsers,
  Chrome DevTools (#14), `plugin-marketplace-core` (#16) listing of sdk-browser.
- **Standing preferences:** Wayfinder default mode (plan, don't do). Self-hosted
  Gateway assumed for v1. No special browser-runtime, no marketplace, no
  multi-language SDKs.
- **Assumed already shipped:** `gateway-core`, `capability-registry`, `event-bus`,
  `session-manager`, `plugin-manager`, `platform-capabilities`, `permission-tiering`,
  `sdk-node`, `backend-runtime`, `gateway-plugin-dispatch`. Map invalidates if any
  of these reopens a settled question that affects the choice below.
- **Truthfulness:** if a ticket resolution contradicts another open ticket or a
  decision already settled, update *the map and the affected tickets*, not just
  the answer. Drift logs go in `docs/drift.md` per the project standard.
- **Standing grill rule:** every locked Q appends to `docs/CONTEXT.md` Decisions
  Log + posts a progress comment on the ticket. Plain-English analogy for sdk-browser
  is an e-commerce website (product cards = caps, "Add to Cart" buttons = annotated
  elements, cart service = Gateway, customer = SDK caller).

## Open Tickets (frontier)

Refer by ticket name; the GitHub issue number rides inside the name.

| # | Ticket | Type | Blocks |
|---|---|---|---|
| 1 | Capability surface and UI state | `grilling` ✅ closed | (—) |
| 2 | Manifest and handler transport in browser | `grilling` ✅ closed | T4 |
| 3 | Browser-aware reconnect and lifecycle | `grilling` ✅ closed | — |
| 4 | Frontend developer experience | `prototype` | (run) |
| 5 | WebSocket transport details | `grilling` ✅ closed | T3 |
| 6 | Package shape and dependencies | `grilling` ✅ closed | (run) |
| 7 | sdk-browser and browser-runtime boundary doc | `task` | — |

**Worked sequence** (when no parallel sessions are running):
~~T1~~ → ~~T2~~ → ~~T5~~ → ~~T3~~ → ~~T6~~ → (T4 prototype) → T7 →
`delivery: feature-pipeline`.

**Frontier this turn:** T4 (prototype — different shape: artifact-based
not grilling) and T7 (task). T6 closed 2026-08-01; its Q1 (build output)
reopens when the T4 prototype picks an install path.

## Decisions so far

- [**Capability surface and UI state**](tickets/capability-surface-and-ui-state.md) (T1, closed 2026-07-30) —
  capability surface is browser-automation via DOM annotation; "UI state" is the
  live, dev-controlled catalog scoped to the current page; metadata inline as
  `data-sdk-*` attributes (option A); `MutationObserver`-driven continuous
  introspection; DOM-event dispatch on invocation with form-fill fallback for
  `<form>` elements.

- [**Manifest and handler transport in browser**](tickets/manifest-and-handler-transport-in-browser.md)
  (T2, closed 2026-07-30) — no capability manifest file; SDK `init` takes
  `{ gateway, appId, token, observeRoot?, defaultTier?, defaultVersion? }`;
  cap inventory from `MutationObserver` walking `data-sdk-cap` only. Observation
  = initial scan of `observeRoot` on `createSdk()` plus `MutationObserver(subtree,
  childList, attributes, attributeFilter=[data-sdk-cap])`. Default `observeRoot
  = document.body`; v1 does NOT pierce shadow DOM (devs attach their own observer
  per root and forward via `sdk.observe(rootElement)`) and does NOT pierce
  iframes. Dedup by cap name (register on 0→1, unregister on 1→0). Dispatch is
  fan-out CustomEvent on every annotated element; dev's listener filters by
  input match (delegated listener on `document` with `e.target.closest()`).

- [**WebSocket transport details**](tickets/websocket-transport-details.md)
  (T5, closed 2026-07-30) — auth transport = first-message body
  `{ type: "sdk.auth", token }` after `onopen`, identical to sdk-node (the
  server's `isAuthMessage` only inspects the body anyway — sdk-node's
  `Authorization` header is silently dropped). **Permanent origin binding:**
  every browser SDK token MUST carry a signed `expectedOrigins: string | string[]`
  JWT claim; `backend-runtime` reads the claim after `verifyToken` succeeds and
  closes with code 1008 on mismatch (with `*.subdomain` wildcard support);
  mandatory, no opt-out. JWT forwarding to handlers = verbatim via
  `e.detail.ctx.token`, mirroring sdk-node. Transport = `globalThis.WebSocket`
  only, no polyfill, no fallback (every browser since 2011 has it; `ws` is
  Node-only and would not work in browsers).

- [**Browser-aware reconnect and lifecycle**](tickets/browser-aware-reconnect-and-lifecycle.md)
  (T3, closed 2026-07-30) — **Visibility:** pause reconnect while tab is
  hidden; resume immediately on `visibilitychange` to "visible". Same
  backoff curve as sdk-node, gated on visibility. **Online/Offline:** mark
  socket dead on `offline` (clear pending reconnect timer); on `online` reset
  backoff and fire reconnect immediately (skip the stale backoff schedule).
  **Page unload:** best-effort `sdk.disconnect` on `pagehide` then
  `WebSocket.close(1000, "pagehide")`; bfcache-aware — skip on
  `event.persisted`. **Heartbeat:** server-initiated protocol-level ping
  every 30s from `backend-runtime`; browser auto-pongs; 10s pong timeout →
  close with code 1011. **Zero browser SDK code change for heartbeat** —
  the protocol layer handles it; the SDK's existing close handler triggers
  the existing reconnect.

- [**Package shape and dependencies**](tickets/package-shape-and-dependencies.md)
  (T6, closed 2026-08-01) — **Build output (Q1): HELD** pending T4
  prototype; IIFE becomes a follow-up ticket only if T4 picks `<script>`
  tag install, otherwise ESM-only stands. **exports (Q2):** `"type":
  "module"`, `import` condition only, no `require`; `browser` field rides
  on Q1. **Dependencies (Q3):** one runtime dep (`@platform/event-bus`),
  type-only `backend-runtime` ref for `BackendValue`, jsdom dev-dep, no
  `@types/node`/`@types/ws`; tsconfig adds DOM lib. **Test runner (Q4):**
  vitest + jsdom per-file docblock, WebSocket stubbed in transport tests,
  root config untouched. **Size budget (Q5):** no hard cap; soft guideline
  (one runtime dep, ESM-only). Full record in the GRILL + CONTEXT.md
  Decisions Log.

- [**Frontend developer experience**](tickets/frontend-developer-experience.md)
  (T4, prototype) — **D1 locked 2026-08-01:** canonical v1 install =
  Shape A (bundler import, ESM); IIFE/CDN deferred to v1.1 follow-up
  ticket (trigger: real no-bundler consumer). Resolves T6 Q1 → ESM-only,
  no `browser` field in v1. Prototype artifact:
  `prototypes/sdk-browser-dev-experience/` (Playwright-verified 4/4).
  **D2 locked 2026-08-01:** no framework helpers in v1 (punt to v2;
  trigger = first framework team asks). D3 (connection-state surface)
  pending.

## Not yet specified

Fog I can tell is coming but can't ticket yet:

- **Bundle vs ESM-only build** — RESOLVED 2026-08-01 (T4 D1): ESM-only
  for v1 (Shape A canonical install). IIFE/CDN path is a v1.1 follow-up
  ticket, trigger = a real no-bundler consumer.
- **Service Worker considerations** — persistent WebSocket across navigations and
  push-style capability calls. Out of scope for v1 likely, but worth re-flagging
  if either T1 or T4 expands.
- **Capability deprecation flow** — sdk-node v4.2 in `sdk-node/future.md`. Almost
  certainly applies to sdk-browser too; cross-ticket with sdk-node's v4.2 work.
- **Window/tab boundedness** — one SDK instance per tab? per session within a tab?
  What if multiple tabs register from the same app? Per-tab tokens vs shared.
  Specifiable, but I want T1 first to see if "UI state" / multi-tab are separate
  concerns or one. *(T5 Q2 closed the cross-origin replay concern via token-bound
  `expectedOrigins`. This is a different concern — about tab-boundedness, not
  origin-boundedness. Still open.)*

## Out of scope

- `browser-runtime` (#12) — Runtime Plugin that controls browser instances.
  Separate map. Closes the *consume* side of the Browser capability namespace.
- Service plugins for browsers (analytics, debugger) — separate maps.
- Chrome DevTools extension (#14) — depends on `dashboard-core`; separate map.
- Marketplace listing (`plugin-marketplace-core`, #16) — depends on the
  marketplace pack landing.
- Multi-language implementations of sdk-browser — by `docs/CONTEXT.md`,
  Frontend SDK is browser JS/TS only; no Python/Go variants.

## References

- GitHub map: <https://github.com/spanexx/agentide/issues/8> (source of truth).
- `docs/Feature_Backlog.md` Tier 4, #11 — sdk-browser row (now points here).
- `docs/architecture/Agentide.md` §6 (SDK roles, Phase 4 Frontend SDK).
- `docs/architecture/Runtime_Capabilities.md` (browser capability namespace
  belongs to browser-runtime, not sdk-browser — see T7).
- `docs/CONTEXT.md` SDK naming convention row: `Frontend | Browser only |
  @platform/sdk-browser — no per-language variants`.
- `docs/features/sdk-browser/GRILL-sdk-browser.txt` — running grill record
  (T2 fully resolved; T3/T4/T5/T6/T7 to add more questions).
- `docs/features/sdk-node/PRD-TRD-sdk-node.md` — the shape to mirror.
- `packages/sdk-node/src/*` — the implementation to mirror (transport apart).
- `packages/backend-runtime/src/types.ts` — `BackendValue`, `WebSocketLike`
  contracts.
- `docs/drift.md` — append new drift entries here when a ticket resolution
  shifts the documented intent.
