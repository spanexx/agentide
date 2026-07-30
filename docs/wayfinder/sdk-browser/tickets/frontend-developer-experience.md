# Frontend developer experience

**Type:** `wayfinder:prototype` (HITL)
**Status:** open
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
