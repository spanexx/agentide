# @spanexx/sdk-browser

Browser SDK for Agentide. The DOM is the manifest: annotate elements with `data-sdk-cap`, and the SDK observes them, registers the capabilities with the Gateway, and dispatches invocations back to the page as `CustomEvent`s.

## Install

```bash
npm install @spanexx/sdk-browser
```

## Usage

```typescript
import { createSdk } from "@spanexx/sdk-browser";

// 1. annotate a button in your HTML:
//    <button data-sdk-cap="cart.addItem">Add to cart</button>

// 2. wire the SDK once at app start:
const sdk = createSdk({
  gateway: "ws://localhost:7300",
  token: process.env.PLATFORM_TOKEN!,
  appId: "acme-storefront",
  // optional origin binding — required if your page is served from a real origin
  expectedOrigins: ["http://localhost:3000"],
});

// 3. handle invocations on the page:
document.addEventListener("sdk.invoke", (e) => {
  const { callId, name, input } = e.detail;
  if (name === "cart.addItem") {
    addToCart(input).then(
      (output) => sdk.resolve(callId, output),
      (err) => sdk.reject(callId, err.message),
    );
  }
});

await sdk.connect();
```

## Lifecycle

```
init → connect() → connecting → connected → (invocations happen here)
                                              ↓
                                       disconnected → reconnecting → connected
```

## API

| Method | Purpose |
|---|---|
| `connect()` | Open WebSocket to Gateway, send first-message JWT auth. |
| `disconnect()` | Close WebSocket cleanly. |
| `resolve(callId, output)` | Send `sdk.invoke.result` back to the Gateway for a pending invocation. |
| `reject(callId, message)` | Send `sdk.invoke.error` back to the Gateway. |
| `state()` | Read current `connectionState` (`connecting` / `connected` / `reconnecting` / `disconnected`). |
| `onStateChange(cb)` | Subscribe to connection-state transitions. |
| `observe(root?)` | Start observing an extra DOM root (default is `document.body`). |

## Events emitted

On the local SDK event bus:
- `sdk.connected`
- `sdk.disconnected`
- `sdk.capability.registered`
- `sdk.capability.unregistered`
- `sdk.capability.rejected`
- `sdk.invoke.started`
- `sdk.invoke.completed`
- `sdk.invoke.failed`

## Browser-only constraints

- **Native WebSocket only.** No polyfill, no fallback. Every supported browser since 2011 has `WebSocket`.
- **`expectedOrigins` is REQUIRED for browser tokens** (deny-by-default at the Gateway). Node clients bypass origin checks.
- **Visibility-aware reconnect** — pauses while the tab is hidden, resumes immediately on `visibilitychange → visible`.
- **Offline-aware reconnect** — treats `offline` as dead, resets backoff and reconnects on `online`.
- **`pagehide` disconnect** — best-effort `sdk.disconnect` on real unload; bfcache pages (`event.persisted === true`) keep the socket alive.

## License

MIT