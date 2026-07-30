# Browser-aware reconnect and lifecycle

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** the feature-pipeline run.

## Question

What reconnect and lifecycle strategy does `@platform/sdk-browser` adopt
to handle browser-tab realities that a Node process never sees?

`@platform/sdk-node` uses exponential backoff with ±20% jitter, capped at
30s, on any unexpected WebSocket close. That covers Node use. A browser tab
has additional concerns: `visibilitychange`, `online`/`offline`, page
unload, and the platform's habit of *throttling* backgrounded tabs.

## What I know

- Browser `WebSocket` closes with codes the SDK can read.
- `document.addEventListener('visibilitychange', ...)` fires when a tab goes
  to/from background. Backgrounded tabs are throttled: timers ≥1s, queued
  network. This breaks any setTimeout-based reconnect.
- `window.addEventListener('online' | 'offline', ...)` reflects
  `navigator.onLine`. Tells the SDK whether network is reachable without
  waiting for `socket.send()` to fail.
- `'pagehide'` fires on navigation/close (more reliable than `'unload'`
  on mobile). Reconnects scheduled in a closing tab won't run.
- `beforeunload` can defer navigation briefly but can't block it.
- `Service Worker` could hold the WebSocket across page navigations, but
  introduces an install prompt and a separate scope.

## What I don't know

- Whether the SDK should *pause* reconnect while backgrounded and resume
  on `visibilitychange` to "visible", or let the browser throttle and
  reconnect normally.
- Whether `disconnect()` should fire on `pagehide` automatically. sdk-node
  treats `disconnect()` as explicit (no auto-reconnect). The browser
  equivalent is ambiguous.
- Whether the SDK should expose a hook for the host app to "freeze" the
  connection (e.g. when a modally-navigated route doesn't need the SDK).
- Whether the SDK should use a heartbeat ping (and how often) to detect
  silent disconnect, given SDK_UNREACHABLE in the gateway error map.

## Sub-questions

1. **Visibility:** `visible = full backoff`. `hidden = pause reconnect, do
   not reconnect under throttling`. Decide.

2. **Online/Offline:** when `offline` fires, treat the socket as already
   dead (no `socket.send` retries); when `online` fires, trigger reconnect
   regardless of the backoff schedule. Or wait for the backoff to elapse?
   Decide.

3. **Page unload:** best-effort send a `sdk.disconnect` (or close the
   socket) on `pagehide`. Pre-impl simpler to just let it close. Decide.

4. **Heartbeat:** server-side or client-initiated ping every Ns; on
   missed pong `socket.close()` and reconnect. Decide.

## Resolution must record

- the chosen strategy for each sub-question above;
- the events that emit `sdk.disconnected` (and which reason value);
- a verification note linking to the lifecycle code when implemented.
