# dashboard-core — Wayfinder map

> **Map title:** dashboard-core — finding the way to a shipped `@platform/dashboard`
> (BI[13], Tier 5 Visibility).
>
> **Status:** charting complete 2026-08-03 (destination locked via grill). Frontier
> ticketed below; each ticket resolves one decision, feature-pipeline executes after.
> Live tracker: this map + the child tickets under `tickets/`.

## Destination

`@platform/dashboard` shipped: the **web dashboard UI** (Agentide §14 "Task
Manager" — a first-class product) served by the dashboard package's own static
server, backed by **`dashboard.view.*` read caps** (thin in-process wrappers over
read-tier platform caps), with **all data flowing over adapter-websocket**
(`invoke` pull for current state, `subscribe` + `event` push for live updates),
using a **browser-held read-only origin-bound token**. Ships **after
adapter-websocket ships** (the adapter is the only door — locked Q2/Q3).

`delivery: feature-pipeline` — this is a full pack, not a small change, once the
route is clear.

## Notes

- **Domain:** AI agent platform, self-hosted visibility layer. Agentide §14 views:
  Active Sessions, Browser Instances, Installed Plugins, Registered Capabilities,
  Runtime Health, Metrics, Logs, Errors. §15: self-hosted install = Gateway,
  Session Manager, Plugin Manager, Dashboard.
- **The door is adapter-websocket, not a backdoor.** W1 REOPEN (2026-08-03) locked
  push + pull + adapter-level streaming + top-level subscribe on one socket for
  EVERY v1 client. `invoke{name, input, mode:"call"}` → `invoke.result` /
  `invoke.error`; `subscribe{topics}` → `event`. Dashboard is the demand-driver
  for pull. No HTTP data API — locked (Q2). The dashboard package serves ONLY
  static UI files over HTTP; data lives on the socket.
- **Cross-map dependencies (adapter map at `docs/wayfinder/websocket-adapter/`):**
  adapter's open W3 (subscription model), W4 (wire schema — 5 `invoke*` variants +
  correlationId), W6 (backpressure) feed our D2/D3 tickets as inputs. Charting runs
  in parallel NOW; **execution waits for the adapter to ship** (locked Q3). If any
  of those tickets reopens a settled question, update this map + affected tickets.
- **Data plane = in-process `dashboard.view.*` handlers** registered by the
  dashboard package via the `@platform/agentide` factory (D2: `DASHBOARD_CAPS`
  + `createDashboardHandlers(gateway)`, wired when `config.dashboardPort` set),
  each internally calling `Gateway.handleInvocation()` on the backing read cap
  with an internal `dashboard` token. **Session-less** (D2 revises Q2's
  "dashboard's session" — impossible + unnecessary; view names join the kernel
  session-less set). No aggregation layer, no stored state (D1).
- **Token:** read-only `dashboard-bot`, scope `platform.*.read` (covers
  `platform.dashboard.read` via the BI[6] wildcard), browser-held, origin-bound
  via the `expectedOrigins` claim (T5 Q2 + adapter W2 Q4 enforcement),
  localhost binding in v1. D2 REVISED Q2's literal `tier: "act"` +
  `permissions: ["read"]` (unshippable — rank-null in authz) → type platform,
  owner `dashboard`, `permissions: ["platform.dashboard.read"]`, tier `read`.
  D4: mint per page load in-process; `expectedOrigins` mint side missing →
  drift D-50 (High).
- **Kernel surface reused (no work needed there):** `Gateway.handleInvocation()`
  (canonical entry), event-bus topics `session.*`, `plugin.*`, `capability.*`,
  `system.*`, `gateway.invocation`, `browser.*` (D5 audits which exist),
  sdk-browser's origin-bound WS client pattern.
- **Sister maps (reference, not source-of-truth-for-unimplemented):**
  websocket-adapter (the door), browser-runtime (browser events for the Browser
  Instances view), application-entity, sdk-browser.
