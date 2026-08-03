# D1 — View scope: which of the 8 §14 views ship in v1

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-03; Q1–Q2 locked)
**Blocks:** D2 (cap shape), D3 (UI shape) — both now unblocked

## Question

Agentide §14 lists 8 views: Active Sessions, Browser Instances, Installed
Plugins, Registered Capabilities, Runtime Health, Metrics, Logs, Errors. Which
ship in v1, which go to `future.md`, and what is the acceptance bar for a view
to be "in"?

## Context (from the map + D5)

- Backlog BI[13] names: active sessions, installed plugins, registered
  capabilities, runtime health, logs, metrics.
- D5 will audit the shipped caps/events per view — grill with that table open.
- Q2 lock: every view rides `dashboard.view.*` thin wrappers; no stored state
  unless this ticket decides otherwise.
- Q4 lock: UI is in v1 — the views a v1 dashboard shows ARE the v1 scope.

## Sub-questions

1. Which views must be in v1 for the dashboard to be "the Task Manager"
   (Section 14 first-class framing)? Which can wait?
2. Per view: does it need a cap only, events only, or both (snapshot + live)?
   (Fold D5 facts in.)
3. **Logs** and **Errors**: are they views in v1 or derived rows inside another
   view? (Their data source is audit records — see D5.)
4. **Browser Instances**: in v1 or future? (browser-runtime shipped — but see
   D5 on what events exist.)
5. Acceptance bar: every in-v1 view must have a snapshot source AND a live-update
   story on the socket. Views without one of the two are deferred — confirm.

## Resolution must record

The locked view list (in / deferred, one line each), the acceptance bar, and any
view that needs aggregation beyond a thin wrapper. `delivery:` tag is set here
only if the answer itself ends the map (it won't — D2/D3 remain).

## Progress

**2026-08-03 — Q1 (acceptance bar) LOCKED:** snapshot + live, both required.
Every in-v1 view needs (a) a snapshot source (fetch state on load) AND (b) a
live-update story on the socket. Missing either half → deferred to `future.md`.
Sessions snapshot gap (stub `[]`) logged as **drift D-45 (High)** — fix
`session.list` before dashboard executes. GRILL Q5 entry appended.

**2026-08-03 — Q2 (view list) LOCKED — RESOLUTION:**

**In v1 (4 views):**
- **Active Sessions** — snapshot: `session.list` (fix D-45 — real impl, not
  the `[]` stub); live: `session.*` events (created/suspended/resumed/destroyed).
- **Installed Plugins** — snapshot: `plugin.list`; live: `plugin.*` events.
- **Registered Capabilities** — snapshot: `capability.list` + `describe`;
  live: `capability.*` events.
- **Runtime Health** — snapshot: `system.health` + `system.info` +
  `system.version` + `gateway.status`; live: none (static values) — needs a
  periodic refresh on the socket (D3 decides interval).

**Deferred to `future.md` (4 views, each a logged drift):**
- **Metrics** (D-46 — `gateway.metrics` placeholder zeros; real counters needed)
- **Logs** (D-47 — no read cap; audit file + `gateway.invocation` only)
- **Errors** (D-48 — no listing cap; aggregate from `gateway.invocation`)
- **Browser Instances** (D-49 — zero backing: no cap, no events, no enumeration)

**Acceptance bar:** snapshot + live, both required; deferred views return only
when a concrete consumer exists AND their drift is fixed. **No in-v1 view needs
aggregation beyond a thin wrapper** — all four are thin `dashboard.view.*`
handlers. Backlog row BI[13] desc updated to match.

_Note: Logs/Errors as views vs derived rows (sub-Q3) and Browser Instances
in/future (sub-Q4) are answered by the deferral: they graduate from
`future.md` as standalone views when their drift closes; derived-rows is an
open question for that future run, not v1._
