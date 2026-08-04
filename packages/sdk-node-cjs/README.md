# @spanexx/sdk-node-cjs

CommonJS build of [`@spanexx/sdk-node`](https://www.npmjs.com/package/@spanexx/sdk-node) for CJS consumers.

## why this exists

`@spanexx/sdk-node` is ESM-only. CJS consumers (NestJS, Express, plain Node compiled to `commonjs`) cannot `require()` an ESM-only package. `@spanexx/sdk-node-cjs` ships the same source compiled to CJS, with `@spanexx/event-bus-cjs` as its only dep.

## install

```bash
npm install @spanexx/sdk-node-cjs @spanexx/event-bus-cjs
```

## usage

```javascript
const { createSdk } = require('@spanexx/sdk-node-cjs');
const sdk = createSdk({
  gateway: { url: 'ws://localhost:7300/ws', token: process.env.PLATFORM_TOKEN },
  app: { id: process.env.PLATFORM_APP_ID, name: 'My Backend' },
  manifest: { app: 'my-app', capabilities: [{ name: 'product.list', version: '1.0.0', tier: 'read', permissions: ['*'] }] },
  handlers: { 'product.list': async (input) => ({ items: [] }) },
});
await sdk.connect();
await sdk.register();
```

## source

mirrored from `packages/sdk-node/src/` at build time via `packages/sdk-node-cjs/scripts/build.sh`. updates stay in lockstep with the ESM sibling. the build script also rewrites `@spanexx/event-bus` imports to `@spanexx/event-bus-cjs`.

## when to use which

| consumer | package |
|---|---|
| ESM (modern node, vite, etc.) | `@spanexx/sdk-node` |
| CJS (NestJS, Express, etc.) | `@spanexx/sdk-node-cjs` |

## integration

CJS mirror of `@spanexx/sdk-node` — same API, same wire protocol, same event types. connects to the same `@spanexx/adapter-websocket` on port 7300. see the ESM sibling's README for the full picture.