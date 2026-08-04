# @spanexx/origin

Single primitive: does an incoming `Origin` header match a token's `expectedOrigins` claim? RFC 6125 §6.4.3 single-label wildcard support (`*.example.com` matches `foo.example.com`).

## install

```bash
npm install @spanexx/origin
```

## usage

```typescript
import { originMatches } from '@spanexx/origin';

originMatches('https://app.example.com', ['https://app.example.com']); // true
originMatches('https://evil.com', ['*.example.com']);                  // false
originMatches('https://foo.example.com', ['*.example.com']);            // true
```

## when you'll see it

`adapter-websocket` and `backend-runtime` both call this on every browser-origin WebSocket handshake. deny-by-default — if the token has no `expectedOrigins` claim and the connection has an `Origin` header, the connection is rejected (close 1008).

## public surface

- `originMatches(origin, allowed)` → `boolean`
- `normalizeOrigin(value)` → strips path/query, lowercases host

## integration

leaf — no internal deps. gateway-core re-exports it; adapter-websocket and backend-runtime import from gateway-core to avoid the package cycle.