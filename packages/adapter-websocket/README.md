# @spanexx/adapter-websocket

WebSocket adapter — the "only door" for SDKs (`sdk-node`, `sdk-browser`), dashboards, and non-LLM clients. Universal push + pull on a single socket: subscribe to event-bus topics, invoke caps, stream results. JWT in first message after `onopen` (browsers can't set custom Authorization headers, so we use the message body).

## install

```bash
npm install @spanexx/adapter-websocket
```

## usage

```typescript
import { createWebSocketAdapter } from '@spanexx/adapter-websocket';

const adapter = createWebSocketAdapter(gateway, eventBus, {
  host: '127.0.0.1',
  port: 7300,
  path: '/ws',        // IMPORTANT — clients connect to ws://host:7300/ws
  tokenSecret: gatewaySecret,
});
await adapter.start();
```

## wire protocol (16 frames)

flat `{type, ...}` envelope keyed by `type` discriminator:

```
auth / auth.ok / auth.error           // handshake
subscribe / subscribe.ok              // topic subscriptions
unsubscribe / unsubscribe.ok          // drop topics
event                                 // event-bus frame pushed to subscriber
invoke / invoke.result / invoke.error // pull: capability invocation
invoke.partial / invoke.end           // streaming mode
stats                                 // dropped-frame notice (backpressure)
error                                 // protocol-level error
pong                                  // heartbeat reply
```

## behaviors

- per-token `expectedOrigins` enforced for browser connections (deny-by-default, RFC 6125 §6.4.3 `*.` wildcard)
- Node connections (no `Origin` header) bypass origin check
- 1 MiB inbound + outbound frame cap (close 1009)
- 30s ping / 10s pong heartbeat (close 1011)
- 30s pre-auth timeout (close 1008)
- per-connection 1 MiB outbound FIFO queue; on overflow sends `{type:"stats", dropped:N}`
- mid-connection token rotation supported (sends `event.connection.rotated` audit)

## integration

depends on gateway-core + event-bus + errors + origin. wired into `@platform/agentide` via `adapterWs` config. `sdk-node-cjs` / `sdk-node` are the canonical consumers.