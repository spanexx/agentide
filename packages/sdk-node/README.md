# @platform/sdk-node

Backend SDK for Agentide. Register business capabilities with the Gateway, execute handlers, emit events.

## Install

```bash
npm install @platform/sdk-node
```

## Usage

```typescript
import { createSdk } from "@platform/sdk-node";

const sdk = createSdk({
  gateway: {
    url: process.env.GATEWAY_URL ?? "ws://localhost:7777",
    token: process.env.GATEWAY_TOKEN ?? "dev-token",
  },
  app: { id: "customer-app", name: "Acme Customer Service" },
  manifest: "./manifest.yaml",
  handlers: "./dist/handlers",
});

await sdk.connect();
await sdk.register();
```

## Lifecycle

```
init → connect() → connected
              ↓
        register() → registered
              ↓
   (invocations happen here)
              ↓
       disconnect() → disconnected → (auto-reconnect) → connected → registered
```

## API

| Method | Purpose |
|---|---|
| `connect()` | Open WebSocket to Gateway, auth with token. |
| `register()` | Read manifest + handlers, register each capability with the Gateway. |
| `invoke(name, input)` | Direct invocation (typically used internally by the SDK's WebSocket handler). |
| `disconnect()` | Close WebSocket. Triggers auto-reconnect with backoff. |
| `reset()` | Clear local state (capabilities, phase). |
| `state()` | Read current phase + registered capabilities. |

## Events emitted

On the shared `@platform/event-bus`:
- `sdk.connected`
- `sdk.disconnected`
- `sdk.capability.registered`
- `sdk.capability.unregistered`
- `sdk.invoke.started`
- `sdk.invoke.completed`
- `sdk.invoke.failed`

## What's NOT in v1

See `docs/features/sdk-node/future.md` in the Agentide repo. Highlights:

- Token refresh flow (drift #14) — v2.1
- Schema validation — v2.2
- Observability hooks (OTel, metrics) — v2.3
- Multi-app per process — v2.4
- Lambda / edge / worker pool runtimes — v3.x

## License

MIT