- **Standing preferences:** self-hosted single-tenant v1. Read-only everything —
  no write actions from the dashboard, ever, in v1. Plain HTML/JS UI unless D3
  grills otherwise (repo convention; sims precedent). Localhost binding. No new
  framework build step without a D3 lock.
- **Assumed already shipped:** gateway-core, capability-registry, event-bus,
  session-manager, plugin-manager, platform-capabilities, permission-tiering,
  sdk-node, sdk-browser, browser-runtime, backend-runtime, adapter-mcp,
  gateway-plugin-dispatch, gateway-sdk-dispatch, agentide. Map invalidates if any
  of these reopens a settled question.
- **Truthfulness:** if a ticket resolution contradicts another open ticket or a
  settled decision, update the map and the affected tickets, not just the answer.
  Drift goes in `docs/drift.md` per project standard.
- **Standing grill rule:** every locked Q appends to `docs/CONTEXT.md` Decisions
  Log + posts a progress entry on the ticket.

## Open Tickets (frontier)

| # | Ticket | Type | Blocks |
|---|---|---|---|
| D5 | View data sources: which shipped caps/events back each §14 view | `research` (AFK) | **closed** — D1 |
| D1 | View scope: which of the 8 §14 views ship in v1 | `grilling` (HITL) | **closed** — D2, D3 (unblocked) |
| D2 | `dashboard.view.*` cap shape: naming, tier, wrapper contract | `grilling` (HITL) | **closed 2026-08-03** (autonomous) — D3 |
| D4 | Token handling: mint, store, origin-bind, refresh | `grilling` (HITL) | **closed 2026-08-03** (autonomous) — D3 |
| D3 | UI shape: stack, layout, static server, live updates | `grilling` (HITL) | **closed 2026-08-03** (autonomous) — map DONE |

**The way is clear. Route: `delivery: feature-pipeline`** — execute
`@platform/dashboard` when adapter-websocket ships (locked Q3).
| D3 | UI shape: stack, layout, static server, live updates | `grilling` (HITL) | (impl) |

**Worked sequence** (when no parallel sessions are running):
D5 ✅ → D1 ✅ → (D2 ‖ D4) → D3 → done → feature-pipeline.

Adapter inputs: D2/D3 grilling consumes adapter W3/W4/W6 locks as they close —
charting does NOT block; execution does.

## Decisions so far

- 2026-08-03 — Q1 (grill, `GRILL-dashboard-core.txt`) — v1 = backend data plane
  only; web dashboard UI deferred to `future.md` in this dir. *Superseded by Q4
  (below) — UI moved back into v1.* Kept for the record; the route is Q4's.
- 2026-08-03 — Q2 (grill) — Data plane's only external surface is the **WS
  adapter** (`invoke` + `subscribe`/`event`). Views are thin in-process
  `dashboard.view.*` handlers calling `Gateway.handleInvocation()` internally,
  `tier: "act"` + `permissions: ["read"]`, dashboard-bot read-only token. **No
  separate read-only HTTP backdoor.** *(Cap-shape shorthand revised by D2
  below — real shape: platform type, owner `dashboard`,
  `permissions: ["platform.dashboard.read"]`, tier `read`; session-less.)*
- 2026-08-03 — Q3 (grill) — **Execution waits for adapter-websocket to ship**
  (the only door; nothing to consume before it). Charting runs in parallel now;
  adapter W3/W4/W6 decisions feed D2/D3.
- 2026-08-03 — Q4 (grill, revises Q1) — **Web dashboard UI moves INTO v1**:
  one feature-pipeline run instead of two; data plane alone is thin (no HTTP API,
  no aggregation, no stored state). Costs accepted: (a) browser-held token in v1
  (read-only, origin-bound, localhost), (b) dashboard package serves its own
  static UI page (HTTP GET page+assets only — no data API), (c) dashboard ship
  date = adapter ship date.
