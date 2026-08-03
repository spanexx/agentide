# dashboard-core — Future work (post-v1)

> **Status:** v1 destination (locked 2026-08-03) = `dashboard.view.*` read caps
> + web dashboard UI, all data over adapter-websocket, browser-held read-only
> origin-bound token, ships after adapter-websocket. This file records what is
> **left** for future runs.

## What no longer needs recording here

- ~~Web dashboard UI~~ — **moved into v1** (Q4 lock, 2026-08-03; revises Q1).
  The dashboard package serves its own static page; data flows over the socket.
- ~~Read-only HTTP backdoor~~ — ruled out (Q2 lock); the WS adapter is the only
  door.

## What remains future

### 0. Notes for the adapter session (cross-map coordination, locked D3/D4)

- **Port collision guard (D3):** the dashboard's static server takes
  `dashboardPort` default **7200**. The adapter-websocket must NOT take 7200 —
  its port locks at W4; pick any other port (e.g. 7201 or 7101).
- **The dashboard page speaks the ADAPTER wire** (`auth` / `invoke` /
  `subscribe` / `event` per W2 Q1/W4) — NOT sdk-browser's `sdk.auth` wire.
  sdk-browser is the backend-runtime transport; the dashboard is an adapter
  client. The adapter's W4 lock is a hard input to the dashboard IMPL.
- **Origin-binding mint side (D4, drift D-50):** adapter W2 Q4 enforcement is
  locked, but `gateway.issueToken` mints no `expectedOrigins` and the CLI has
  no `--origin` flags — no browser client can authenticate until the mint
  side lands (scheduled in the dashboard pack's IMPL). Adapter tests will
  need a hand-minted token until then.
- **Mid-connection token refresh (adapter W2 Q3)** is available but NOT used
  by v1 dashboard (refresh = page reload, D4). Future option if expiry UX
  becomes real.

### 1. `invoke.batch` adoption

The adapter's `future.md` §2 names dashboards as the demand-driver: at open,
the UI loads the four v1 views (`session.list`, `plugin.list`,
`capability.list`, `system.health`) — today that is four correlated `invoke`
frames. When/if the adapter ships `invoke.batch` (parallel results by index),
the dashboard UI adopts it: one frame at open, same rendering code. Shape is
NOT locked (adapter grills it); adoption is a small-change ticket in a future
run, not a new map.

### 2. Kernel-level streaming seam (adapter promotion)

If the kernel ever emits partial results natively (adapter future.md §1), the
dashboard could show live progress on long invocations. v1 dashboard is
read-only — it invokes only read caps (all fast), so this is a non-demand
until the dashboard grows write surface or views show long-running
invocations. Revisit only with a concrete consumer.

### 3. Views deferred by D1 (locked 2026-08-03)

Four §14 views are **out of v1** — each misses half the acceptance bar
(snapshot + live) and needs a backend seam, not a thin wrapper. Each has an
open drift entry; it graduates only when a concrete consumer exists (e.g.
plugin authors want error visibility) AND the drift is fixed.

| Deferred view | Missing half | Drift | To fix |
|---|---|---|---|
| Metrics | snapshot (placeholder zeros) + live | D-46 | real invocation/denial/error counters in `handleInvocation` |
| Logs | snapshot (no read cap) | D-47 | log-read seam (cap + CLI `logs` command) |
| Errors | snapshot (no listing cap) | D-48 | error-listing seam over audit/event history |
| Browser Instances | both (zero backing) | D-49 | enumeration cap + lifecycle events in browser-runtime |

Re-grill in a future run: Logs/Errors as standalone views vs derived rows
inside another view is still open (D1 sub-Q3 deferred); Browser Instances
needs a demand story (which developer sits and watches browser tabs from the
dashboard?). Metrics history (§4) applies once Metrics itself graduates.

### 4. Metrics history / time-series

v1 shows `gateway.metrics` as a snapshot. If operators want trends (per-caller
rates over time), the dashboard needs a storage side (the thin-wrapper lock in
Q2 explicitly rules out stored state in v1). Separate decision, future run.

### 5. Extensions sharing the surface

BI[14] Chrome DevTools extension + BI[15] VS Code extension can consume the
same `dashboard.view.*` caps + socket surface as the web UI. They are separate
backlog items (separate maps) — this entry only notes the shared surface, so
the extension maps can reference it.
