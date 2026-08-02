# PRD-TRD: SDK Browser

**Slug:** sdk-browser
**Status:** Draft
**Date:** 2026-08-02

## Why This Exists

Web apps today have no first-class way to expose their on-page actions to the Agentide platform. A dev who wants a shop page to offer "add to cart" or "leave a note" as invocable capabilities must hand-build a WebSocket client, duplicate auth logic, and maintain a manifest that drifts from the real page. Every page rewrite silently breaks the integration because nothing ties the declared capabilities to the DOM that actually renders them.

The browser SDK closes that gap with a different idea than the Node SDK: **the DOM is the manifest**. A developer annotates elements with `data-sdk-cap="<name>"`; `createSdk()` scans the page, observes it for changes, and registers each unique capability with the Gateway. No config file, no drift — the page and the capability list can't disagree. Invocations fan out as DOM `CustomEvent`s on the annotated elements, so the dev handles them with a plain `closest()` filter they already know.

Cost of not building it: every browser integration is bespoke, unobservable, and breaks silently on page changes. The platform's SDK story stays half-finished (Node only), and the browser-runtime (#12) has no client to talk to.

## Behavioral Spec

### Scenario 1: Initial scan registers existing annotations

**Given** a page with three elements `data-sdk-cap="shop.cart.add"` and one each of `shop.cart.view` and `profile.note`
**When** the dev calls `createSdk({ gateway, appId, token })` and the socket connects
**Then** exactly three capabilities are registered (dedup — `shop.cart.add` once, count=3) and `sdk.connected` plus three `sdk.capability.registered` events fire

### Scenario 2: Observer picks up DOM changes (0→1 register, 1→0 unregister)

**Given** an SDK observing `document.body`
**When** the dev adds a new element with `data-sdk-cap="shop.checkout"` (count 0→1)
**Then** `shop.checkout` registers while connected
**When** the last annotated element is removed (count 1→0)
**Then** `sdk.capability.unregistered` fires and the capability leaves the inventory

### Scenario 3: Invoke fans out as a CustomEvent on every annotated element

**Given** three elements annotated `shop.cart.add` and the socket connected
**When** the Gateway sends `sdk.invoke { capability: "shop.cart.add", input: { productId: 202, qty: 2 } }`
**Then** the SDK dispatches `CustomEvent("sdk:cap:shop.cart.add", { detail: { input, ctx: { token } } })` on **each** of the three elements; a dev listener filters with `e.target.closest('[data-sdk-cap=...]')` and matches only the pid-202 card; `sdk.invoke.started` and `sdk.invoke.completed` fire

### Scenario 4: Form-fill fallback

**Given** an annotated `<input>` element (`profile.note`) and no dev listener calling `preventDefault()`
**When** the Gateway sends `sdk.invoke` for it
**Then** the SDK writes `input.text` into the field (fallback); if a dev listener calls `preventDefault()`, the SDK does nothing

### Scenario 5: Auth is the first message, origin is bound to the token

**Given** a valid JWT carrying the signed `expectedOrigins` claim
**When** the socket opens
**Then** the first message sent is `{ type: "sdk.auth", token }` (no Authorization header); the Gateway verifies the origin against the claim; on mismatch it closes with code 1008 and the SDK goes `disconnected` with no reconnect

### Scenario 6: Transport is globalThis.WebSocket only

**Given** an environment without `globalThis.WebSocket`
**When** the dev calls `createSdk()`
**Then** the SDK throws — no polyfill is loaded

### Scenario 7: Visibility gates reconnects

**Given** the socket dropped and a reconnect is pending
**When** the tab becomes hidden
**Then** the reconnect pauses (timer cancelled)
**When** the tab becomes visible again
**Then** the reconnect fires immediately (no extra backoff wait)

### Scenario 8: Offline/online lifecycle

**Given** a connected socket
**When** the browser goes offline
**Then** the SDK marks the socket dead, clears the reconnect timer, state → `disconnected`
**When** the browser comes back online
**Then** backoff resets and reconnect fires immediately

### Scenario 9: pagehide and bfcache

**Given** a connected socket and the user navigating away
**When** `pagehide` fires with `event.persisted = false`
**Then** best-effort `sdk.disconnect()` + `close(1000, "pagehide")`
**When** `event.persisted = true` (bfcache)
**Then** nothing is torn down

### Scenario 10: onStateChange — 4 states, real transitions only

**Given** a connected SDK
**When** the connection state changes (`connecting → connected → reconnecting → disconnected`)
**Then** `sdk.onStateChange(cb)` fires only on real transitions with the new state; `sdk.state().connectionState` returns it synchronously

## Simulation Contract

Post-impl sim must drive the real `@platform/sdk-browser` package in a browser and demonstrate:

