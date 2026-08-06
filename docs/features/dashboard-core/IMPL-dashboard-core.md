# IMPL: dashboard-core — `@platform/dashboard` (BI[13])

> **Status:** authored 2026-08-06 — feature-pipeline Phase 2.
> **Inputs:** `PRD-TRD-dashboard-core.md` (11 scenarios), locked GRILL Q1–Q9,
> map D1–D5, pre-impl sim `simulate-pre.html`.
> **Method:** strict TDD per phase — RED (one test via public interface) →
> GREEN (minimal code) → REFACTOR; full suite after every green.
> Production files stay < 350 lines (AGENTS.md rule 9).

## Phase map

| Phase | Deliverable | Tests (RED) | Deps |
|---|---|---|---|
| P1 | `dashboard-core` package skeleton + `DASHBOARD_CAPS` registry fixture + session-less registration seam in gateway-core | cap registers via `extraOwnerHandlers`; `dashboard.view.sessions` resolvable | gateway-core |
| P2 | Thin passthrough wrappers: re-invoke backing cap with internal `dashboard-bot` token; `GATEWAY_*` passthrough | wrapper output ≡ backing output; insufficient-scope → `GATEWAY_INSUFFICIENT_SCOPE`; double audit (inner + outer) | P1 |
| P3 | Token mint helper + static server (127.0.0.1:7200, `GET /` token-injected, `GET /assets/*`, 404 else) | mint: claims/scope/origins/1h; server: routes + injection; port guard | gateway-core |
| P4 | Page + vanilla-JS WS client (adapter wire) + 4 panel renderers | client sends auth/invoke/subscribe frames in order; renderers draw snapshot rows | P3 |
| P5 | Lifecycle + states: backoff 1→30s ±20%, pagehide, hidden→pause, 1008 terminal, banners, stale markers, per-panel `invoke.error` verbatim, empty texts, drill-down overlay, panel scroll | state machine transitions; terminal on 1008; pause on hidden; drill-down renders full record | P4 |
| P6 | agentide factory wiring: `config.dashboardPort` → register caps + start server; port conflict error | factory boots dashboard on 7200; caps live; agentide E2E (start → GET / → ws open) | P1–P5, agentide |

## P1 — Skeleton + registration seam

**RED:** gateway-core test — `createGateway({extraOwnerHandlers: {...}})` makes a
named cap resolvable + session-less (invoke without sessionId succeeds);
`dashboard-core` test — `DASHBOARD_CAPS` exports 4 records
(`dashboard.view.{sessions,plugins,capabilities,health}`, owner `dashboard`,
tier `read`, permissions `["platform.dashboard.read"]`, type `platform`,
session-less).

**GREEN:** gateway-core additive seam (session-less name set + generic
`extraOwnerHandlers` config — kernel stays dashboard-agnostic, per D2);
new `packages/dashboard-core` (package.json, tsconfig, vitest, src/index.ts
exporting `DASHBOARD_CAPS`).

**Check:** gateway-core + dashboard-core suites green; `precommit` clean.

## P2 — Thin passthrough wrappers

**RED:** gateway-core or dashboard-core test — invoking
`dashboard.view.sessions` with a valid token returns the backing
`session.list` output; token without `platform.dashboard.read` →
`GATEWAY_INSUFFICIENT_SCOPE`; audit log contains two rows (outer caller
+ inner `dashboard-bot`).

**GREEN:** `createDashboardHandlers(gateway)` — each handler calls
`gateway.handleInvocation()` on its backing cap with the internal
`dashboard-bot` token (minted once per gateway via `issueToken`,
`platform.*.read`); errors pass through unmodified (wrapper never rewrites
codes). Double audit falls out of the two invocations.

**Check:** P1 tests stay green; wrapper parity test (`dashboard.view.X` ≡
backing X) for all 4 caps.

## P3 — Token mint + static server

**RED:** `mintDashboardToken(gateway)` → claims match D4 (callerId
`dashboard-bot`, scope `["platform.*.read"]`, `expectedOrigins`
`["http://localhost:7200","http://127.0.0.1:7200"]`, exp ≈ now + 1h);
`createDashboardServer({port: 7200, mintToken})` → `GET /` 200 with token
injected in page markup, `GET /assets/app.js` 200, `GET /other` 404; binds
127.0.0.1; `dashboardPort` conflict (port taken) → startup error with clear
message.

