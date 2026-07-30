# Manifest and handler transport in browser

**Type:** `wayfinder:grilling` (HITL)
**Status:** ✅ closed 2026-07-30
**Blocks:** Frontend developer experience (T4)
**GitHub:** <https://github.com/spanexx/agentide/issues/9>

## Question

How does `@platform/sdk-browser` get its manifest and resolve capability
handlers, given that a browser has no filesystem?

`@platform/sdk-node` resolves the manifest by reading a YAML file from disk
and the handlers by dynamic `import()` of a Node ESM module. Both paths
break in a browser. Locking the browser equivalents shapes T4 (dev
experience) and T6 (package shape).

## What I know

- Browser has no `node:fs/promises`. Anything path-shaped has to become URL-
  shaped or in-memory.
- Modern browsers support `import()` natively (ESM dynamic import). It works
  with public URLs and with same-origin bundles; cross-origin requires CORS
  headers and a Content-Type of `application/javascript`.
- Bundlers (Vite, esbuild, webpack, Rollup) emit `import()` URLs that resolve
  to chunk files. A npm-installed SDK that exposes `import()` paths usually
  lands inside a Vite/Rollup chunk graph.
- A `<script>` tag install path can't `import()` (no module system); it can
  load IIFE/UMD and read a global. This is the cross-cut with T4.

## What I don't know (originally)

- Whether the SDK should ship its own bundler config (e.g. a Vite plugin that
  rewrites the manifest path during build) or stay bundler-agnostic and let
  the consumer bundle.
- Whether handlers are required to be ESM modules or if a simple
  `Record<name, Handler>` map passed at install time is enough.
- How to surface handler *loading failures* with a clear error in a browser
  context (no `Cannot find module` from fs).
- Whether the manifest contains the cap inventory or whether T1's DOM-annotation
  model replaces the manifest entirely. (T1 closed with DOM-annotation; T2's
  scope may shrink.)

## Resolution

T2 closed 2026-07-30. All 5 sub-questions locked. Full record in
`docs/features/sdk-browser/GRILL-sdk-browser.txt` and on GitHub issue #9
(resolution comment).

**Q1 (manifest source / cap inventory model):** No capability manifest file.
SDK `init` takes `{ gateway, appId, token, observeRoot?, defaultTier?,
defaultVersion? }`; cap inventory comes entirely from `MutationObserver`
walking `data-sdk-cap` attributes. Closes ticket sub-questions 1-3 (manifest
source, handler source, validation) as moot.

**Q2 (attribute set):** SDK reads only `data-sdk-cap` from each annotated
element. Tier and version come from config-level defaults applied SDK-wide
(`defaultTier: 'act'`, `defaultVersion: '1.0.0'`). No per-element overrides
in v1.

**Q3 (observe scope):** Initial scan of `observeRoot` on `createSdk()` (picks
up pre-mounted annotated elements) + `MutationObserver(subtree: true,
childList: true, attributes: true, attributeFilter: ['data-sdk-cap'])`.
Default `observeRoot = document.body`, overridable via config. v1 does NOT
pierce shadow DOM (devs attach their own observer per root and forward via
`sdk.observe(rootElement)`) and does NOT pierce iframes.

**Q4 (dedup):** Deduplicate. Register one cap per name. SDK internally tracks
the count of annotated elements per cap. Register on 0→1 transition (first
element enters DOM), unregister on 1→0 transition (last element leaves).

**Q5 (dispatch target):** Fan-out by default. SDK dispatches a CustomEvent on
every annotated element with that cap name. Each listener receives the same
`detail: { input, ctx }` and filters by input match (dev pattern: single
delegated listener on `document` using `e.target.closest('[data-sdk-cap="..."]')`).

**Rules out for v1:** N copies of same cap with disambiguating suffixes;
`data-sdk-tier` / `data-sdk-version` / `data-sdk-input` / `data-sdk-target`
per-element attributes; `data-sdk-primary` marker; SDK picking one element on
dispatch; dev-supplied dispatch handler at registration time; automatic
shadow DOM piercing; iframe content observation.

**Sources:** T1 lock at `docs/CONTEXT.md`; WHATWG DOM Living Standard
(`MutationObserver` + `CustomEvent` semantics); Q2 / Q3 / Q4 / Q5 each cite
one another; sdk-node's `manifest.ts` shape at
`packages/sdk-node/src/manifest.ts` is the parallel we're choosing not to
mirror.

**Verification:** implementation lands in `packages/sdk-browser/` during
`delivery: feature-pipeline`; T4 (Frontend developer experience) confirms the
fan-out listener pattern works for at least one concrete example page.

## E-commerce analogy (used through the grill)

| Concept | Analogy |
|---|---|
| Capability | A dish on the menu (e.g., "add to cart") |
| Annotated element | The "Add to Cart" button on each product card |
| Gateway | The cart service |
| Customer / SDK caller | The customer invoking an action via the platform |
| Many buttons, one cap | 50 "Add to Cart" buttons, one `add_to_cart` cap registered |
| Cap inventory = DOM | The buffet table — the dishes are already laid out |
| No manifest | No separate chalkboard menu — the table IS the menu |
