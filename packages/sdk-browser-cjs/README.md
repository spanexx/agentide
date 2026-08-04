# @spanexx/sdk-browser-cjs

CommonJS build of [`@spanexx/sdk-browser`](https://www.npmjs.com/package/@spanexx/sdk-browser).

## why this exists

`@spanexx/sdk-browser` is ESM-only. This CJS variant is mostly useful for SSR / Node-only consumers — the SDK itself targets browsers (native WebSocket, DOM APIs).

## install

```bash
npm install @spanexx/sdk-browser-cjs
```

## usage

```javascript
const { createSdk } = require('@spanexx/sdk-browser-cjs');
const sdk = createSdk({
  gateway: 'ws://localhost:7300/ws',
  token: process.env.PLATFORM_TOKEN,
  appId: 'acme-storefront',
});
```

## source

mirrored from `packages/sdk-browser/src/` at build time via `packages/sdk-browser-cjs/scripts/build.sh`. updates stay in lockstep with the ESM sibling. the build script rewrites `@spanexx/event-bus` imports to `@spanexx/event-bus-cjs`.

## when to use which

| consumer | package |
|---|---|
| browser app (bundler, ESM) | `@spanexx/sdk-browser` |
| SSR / node-only consumer (rare) | `@spanexx/sdk-browser-cjs` |

for production browser apps, use the ESM package. the CJS sibling exists to make tests + SSR setups work without bundling.