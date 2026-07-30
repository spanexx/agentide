# sdk-browser — Wayfinder map

> **Map title:** sdk-browser — finding the way to a shipped `@platform/sdk-browser`.
>
> **Status:** charting complete (2/7 tickets closed, 5 open). Live tracker: this issue + the 7 child ticket issues.

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
| 3 | Browser-aware reconnect and lifecycle | `grilling` | (run) |
| 4 | Frontend developer experience | `prototype` | — |
| 5 | WebSocket transport details | `grilling` | T3 |
| 6 | Package shape and dependencies | `grilling` | (run) |
| 7 | sdk-browser and browser-runtime boundary doc | `task` | — |

**Worked sequence** (when no parallel sessions are running):
~~T1~~ → ~~T2~~ → (T5) → (T4, T3 in parallel) → T6 → T7 →
`delivery: feature-pipeline`.

**Frontier this turn:** T5 only (T1 and T2 closed; T5 unblocked and ready to claim).

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

## Not yet specified

Fog I can tell is coming but can't ticket yet:

- **Failure modes on tab unload** — same HANDLER_TIMEOUT / SDK_UNREACHABLE mapping
  as sdk-node, but tab-unload-specific edge cases (cancel all pending?
  suppress reconnect on intentional close?) graduate once T3 closes.
- **Bundle vs ESM-only build** — depends on T4 outcome; if a `<script>` tag install
  path ships, a pre-bundled UMD/IIFE build becomes a real ticket.
- **Service Worker considerations** — persistent WebSocket across navigations and
  push-style capability calls. Out of scope for v1 likely, but worth re-flagging
  if either T1 or T4 expands.
- **Capability deprecation flow** — sdk-node v4.2 in `sdk-node/future.md`. Almost
  certainly applies to sdk-browser too; cross-ticket with sdk-node's v4.2 work.
- **Window/tab boundedness** — one SDK instance per tab? per session within a tab?
  What if multiple tabs register from the same app? Per-tab tokens vs shared.
  Specifiable, but I want T1 first to see if "UI state" / multi-tab are separate
  concerns or one.
- **CORS config templates** — once T5 locks transport, infra has to play along.
  Self-hosted operators configure the WebSocket adapter to allow cross-origin.
  Cross-ticket with future WebSocket-adapter pack; not a blocker for v1.

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