- 2026-08-03 — D1 (grilling, `tickets/view-scope.md`) — **CLOSED.** Acceptance
  bar: snapshot + live, both required. **v1 = 4 views:** Active Sessions
  (`session.list` fix = drift D-45), Installed Plugins, Registered
  Capabilities, Runtime Health (static — periodic refresh, D3 sets interval).
  **Deferred:** Metrics (D-46), Logs (D-47), Errors (D-48), Browser Instances
  (D-49) → `future.md`; each graduates only with a concrete consumer + fixed
  drift. No in-v1 view needs aggregation beyond a thin wrapper.
- 2026-08-03 — D2 (`tickets/view-cap-shape.md`) — **CLOSED** (autonomous, user
  delegation). `dashboard.view.<view>` × 4 caps: type platform, owner
  `dashboard`, `permissions: ["platform.dashboard.read"]`, tier `read` (REVISES
  Q2's `tier: "act"` + `permissions: ["read"]` — rank-null in authz,
  unshippable). Thin passthrough wrappers re-invoking `handleInvocation()` with
  an internal `dashboard` token (JWT required per call). **Session-less** —
  view names added to the kernel session-less set; session.create is a write
  cap so a dashboard session was impossible anyway. Double audit intended;
  `GATEWAY_*` passthrough. Kernel seams (additive): session-less names +
  generic `extraOwnerHandlers` config; kernel stays dashboard-agnostic.
- 2026-08-03 — D4 (`tickets/token-handling.md`) — **CLOSED** (autonomous, user
  delegation). Mint per page load in-process via operator `gateway.issueToken`
  (caller `dashboard-bot`, scope `platform.*.read`, `expectedOrigins:
  ["http://localhost:7200","http://127.0.0.1:7200"]`), token injected into the
  served page; memory only; 1h default; refresh = reload (adapter re-`auth`
  NOT used in v1). Enforcement already locked in adapter W2 Q4; **mint side
  missing → drift D-50 (High)** — in-pack work: `IssueTokenRequest`
  `expectedOrigins?: string[]` + CLI `--origin`/`--origins`. Leak posture:
  read-only ≤1h origin-bound, accepted + documented.
- 2026-08-03 — D3 (`tickets/ui-shape.md`) — **CLOSED** (autonomous, user
  delegation) — **map DONE.** Plain HTML/CSS/JS page; own static server
  `dashboardPort` 7200 (127.0.0.1, `GET /` + `/assets/*`, no data API —
  adapter is the only door; adapter must not take 7200). Page speaks the
  ADAPTER wire (`auth`/`invoke`/`subscribe`/`event`), NOT sdk-browser's
  `sdk.auth` wire. Open: connect → auth → 4 invokes → snapshots → subscribe
  `["session.*","plugin.*","capability.*"]` → live. Health polls
  `gateway.status` every 30s (`system.*` has no producers). Lifecycle:
  sdk-browser patterns as behavior precedent (backoff, pagehide, 1008
  terminal). States + error display per panel.

## Not yet specified

- **None.** All charted questions are locked (D5, D1, D2, D4, D3). Open items
  are IMPL details (adapter W4 wire shapes, panel visuals), not decisions.

## Out of scope

- **Chrome DevTools extension (BI[14]) and VS Code extension (BI[15])** — separate
  backlog items, separate maps. They can consume the same `dashboard.view.*` /
  socket surface later; building them is not this effort.
- **Write actions from the dashboard** (install/uninstall plugins, create/destroy
  sessions, `dashboard.*` write caps) — v1 is read-only by lock (Q2). Returns only
  if the destination is redrawn.
- **Hosted/multi-tenant dashboard** — v1 is self-hosted single-tenant (§15).
  A hosted dashboard is a fresh effort, not a resumption.
- **REST adapter (BI[10]) as the dashboard's transport** — ruled out in Q2: the
  WS adapter is the door; REST stays external for external callers.

## Future work

Deferred, demand-driven items live in `future.md` in this dir (`invoke.batch`
adoption, kernel-level streaming promotion, metrics history, extensions sharing
the surface).
