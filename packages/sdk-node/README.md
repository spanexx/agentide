# @spanexx/sdk-node

Backend SDK. Register business capabilities with the gateway, execute handlers locally on inbound invocations, emit lifecycle events. Used by node apps (express, nest, fastify, koa, plain http) that want to expose their business logic as Agentide caps.

## install

```bash
npm install @spanexx/sdk-node @spanexx/event-bus
```

ESM-only, but works from CJS-compiled apps on Node >= 22.12 (`require(esm)` is stable there; this package ships a `require` condition). No `-cjs` sibling exists.

## usage

```typescript
import { createSdk } from '@spanexx/sdk-node';

const sdk = createSdk({
  gateway: { url: 'ws://localhost:7300/ws', token: process.env.PLATFORM_TOKEN },
  app: { id: process.env.PLATFORM_APP_ID, name: 'My Backend' },
  manifest: { app: 'my-app', capabilities: [{ name: 'product.list', version: '1.0.0', tier: 'read', permissions: ['*'] }] },
  handlers: {
    'product.list': async (input, ctx) => ({ items: [] }),
  },
  observability: { logger: consoleLogger },
});

await sdk.connect();    // opens WS, authenticates
await sdk.register();   // sends cap manifest to gateway
await sdk.disconnect(); // graceful shutdown
```

## public surface

- `createSdk(config)` → `SdkInstance`
- `sdk.connect()` / `sdk.register()` / `sdk.disconnect()` / `sdk.reset()` / `sdk.state()`
- `sdk.invoke(name, input)` — direct invocation (used internally by the WS handler)
- 8 lifecycle events on the bus: `sdk.connected`, `sdk.disconnected`, `sdk.capability.registered/unregistered/rejected`, `sdk.invoke.started/completed/failed`

## lifecycle states

`init → connected → registered → disconnected (auto-reconnect) → connected → registered`

## integration

depends on `@spanexx/event-bus` (its own bus instance, scoped to the SDK). connects to `@spanexx/adapter-websocket` over port 7300. handlers are called by `@spanexx/backend-runtime` when the gateway routes an invoke to this SDK's `appId`.