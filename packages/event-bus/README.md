# @spanexx/event-bus

In-process pub/sub for Agentide components. Custom (not EventEmitter) — sync dispatch in subscription order, async handlers run via `Promise.allSettled`, one failing handler never blocks others. Wildcard patterns: `*` as final segment matches any depth (`browser.*` matches `browser.page.loaded`); bare `*` matches everything.

## install

```bash
npm install @spanexx/event-bus
```

ESM-only, but requires Node >= 22.12 where `require(esm)` is stable — so CJS consumers can `require('@spanexx/event-bus')` directly (no separate `-cjs` package exists).

## usage

```typescript
import { createEventBus } from '@spanexx/event-bus';

const bus = createEventBus();
bus.subscribe('session.created', (e) => console.log('got', e));
bus.subscribe('session.*', (e) => console.log('any session event'));
bus.publish('session.created', { id: 'abc' });
```

## when you'll see it

every component talks to siblings via this bus, not direct calls. `gateway.invocation` (audit), `sdk.connected` / `sdk.invoke.started` (sdk lifecycle), `session.*`, `plugin.*`, `capability.*` — all flow through it.

## public surface

- `createEventBus()` → `{ subscribe, unsubscribe, publish }`
- `matches(pattern, eventName)` — wildcard matcher
- `validatePattern(pattern)` — throws on malformed patterns like `br*wser.*`
- `Subscription` handle with `.unsubscribe()`
- `publishInternalEvent(bus, name, payload)` — bypasses the `event.*` reserved namespace guard (used by adapters to publish bus-internal events)

## integration

leaf — no internal deps. depended on by every other package that emits events (gateway-core, adapter-websocket, sdk-node, sdk-browser, session-manager, plugin-manager, capability-registry).