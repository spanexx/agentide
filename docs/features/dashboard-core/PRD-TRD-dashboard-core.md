# PRD-TRD: dashboard-core — `@platform/dashboard` web dashboard (BI[13])

> **Status:** authored 2026-08-06 — feature-pipeline Phase 1 (post-GRILL, post pre-impl sim).
> **Inputs:** `docs/features/dashboard-core/GRILL-dashboard-core.txt` (Q1–Q9 locked),
> `docs/wayfinder/dashboard-core/map.md` (D1–D5 closed, map DONE), tickets under
> `docs/wayfinder/dashboard-core/tickets/`, pre-impl sim
> `docs/features/dashboard-core/simulate-pre.html` (user-approved shape incl.
> drill-down + panel scroll, 2026-08-06).
> **Execution gate:** adapter-websocket SHIPPED (2026-08-03) — Q3 satisfied.
> Drift prerequisites closed: D-45 (session.list), D-46 (gateway.metrics),
> D-50 (expectedOrigins mint).

## Why This Exists

Agentide §14 "Task Manager" — a first-class self-hosted visibility layer. The
operator of a self-hosted gateway needs a live view of what their agents are
doing: which sessions exist, which plugins are installed, which capabilities
are registered, and whether the runtime is healthy. Today that data exists only
behind the CLI (`agentide sessions`, `capabilities`, …). The dashboard makes it
a product: a web page served by the gateway host, all data flowing over the
adapter-websocket door, browser-held read-only origin-bound token.

## Scope

**In (v1):**
- `dashboard.view.*` read caps × 4 (Sessions, Plugins, Capabilities, Health) —
  thin in-process passthrough wrappers (D2 lock).
- Web dashboard page: plain HTML/CSS/JS, no framework, no build step (Q9).
- Static server in the dashboard package: `dashboardPort` 7200, binds
  127.0.0.1, `GET /` (index.html with minted token injected) + `GET /assets/*`.
- Token mint per page load: `gateway.issueToken` (callerId `dashboard-bot`,
  scope `["platform.*.read"]`, `expectedOrigins` both localhost forms) — D4.
- Socket lifecycle per Q9: backoff 1→30s ±20%, pagehide disconnect,
  hidden→pause, 1008/auth.error terminal.
- Drill-down detail overlay + panel internal scroll (user-approved sim
  revisions).

**Out (v1):** write actions of any kind (read-only lock Q2); deferred views
Metrics/Logs/Errors/Browser Instances (D1 → future.md; drifts D-46 fixed /
D-47 / D-48 / D-49 open); Chrome DevTools + VS Code extensions (BI[14]/BI[15]);
hosted multi-tenant dashboard; REST transport; aggregation or stored state
anywhere in the data plane (Q2); adapter mid-connection re-`auth` (D4).

## Behavioral Spec

### Scenario 1: Open sequence (Q9)
The operator loads `http://127.0.0.1:7200/`. The server mints a fresh
dashboard-bot token and injects it into the page. The page opens a WebSocket
to `ws://127.0.0.1:7300/ws` and performs, in order:
`connect` → `auth` (token) → 4 × `invoke {mode:"call"}` (`session.list`,
`plugin.list`, `capability.list`, `system.health`) → render the four snapshots →
`subscribe ["session.*","plugin.*","capability.*"]` → live render.

- **AC-1.1** `GET /` returns the page with a unique minted token embedded
  (memory only — no localStorage, no paste).
- **AC-1.2** The four snapshots render within one open sequence; each panel
  shows its data with a "● live" indicator.
- **AC-1.3** The auth frame carries the origin-bound token; the page binds the
  `ws://` URL from its own origin's host (127.0.0.1).

### Scenario 2: Four views, snapshot + live (D1 acceptance bar)
Sessions shows active + archived session records from `session.list` (real
snapshot — D-45 closed); Plugins shows installed plugins + enabled state;
Capabilities shows the registered catalog (platform read-tier + business,
tier badges); Health shows `system.health` status, uptime, tenant + plugin
counts.

- **AC-2.1** Every panel renders data from its backing cap — no hardcoded
  rows (snapshot half of the bar).
- **AC-2.2** After subscribe, `session.created`, `plugin.*`, `capability.*`
  events mutate the matching panel in place (live half of the bar).

### Scenario 3: Live updates
A session is created (e.g. `agentide invoke session.create`). The page
receives `event {topic:"session.created"}` and prepends the record to the
Sessions panel without a reload. A capability is registered; the Capabilities
panel gains the row.

- **AC-3.1** `session.created` event → row appears in Sessions within one
  second of the event.
- **AC-3.2** `capability.registered` event → row appears in Capabilities.
- **AC-3.3** `plugin.enabled` event → plugin row flips to enabled.

### Scenario 4: Health polling (D1→D3)
`system.*` has no producers (D5) — Health does NOT subscribe. Instead the page
polls `gateway.status` (invoke, mode call) every 30s and refreshes the panel.