```bash
connect
# → wire: { type: "sdk.auth", token } first; caps registered; sdk.connected
invoke shop.cart.add {"productId":202,"qty":2}
# → sdk:cap:shop.cart.add on 3 elements; dev filter matches pid=202; inv.completed
invoke profile.note {"text":"hi"}
# → form-fill fallback wrote "hi" into the input
drop
# → reconnecting (backoff 1s…30s ±20% jitter); onStateChange fires
hide-tab / show-tab
# → reconnect pauses hidden; fires immediately on visible
offline / online
# → socket dead; online resets backoff + immediate reconnect
pagehide persisted
# → bfcache skip, no teardown
token-origin https://evil.com
# → close 1008, disconnected, no zombie reconnect
remove-cap shop.cart.add (×3)
# → 1→0 unregister on last removal
disconnect
# → deliberate teardown, no reconnect
```

## Technical Design

### Data Models

```ts
interface SdkOptions {
  gateway: string;                    // ws(s):// URL
  appId: string;
  token: string;                      // JWT with signed expectedOrigins claim
  observeRoot?: Element;              // default document.body
  defaultTier?: string;               // default "act"
  defaultVersion?: string;            // default "1.0.0"
}
interface CapabilityView { name: string; tier: string; version: string; count: number; registered: boolean; }
```

### API Contracts

- `createSdk(opts) → Sdk` — throws if `globalThis.WebSocket` missing
- `sdk.observe(rootEl)` — extra observe roots; no shadow DOM/iframe piercing
- `sdk.invoke(name, input)` — programmatic invoke
- `sdk.onStateChange(cb)` — `connecting | connected | reconnecting | disconnected`; `sdk.state().connectionState` sync getter
- 8 lifecycle events via `@platform/event-bus` (sdk-node parity): `sdk.connected`, `sdk.disconnected`, `sdk.capability.{registered,unregistered,rejected}`, `sdk.invoke.{started,completed,failed}`
- DOM dispatch: `CustomEvent("sdk:cap:<name>", { detail: { input, ctx: { token } } })` on every annotated element; dev calls `preventDefault()` to stop the form-fill fallback
- Wire messages: `sdk.invoke` / `sdk.invoke.result` / `sdk.invoke.error`; auth = first message `{ type: "sdk.auth", token }`
- Reconnect: 1s, 2s, 4s, 8s, 16s, 30s cap, ±20% jitter
- Heartbeat: server-initiated only (backend-runtime 30s ping, 10s pong timeout → close 1011) — **zero SDK code**

### Dependencies

**Runtime**

- `@platform/event-bus` (workspace:*) — sole runtime dep; same as sdk-node. Internal workspace package (no opensrc fetch — no external source).

**Type-only**

- `@platform/backend-runtime` — type-only import for `BackendValue`; not a runtime dep, erased at compile.

**Dev (opensrc findings — source fetched from GitHub tags)**

- `vitest@^4.1.10` — MIT, actively maintained (vitest-dev/vitest, tag 4.1.10 fetched; already the repo's test runner). Alternatives considered: jest+jsdom (heavier config, slower), node:test (no jsdom ergonomics, no per-file env switching). Stay with vitest — matches sdk-node and every sibling package.
- `jsdom@^30.0.1` — MIT, actively maintained (jsdom/jsdom, tag 30.0.1 fetched; provides the DOM env for observer/dispatch tests). Alternatives: happy-dom (lighter but weaker MutationObserver/CustomEvent fidelity — exactly what this SDK relies on). jsdom chosen deliberately for standards fidelity.
- No `@types/node`, no `@types/ws`, no `ws` — browser runtime only (GRILL T6 lock).

### Architecture Notes

- ESM-only package (`"type":"module"`, exports with `import` condition only, no IIFE, no `browser` field)
- tsconfig adds `"lib": ["ES2022","DOM","DOM.Iterable"]`; no `@types/node` / `@types/ws`
- Observation: initial scan on `createSdk()` + `MutationObserver({ subtree, childList, attributes, attributeFilter: ['data-sdk-cap'] })`
- Dedup: register 0→1, unregister 1→0 (count-based)
- Registration only while connected; caps tracked pre-connect, registered on connect
- Origin binding verified by backend-runtime after `verifyToken`; mismatch → close 1008 (PERMANENT decision)
- No framework helpers in v1; no shadow DOM piercing (devs call `sdk.observe(root)`)

## Non-Goals

- No shadow DOM / iframe piercing in v1 (devs call `sdk.observe()`)
- No WebSocket polyfill (throw instead)
- No browser `*` automation caps — those belong to browser-runtime (#12)
- No manifest file — DOM annotations only
- No heartbeat logic in the SDK (server-owned)
- No framework helpers (React/Vue bindings)

## Out of Scope (Future)

- Framework helper packages (React/Vue) — after core stabilizes
- Shadow DOM piercing — revisit with browser-runtime
- IIFE/UMD build for CDN script tags — revisit if install UX demands it

## References

- `GRILL-sdk-browser.txt` — locked decisions T1–T7
- `CONTEXT.md` — glossary (tier `act`, version `1.0.0` defaults)
- `PRD-TRD-sdk-node.md` — parity reference (8 events, backoff, wire messages)
- `simulate-pre.html` — pre-impl simulation (design-time, stubbed)
