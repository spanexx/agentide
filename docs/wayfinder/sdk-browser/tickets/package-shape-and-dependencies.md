# Package shape and dependencies

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** the feature-pipeline run.

## Question

What does the `@platform/sdk-browser` package look like at the manifest,
build, and dependency level — and where does it diverge from sdk-node?

## What I know

- sdk-node ships as an ESM-only Node package (`packages/sdk-node/package.json`
  `"type": "module"`).
- sdk-node depends on workspace `@platform/event-bus`, `yaml`, and external
  `ws`. Browser SDK can't use `ws` (uses native `WebSocket`) and can't read
  YAML from disk.
- sdk-node `handler-loader.ts` does Node ESM `import()`. Browser has
  native `import()`; same shape works (subject to bundler + CORS).
- The project uses TypeScript, vitest, ESLint flat config. Browser SDK
  would use the same lint/test config but vitest must run in jsdom for
  any DOM-touching code (`window`, `document`, `WebSocket`).
- `package.json` `exports` field for browsers: `import` for `import`, no
  `require` (browsers don't `require`).

## What I don't know

- Whether the SDK should ship a UMD/IIFE bundle in addition to ESM (driven
  by T4's install-path choice).
- Whether the SDK publishes `dist/` (compiled) or only `src/` (TS source
  + bundler config the consumer uses). Other `@platform/*` packages
  publish `dist/`.
- Whether `vitest.config.ts` adds a `environment: 'jsdom'` switch or
  whether the SDK author accepts the test author using `@vitest/browser`
  in CI.
- Size budget. sdk-node bundles a `ws` client; sdk-browser needs only
  `BackendValue` types and a thin transport. Should be tiny. Worth
  setting a hard ceiling?

## Sub-questions

1. **Build output:** ESM-only (matches sdk-node, leverages modern bundler
   defaults), or ESM + IIFE (covers `<script>` tag install from T4). Pick.

2. **package.json `exports`:** `".": { "import": "./dist/index.js" }` only,
   plus a `"browser"` field re-pointing to a UMD bundle if T4 picks dual
   install. Decide the minimal valid config.

3. **Dependencies:** drop `ws`, drop `yaml` (browser needs JSON or inline),
   keep `@platform/event-bus`. Add `jsdom` as a dev-dep for the test
   environment. Anything else?

4. **Test runner config:** vitest with `environment: 'jsdom'` (in-process,
   fast), or `@vitest/browser` (real browser, slower). Pick one for v1.

5. **Bundle size budget:** if hard cap matters (e.g. 50KB minified+gz),
   record it; otherwise leave to consumers' bundlers.

## Resolution must record

- chosen build output (sub-Q 1);
- the `exports` and `browser` fields (sub-Q 2);
- the dependency list (sub-Q 3);
- the test runner config (sub-Q 4);
- bundle size budget or its absence (sub-Q 5);
- a verification note linking to the `package.json` once written.