- **AC-4.1** Health panel refreshes on a 30s cadence while visible.
- **AC-4.2** A failed poll on an otherwise-connected socket marks Health stale
  only (other panels keep live state); two consecutive failures surface the
  gateway-down banner (S5).

### Scenario 5: Gateway down (Q9 lifecycle)
The gateway stops. The socket closes unexpectedly. The page shows the
gateway-down banner, marks all panels STALE, and reconnects with backoff
1s → 2s → 4s → … → 30s cap, ±20% jitter. On reconnect: re-`auth` with the
same token, re-invoke the four snapshots, re-subscribe. `pagehide` disconnects
deliberately; a hidden tab pauses reconnect attempts; returning to visible
resumes them.

- **AC-5.1** Banner + stale markers appear within one backoff interval of the
  drop.
- **AC-5.2** Backoff schedule doubles to the 30s cap with jitter; no tight
  reconnect loop.
- **AC-5.3** Hidden tab: no reconnect attempts while hidden; resumes on
  visibilitychange.

### Scenario 6: Token expired / origin mismatch (Q9 terminal state)
The token expires (1h) or the browser Origin does not match `expectedOrigins`.
The adapter answers `auth.error` and closes with code 1008. The page shows the
token-expired banner ("reload the page to mint a fresh token") and does NOT
reconnect (terminal).

- **AC-6.1** `auth.error` + close 1008 → terminal banner, no reconnect
  attempts.
- **AC-6.2** The banner text distinguishes the origin-mismatch case from
  generic expiry (verbatim `auth.error` message shown).

### Scenario 7: Per-panel errors (Q9)
A backing cap errors (e.g. `capability.list` denied). `invoke.error` carries a
`GATEWAY_*` code + message; the panel shows it verbatim, other panels keep
their data.

- **AC-7.1** `invoke.error` code+message rendered verbatim in the failing
  panel; the panel shows an error state, not a blank.
- **AC-7.2** A failed invoke does not tear down the socket or other panels.

### Scenario 8: Drill-down detail (sim revision, approved)
Every row is clickable. Clicking opens a right-side detail overlay with the
full record (all fields of the entity — session id/timestamps/timeouts/
metadata, capability version/owner/permissions/description, plugin fields,
health fields) plus the wire frame that produced it.

- **AC-8.1** Click a row → overlay with the full entity record, rendered from
  the live snapshot/event data (no separate fetch).
- **AC-8.2** Overlay closes via ✕ or click-outside; opening another row
  replaces the overlay content.

### Scenario 9: Panel scroll + empty states (sim revision + Q9)
Panels cap at 380px and scroll internally; scrollbars themed to the dark
palette. A panel with zero records shows the per-panel empty text.

- **AC-9.1** >8–10 rows → the panel scrolls internally; the header stays
  pinned; the page does not grow.
- **AC-9.2** Empty panel shows its empty text (e.g. "no sessions").

### Scenario 10: `dashboard.view.*` caps are thin wrappers (D2)
The four caps: type `platform`, owner `dashboard`, tier `read`,
`permissions: ["platform.dashboard.read"]`, session-less (names joined to the
kernel session-less set). Each handler re-invokes `Gateway.handleInvocation()`
on its backing read cap with an internal `dashboard` token; `GATEWAY_*` errors
pass through; the invocation is double-audited (inner + outer row).

- **AC-10.1** `invoke {capability: {name:"dashboard.view.sessions"}}` (session-less)
  returns the same record set as `session.list`.
- **AC-10.2** A caller without `platform.dashboard.read` receives
  `GATEWAY_INSUFFICIENT_SCOPE` from the wrapper.
- **AC-10.3** Audit log contains one inner row (backing cap, caller
  `dashboard-bot`) and one outer row (dashboard cap, real caller).

### Scenario 11: Static server (D3)
The dashboard package serves only static UI files. `GET /` → index.html with
token injected; `GET /assets/*` → js/css; anything else → 404. No data API.

- **AC-11.1** `GET /` 200 + token injected; `GET /assets/app.js` 200;
  `GET /api/anything` 404.
- **AC-11.2** Server binds 127.0.0.1:7200; port configurable via
  `config.dashboardPort` (default 7200); port 7200 is reserved — adapter
  must not bind it.

## Simulation Contract

The post-impl sim (`docs/features/dashboard-core/simulate.sh` or `.html` after
the implementation exists) must demonstrate, against the REAL gateway +
adapter-websocket + dashboard package:

| Scenario | Sim must show |
|---|---|
| S1 open | page load → token minted (unique per load) → 4 snapshots render |
| S2 snapshot+live | panels populated from real caps; live event mutates a panel |
| S3 live | `session.create` via CLI → row appears without reload |
| S4 health | health panel refreshes on 30s cadence (or sim-compressed interval) |
| S5 down | gateway stop → banner + STALE → reconnect succeeds on restart |
| S6 terminal | revoked/expired token → auth.error 1008 → banner, no reconnect |
| S7 per-panel error | a denied cap shows `GATEWAY_*` verbatim in its panel |
| S8 drill-down | click a row → full record overlay from real data |
| S9 scroll/empty | >10 sessions → internal scroll; empty panel text |
| S10 wrappers | `dashboard.view.sessions` ≡ `session.list`; audit shows both rows |
| S11 server | `GET /` token-injected; `/assets/*` served; no data API |

