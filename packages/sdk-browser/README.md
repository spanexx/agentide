# @spanexx/sdk-browser

Browser SDK. The DOM is the manifest: annotate elements with `data-sdk-cap="<capability.name>"`, the SDK observes them via `MutationObserver`, registers each cap with the gateway, and dispatches invocations back to the page as `CustomEvent`s. no manifest file, no handler map.

## install

```bash
npm install @spanexx/sdk-browser
```

ESM-only. (CJS browser doesn't really exist — bundlers handle this. The CJS sibling `@spanexx/sdk-browser-cjs` is for SSR/Node-only consumers.)

## usage

```html
<!-- in your HTML -->
<button data-sdk-cap="cart.addItem">Add to cart</button>
```

```typescript
import { createSdk } from '@spanexx/sdk-browser';

const sdk = createSdk({
  gateway: 'wss://gateway.example.com/ws',
  token: process.env.PLATFORM_TOKEN,
  appId: 'acme-storefront',
  expectedOrigins: ['https://storefront.example.com'],  // required — deny-by-default
});

document.addEventListener('sdk.invoke', async (e) => {
  const { callId, name, input } = e.detail;
  if (name === 'cart.addItem') {
    try {
      const output = await addToCart(input);
      sdk.resolve(callId, output);
    } catch (err) {
      sdk.reject(callId, err.message);
    }
  }
});

await sdk.connect();
```

## how it works

- `data-sdk-cap` attribute scanned on `createSdk()` + watched via `MutationObserver` (subtree, childList, attribute)
- 0→1 element enters DOM → register the cap; 1→0 last element leaves → unregister (Gateway doesn't care how many elements back a cap)
- invocations fan out as `CustomEvent` on **every** annotated element — the dev decides which listener handles it (single delegated listener on `document` with `e.target.closest('[data-sdk-cap="..."]')`)
- native `globalThis.WebSocket` only — no polyfill, no fallback
- visibility-aware reconnect (pauses when tab hidden, resumes immediately on visible)
- offline-aware reconnect (`online` resets backoff and reconnects)
- `pagehide` graceful disconnect (bfcache-aware — `event.persisted === true` keeps the socket)

## browser-only constraints

- **`expectedOrigins` is REQUIRED** — browser tokens must carry this claim (deny-by-default at the gateway). Node clients bypass origin checks.
- no node APIs — zero `@types/node`/`@types/ws` deps.

## integration

depends on `@spanexx/event-bus`. connects to `@spanexx/adapter-websocket` over the public internet (uses `wss://`). the dev-supplied `expectedOrigins` claim is enforced by `@spanexx/origin` at handshake time.