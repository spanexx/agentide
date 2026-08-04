# @spanexx/event-bus-cjs

CommonJS build of [`@spanexx/event-bus`](https://www.npmjs.com/package/@spanexx/event-bus) for CJS consumers.

## why this exists

`@spanexx/event-bus` is ESM-only. CJS consumers (NestJS, Express, plain Node compiled to `commonjs`) cannot `require()` an ESM-only package.

## install

```bash
npm install @spanexx/event-bus-cjs
```

## usage

```javascript
const { createEventBus } = require('@spanexx/event-bus-cjs');
const bus = createEventBus();
bus.subscribe('hello.world', (e) => console.log(e));
```

## source

mirrored from `packages/event-bus/src/` at build time via `packages/event-bus-cjs/scripts/build.sh`. updates stay in lockstep with the ESM sibling.

## when to use which

| consumer | package |
|---|---|
| ESM (Angular, Vite, modern bundlers) | `@spanexx/event-bus` |
| CJS (NestJS, Express, plain Node) | `@spanexx/event-bus-cjs` |

for cross-package compatibility in a single app, install both — they're tiny and identical in API.