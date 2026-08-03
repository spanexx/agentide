# D3 — UI shape: stack, layout, static server, live updates

**Type:** `wayfinder:grilling` (HITL — delegated 2026-08-03: user granted full
decision authority for the remaining tickets, alignment mandate: PHILOSOPHY.md +
existing locks + code reality)
**Status:** closed 2026-08-03 (autonomous resolution under delegation)
**Blocks:** (implementation — last ticket before feature-pipeline) — resolved

## Question

What does the web dashboard UI look like and how is it served — stack, page
layout, static serving, and the socket lifecycle that keeps it live?

## Context (from the map + GRILL)

- Q4 lock: dashboard package serves its own static UI page over HTTP (page +
  assets only — NO data API; data flows over adapter-websocket).
- D1 fixes the view list; D2 fixes the cap contract; D4 fixes the token.
  Adapter W3 (subscription model) / W4 (wire schema) / W6 (backpressure) locks
  feed the socket usage below — pull them when they close.
- Repo convention: plain HTML/JS (sims precedent), no framework build step
  unless grilled otherwise.
- Every in-v1 view needs snapshot-at-open (invoke) + live updates (subscribe).

## Sub-questions

1. **Stack:** plain HTML/CSS/JS single page (repo convention) vs a framework
   (React/Vue build step)? Recommend plain, grill.
2. **Static server:** which HTTP server serves the page — the dashboard package
   spins its own (port via `@platform/agentide` factory, e.g. `dashboardPort`,
   default 7200?) vs reuse anything existing? What routes (GET `/` + assets)?
   Recommend own server + factory wiring, mirroring `adapterMcpPort`.
3. **Layout:** one page, panels per in-v1 view; header = connection status +
   token/refresh hint. Confirm shape.
4. **Open sequence:** connect → auth (token) → `invoke` each in-v1 view
   (`mode:"call"`) → render snapshots → `subscribe` the view's event topics →
   render `event` payloads live. Confirm; adopt adapter's `invoke.batch` if the
   adapter ships it in v1 (it won't — future.md — so five invokes today).
5. **Socket lifecycle:** reconnect policy (sdk-browser's pause-on-hidden /
   reset-on-online pattern as precedent?), pagehide disconnect, error/denied
   states per panel, "connecting…" / "disconnected" banner.
6. **Empty & degraded states:** no sessions / no plugins / gateway down —
   what each panel shows.
7. **Error display:** `invoke.error` / `event.handler_failed` — where surfaced.

## Resolution must record

The locked UI contract (stack, server, routes, layout, open sequence, lifecycle,
states). Update CONTEXT.md + this ticket on every lock. When this ticket closes,
the map is done → `delivery: feature-pipeline` → GRILL → PRD-TRD → IMPL for
`@platform/dashboard`.

## Resolution (locked 2026-08-03, autonomous under user delegation)

1. **Stack:** plain HTML/CSS/JS single page, no framework, no build step (repo
   convention; sims precedent; delay complexity; nothing-is-special). Served
   assets: `index.html` + one `app.js` + one `style.css` (no bundler).

2. **Static server:** the dashboard package spins its own HTTP server —
   `dashboardPort` via `@platform/agentide` factory, default **7200** (mirrors
   `DEFAULT_ADAPTER_MCP_PORT = 7100`, `packages/agentide/src/factory.ts:38`),
   bound to `127.0.0.1` (adapter-mcp host precedent, `types.ts:3`). Routes:
   `GET /` → `index.html` (with the freshly minted token injected, see D4) and
   `GET /assets/*` → static files. **No data API** (Q2 lock — the WS adapter is
   the only door). **Port-collision guard:** adapter-websocket must NOT take
   7200 (its port locks at W4); noted in map + future.md. Enabled by
   `config.dashboardPort` presence (mirror of `backendRuntimePort` opt-in).

3. **Layout:** one page — header (connection status pill: connecting /
   connected / disconnected / origin-mismatch; tenant; token hint) + four
   panels: Active Sessions, Installed Plugins, Registered Capabilities,
   Runtime Health. CSS grid, plain styling.

4. **Client + open sequence:** the page speaks the **adapter-websocket wire**
   (`auth` / `auth.ok` / `auth.error`, `invoke` / `invoke.result` /
   `invoke.error`, `subscribe` / `event`) — NOT sdk-browser's `sdk.auth` wire
   (that is the backend-runtime transport for SDK consumers; the dashboard is
   an ADAPTER client, W2 Q1). A small vanilla-JS WS client module in the served
   assets implements the adapter envelope (shape per adapter W4 lock, which
   feeds the IMPL). Sequence: connect → `auth{token}` → wait `auth.ok` →
   `invoke{name:"dashboard.view.sessions"}` + `dashboard.view.plugins` +
   `dashboard.view.capabilities` + `dashboard.view.health` (`mode:"call"`) →
   render snapshots → `subscribe{topics:["session.*","plugin.*",
   "capability.*"]}` → render `event` payloads live. `system.*` is NOT
   subscribed: it has no event producers (D5), only `gateway.status` snapshots
   — subscribing to nothing is dead weight (delay complexity). `invoke.batch`
   not adopted (adapter future.md — 4 invokes today).

5. **Runtime Health refresh interval:** **30s** periodic `invoke{
   gateway.status}` (no events exist). Reversible knob (constant in `app.js`).
   Health panel renders the latest snapshot + "last updated" timestamp.

6. **Socket lifecycle:** sdk-browser's patterns as BEHAVIOR precedent (not
   code reuse — different wire): backoff 1→30s ±20% jitter on drop; pagehide →
   deliberate disconnect; hidden tab → pause reconnect; online/visible →
   reconnect; `auth.error` or close 1008 → terminal, NO reconnect — show
   "origin mismatch" / auth-failed banner (W2 Q4 terminal close). Per-panel
   error/denied states from `invoke.error` (show code + message verbatim,
   `GATEWAY_*` passthrough per D2).

7. **Empty & degraded states:** per-panel empty text ("No sessions",
   "No plugins installed", "No capabilities registered" — last is not
   reachable in practice); gateway down → header banner "disconnected",
   panels keep last snapshot + "stale" marker; pre-first-load → "connecting…".
   Token expiry mid-session (1h, no re-auth in v1): on `auth.error`/`invoke.
   error` token-related codes → banner "token expired — reload the page".

### Why (philosophy alignment)

- Nothing is special / delay complexity: no framework, no build, no
  aggregation, no stored state; a page + a socket.
- Dependencies point inward: the dashboard package depends on the adapter
  wire; the kernel never knows the dashboard exists.
- Make every decision reversible: 30s interval, port, and layout are data
  constants; the adapter-wire client is a small module.
- Tiny boring kernel: the ONLY kernel changes are D2's additive seams
  (session-less names, extraOwnerHandlers) and D4's additive token field.

### Open items handed to the IMPL (not decisions)

- Exact wire shapes follow adapter W4 lock (envelope fields, correlationId,
  heartbeat, frame cap) — pull the lock when it closes.
- Heartbeat: adapter W4 decides; page client mirrors.
- Panel sort/visual details — IMPL taste, not chart scope.

## Progress

- 2026-08-03 — claimed (autonomous delegation); sub-questions verified against
  adapter W2/W4 locks + sdk-browser precedent; resolution above; CLOSED — the
  map is done. GRILL Q9 appended; CONTEXT.md entry added; map Decisions-so-far
  updated; `delivery: feature-pipeline` announced (execution waits for
  adapter-websocket, Q3).
