# Frontend developer experience

**Type:** `wayfinder:prototype` (HITL)
**Status:** closed (D1 + D2 locked 2026-08-01; D3 locked 2026-08-02)
**Blocks:** — (the prototype, once approved, becomes part of the IMPL phases
not a successor ticket).

## Question

What does the day-zero developer experience look like for someone adopting
`@platform/sdk-browser`?

The user wants a *concrete artifact* to react to before locking the
dev-experience shape. Build a rough prototype, link it as an asset, iterate.

## What I know

- `sdk-node`'s install is `npm install @platform/sdk-node` + a config object
  + `await sdk.connect()`. Works fine in Node land.
- Browser apps can install npm packages, but the majority of web apps ship
  through a bundler (Vite/webpack/Rollup) or a CDN-hosted `<script>` tag.
- A `<script>` tag install path needs an IIFE/UMD build (no `import` in
  classical browser context).
- Bundlers can rewrite `import("@platform/sdk-browser/manifest")` into
  chunked URLs that work in development and production.

## What I don't know

- Whether the canonical install is `npm install` (the modern expectation)
  or `<script>` (the broadest reach). Both is possible but doubles packaging.
- Whether framework-native helpers ship in v1 (`useSdk()` for React,
  composable for Vue, store for Svelte) or stay out until a customer asks.
- How to surface the connection state to UI ("connecting", "reconnecting",
  "disconnected") without forcing the consumer to subscribe to all 8 events.

## What the prototype should produce

- Two rough HTML pages with different shapes (toggleable from one route):
  - **Shape A:** Vite-style import — `import { createSdk } from '@platform/sdk-browser'`,
    config object, `await sdk.connect()`. Lifecycle visible in the DOM.
  - **Shape B:** `<script src="...sdk-browser.iife.js"></script>` + global
    `PlatformSdk.createSdk({...})`. Same lifecycle in the DOM.
- A short README comparing the two paths and asking one question: *which one
  becomes the canonical v1 install?*

## Resolution must record

- a link to the prototype artifact (under `prototypes/sdk-browser-dev-experience/`
  or similar);
- the chosen install path (or both);
- whether framework-native helpers ship in v1 or punt;
- a verification note pointing to the chosen shape's implementation file.

## Locked so far

- **D1 (2026-08-01):** canonical v1 install = **Shape A (bundler import,
  ESM)** — `npm install @platform/sdk-browser` + `import { createSdk }
  from '@platform/sdk-browser'`. `<script>` tag / IIFE deferred to a v1.1
  follow-up ticket (trigger: real no-bundler consumer). Resolves T6 Q1 →
  ESM-only, no `browser` field in v1.
  - Artifact: `prototypes/sdk-browser-dev-experience/` (index.html,
    shape-a.html, shape-b.html, README.md). Verification:
    `tests/t4.spec.cjs` — shape-a lifecycle test passes (Playwright CLI,
    4/4). Chosen shape's implementation file: `shape-a.html` (import map
    resolves `@platform/sdk-browser` → `sdk-browser.esm.js` → shared
    `sdk-core.js`).
- **D2 (framework helpers):** locked 2026-08-01 — none in v1; punt to
  v2 (trigger: first framework team asks).
- **D3 (connection-state surface):** locked 2026-08-02 — `sdk.onStateChange(cb)`
  (4 states: `connecting | connected | reconnecting | disconnected`, callback
  fires only on real transitions) + `sdk.state().connectionState` sync getter
  for render-on-load. The 8 lifecycle events stay for tooling/logging; the
  callback is the UI-facing surface, not an event-bus subscription. v1 API
  adds exactly one function + one field on the existing `state()` getter.
  Rules out: (B) fold into the 8 events only — every UI consumer would have
  to derive state across events (one missed event = wrong badge); (C) an
  additional unified `sdk.state` event on the event-bus — internal surface,
  zero named consumers. sdk-node parity: `state().phase` exists but has no
  callback and no `reconnecting` state (servers vs UIs).

## Resolution (2026-08-02)

All three decisions locked — ticket closed.

- Prototype artifact (link): `prototypes/sdk-browser-dev-experience/`
  (README.md, index.html, shape-a.html, shape-b.html, sdk-core.js,
  demo-doc.js, tests/t4.spec.cjs). Playwright CLI check 4/4.
- Chosen install path: **Shape A (bundler import, ESM)** — D1.
- Framework-native helpers: **none in v1** — D2 (punt to v2, named trigger).
- Connection-state surface: **`sdk.onStateChange(cb)` + `sdk.state().connectionState`** — D3.
- Verification: D3 pattern exercised by both shape pages' lifecycle badges
  (`sdk-core.js` `setConnState` → `stateCbs`), covered by the 4/4 Playwright
  run and the interconnected sim (`sim-state.json` footer on both pages).
- Delivery tag: `delivery: feature-pipeline` — route fires after T7
  (sdk-browser and browser-runtime boundary doc) closes; T7 is the last
  open ticket on the map.