**GREEN:** `server.ts` (node:http, 127.0.0.1), `token.ts`; `assets/index.html`
shell (header + 4 panels + detail overlay + log strip — the approved sim
markup, token placeholder `__AGENTIDE_TOKEN__`), `assets/theme.css`
(scrollbar theming), `assets/app.js` stub (P4 fills it).

**Check:** server tests with real sockets on a free port; mint tests assert
claims via `verifyToken`.

## P4 — Page + WS client + renderers

**RED:** unit tests for the client state machine (documented as pure
functions where feasible): `sendAuth`, `sendInvoke`, `sendSubscribe` frame
shapes match the adapter wire (W4); renderers: snapshot rows, tier badges,
status colors, empty text per panel (pure DOM builders).

**GREEN:** `assets/app.js` — connect → auth → 4 invokes (mode `call`) →
snapshots → subscribe `["session.*","plugin.*","capability.*"]`; renderers
draw all four panels; drill-down overlay data wiring (AC-8.1/8.2); panel
scroll containers (AC-9.1/9.2). WS URL from page origin host + port 7300/ws.

**Check:** `node --check` on app.js; DOM builder tests; manual open of
`GET /` page against a live gateway (agentide start --port-sdk …).

## P5 — Lifecycle + states

**RED:** state machine tests: unexpected close → `down` + backoff schedule
(1,2,4,…,30 ±20% jitter); `pagehide` → deliberate close; `visibilitychange`
hidden → pause; `auth.error`/close 1008 → `terminal` (no reconnect); banner
+ stale marker toggles; per-panel `invoke.error` verbatim rendering.

**GREEN:** backoff module in app.js; banner/stale wiring; per-panel error
state; empty states; token-expired banner text (verbatim `auth.error`
message). Terminal state also triggers on origin mismatch text.

**Check:** state machine tests; manual gateway-stop/restart against live
gateway; 30s health poll (interval read from a const — sim-compressible).

## P6 — agentide factory wiring

**RED:** agentide E2E — `agentide start --dashboard-port 7200` (or config
default): `GET http://127.0.0.1:7200/` returns page with token;
`invoke dashboard.view.sessions` over the WS door returns records; port
conflict → clean error. Port 7200 reserved (guard test).

**GREEN:** agentide factory `config.dashboardPort` → `createDashboardServer`
+ `createDashboardHandlers` wired via the P1 seam; start/stop lifecycle
joined to the gateway.

**Check:** full agentide suite; manual smoke: start → open page → sessions
live-update on `session.create`; `agentide capabilities` shows
`dashboard.view.*` (40+4 caps).

## Post-impl sim

`docs/features/dashboard-core/simulate.sh` (or `.html` variant driving the
real packages — per interconnected-simulation conventions) demonstrating
every PRD-TRD Simulation Contract row (S1–S11) against the real gateway +
adapter-websocket + dashboard package. Side-by-side with `simulate-pre.html`
until reconciliation.

## Drift check + reconciliation

- Spawn `feature-pipeline-review` sub-agent (fresh eyes) → `.reports/`
  gap report; settle gaps with the user (fix code / update docs / log drift).
- Reconcile: collapse `simulate-pre.html` + post-impl sim into one canonical
  sim; archive the pre-impl.
- `update-backlog`: BI[13] → SHIPPED; CONTEXT.md terms
  (`dashboard.view.*`, `dashboard-bot`); drift log close-outs if any.

## Risks / notes

- Adapter wire is SHIPPED — frame shapes from `adapter-websocket` W4 are the
  source of truth; the page client must match, not invent.
- Session-less set: adding 4 names is additive; existing tests that assert
  the exact session-less set will need updating (flag them in P1).
- `system.health` exists; `gateway.status` is the 30s poll target (D5).
- Server tests must use ephemeral ports (7200 is the default but tests pick
  free ports; the port-conflict test uses a pre-bound socket).
- app.js stays < 350 lines; if the client grows past it, split into
  `assets/wire.js` (client) + `assets/render.js` (DOM) + `assets/app.js`.