The pre-impl sim (`simulate-pre.html`, hardcoded state) stays side-by-side
during the pipeline; reconciliation (Phase 6) collapses both into one
canonical sim.

## Technical Design

### Architecture

```
browser page (vanilla JS, adapter wire)
   │  ws://127.0.0.1:7300/ws
   ▼
adapter-websocket (SHIPPED)
   │  Gateway.handleInvocation()
   ▼
gateway-core ──registry── dashboard.view.* (extraOwnerHandlers, D2)
   │                  │  thin wrapper → internal dashboard-bot token
   │                  ▼
   │            backing caps: session.list / plugin.list /
   │            capability.list / system.health / gateway.status
   ▼
dashboard package (composition root wires it, kernel unaware)
   ├─ static server (127.0.0.1:7200, GET / + /assets/*)
   └─ token mint per GET / via gateway.issueToken (D4)
```

Dependencies point inward: the dashboard package depends on gateway-core's
public API + the adapter wire; gateway-core knows nothing about the dashboard
(additive seams only: session-less names + `extraOwnerHandlers` config + the
`dashboardPort` option on the agentide factory).

### Dependencies (additions)

- `@spanexx/dashboard-core` (new package) → `@spanexx/gateway-core`,
  `@spanexx/adapter-websocket` (wire schema types), `@spanexx/event-bus`
  (types only), `@spanexx/errors`.
- `@spanexx/agentide` (composition root) → `@spanexx/dashboard-core`; wires
  `extraOwnerHandlers` + `dashboardPort` when configured.

### Module layout (dashboard-core)

```
packages/dashboard-core/
  src/
    index.ts          — public API: createDashboardHandlers(gateway), DASHBOARD_CAPS
    server.ts         — static server (127.0.0.1:7200, GET / + /assets/*,
                        token mint per GET /)
    token.ts          — mint via gateway.issueToken (dashboard-bot,
                        platform.*.read, expectedOrigins both localhost forms)
    handlers.ts       — DASHBOARD_CAPS: dashboard.view.{sessions,plugins,
                        capabilities,health} — thin passthrough wrappers
    assets/
      index.html      — page shell (token injected server-side)
      app.js          — vanilla-JS WS client (adapter wire) + renderers
      theme.css       — dark theme, themed scrollbars
  src/__tests__/      — per-phase TDD
```

### Data models

- `DashboardViewCap`: `{ name: "dashboard.view.<view>", backing: "<cap.name>",
  sessionLess: true, tier: "read", permissions: ["platform.dashboard.read"],
  owner: "dashboard", type: "platform" }` × 4.
- `DashboardConfig`: `{ dashboardPort?: number (default 7200), tenantId,
  gateway: Gateway }` — additive to the agentide factory config.
- Minted token: callerId `dashboard-bot`, scope `["platform.*.read"]`,
  `expectedOrigins: ["http://localhost:7200","http://127.0.0.1:7200"]`,
  default 1h TTL, memory-only page injection.

### Wire contract (page ↔ adapter)

The page speaks the adapter wire exactly (W2 Q1/W4 — already shipped):
`auth {token}` / `auth.ok` / `auth.error {code,message}`; `invoke {id,
capability:{name}, input, mode:"call"}` / `invoke.result {id, output}` /
`invoke.error {id, code, message}`; `subscribe {topics}` / `event {topic,
payload}`. Topics subscribed: `session.*`, `plugin.*`, `capability.*`.
Health polls `gateway.status` every 30s instead (no `system.*` producers).

### Security (Security Is Architecture)

- Token: read-only `platform.*.read`, ≤1h, origin-bound (expectedOrigins,
  enforced at the adapter door), memory-only, self-hosted localhost —
  accepted residual risk, documented (D4 lock).
- Mint per page load server-side; no token in localStorage; refresh = reload.
- Double audit on every view read (inner backing cap + outer dashboard cap).

### State & error model (Q9)

Connection states: `connecting → connected → down (reconnecting) → terminal`.
Panel states: `live | stale | error(<GATEWAY_* verbatim>) | empty`.
Banners: gateway-down (with backoff state) / token-expired ("reload the page").

## Notes

- Pre-impl sim feedback folded in: drill-down overlay (S8), internal panel
  scroll + themed scrollbars (S9) — both user-approved 2026-08-06.
- Port guard: adapter-websocket must NOT take 7200 (locked D3; adapter port
  is 7300 — no conflict).
- Drift links: D-45/D-46/D-50 closed (prerequisites); D-47/48/49 stay open —
  the four deferred views graduate per future.md, not in this pack.
- CONTEXT.md: add the `dashboard.view.*` namespace + `dashboard-bot` identity
  terms on implementation (standing grill rule).
