# WebSocket transport details

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** Browser-aware reconnect and lifecycle (T3), the feature-pipeline
run.

## Question

What does the WebSocket transport for `@platform/sdk-browser` look like at
the byte level — same wire as `@platform/sdk-node`, different transport
class — given (a) no `ws` library in the browser, (b) browser CORS rules,
(c) browser quirks around auth headers?

## What I know

- Backend-runtime already accepts sdk-node WebSocket connections on a Node
  `ws` server. Same wire messages (`sdk.invoke` / `sdk.invoke.result` /
  `sdk.invoke.error`, plus register/sync messages) — already locked.
- `BackendValue` recursive type (`packages/backend-runtime/src/types.ts:131`)
  is transport-agnostic. Reusable as the TS shape for browser payloads too.
- `WebSocketLike` interface (`packages/backend-runtime/src/types.ts:89`)
  is the structural minimum needed (`send`/`close`). Browser's `WebSocket`
  already has both — no shimming required there.
- The browser's `WebSocket` API does not allow custom HTTP headers. Sending
  a JWT via `Authorization` is impossible in the browser spec. sdk-node
  passes the JWT in the first message after `onopen`; the browser SDK must
  do the same.
- CORS: WebSocket connections are governed by the *WebSocket handshake*
  response headers, not the Fetch CORS rules. There's no `Origin` filter
  on WebSocket requests by default; the server (backend-runtime) decides
  whether to validate the `Origin` header.

## What I don't know

- Whether backend-runtime needs an `Origin` allowlist for browser SDK
  connections (probably yes, because browser-origin requests are different
  threat model than Node SDK connections from an operator app). Cross-ticket
  with backend-runtime.
- Whether the JWT should be sent in the first message body or as a query
  parameter (the latter is logged in proxies; the former is cleaner but
  requires a server-side change from sdk-node's "send first message after
  onopen" pattern).
- Whether the browser SDK should validate the JWT signature on receipt
  (sdk-node currently does not — it forwards the token to handlers in
  `HandlerContext.token`). Decide whether browser does better.

## Sub-questions

1. **Auth transport:** (i) JWT in first message body after `onopen`, (ii)
   JWT as `?token=` query parameter, (iii) `Sec-WebSocket-Protocol` header
   (browser-supported, server-side pickable). Pick one canonical approach.

2. **Origin allowlist:** should browser SDK connections be subject to an
   `Origin` allowlist at the backend-runtime layer? Yes/no, and what's the
   default config?

3. **JWT validation client-side:** sdk-node forwards the caller's token to
   handlers verbatim. For consistency, browser SDK should do the same —
   confirm. If a stricter model is wanted, surface it as a follow-up
   decision rather than v1 scope.

4. **Browser-native WebSocket only:** confirm we don't ship a fallback or
   polyfill — `globalThis.WebSocket` ships in every supported browser since
   2011. No `ws` library import.

## Resolution must record

- the chosen auth transport (sub-Q 1);
- backend-runtime Origin allowlist behavior (sub-Q 2);
- whether JWT validation is client-side (sub-Q 3);
- a verification note linking to backend-runtime / sdk-browser transport
  code.
