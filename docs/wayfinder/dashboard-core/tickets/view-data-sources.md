# D5 — View data sources: which shipped caps/events back each §14 view

**Type:** `wayfinder:research` (AFK)
**Status:** **closed** (resolved 2026-08-03 via research subagent; findings below)
**Blocks:** D1 (view scope)

## Question

For each of the 8 Agentide §14 views — Active Sessions, Browser Instances,
Installed Plugins, Registered Capabilities, Runtime Health, Metrics, Logs, Errors
— which *shipped* read-tier capability and/or event-bus topic can serve it in v1?

D1 (view scope) cannot be grilled until this fact is on the table.

## What to research

- The read-tier platform caps shipped by `@platform/platform-capabilities`
  (25 caps: `session.*`, `plugin.*`, `capability.*`, `tenant.*`, `auth.*`,
  `gateway.*`, `system.*`): exact names, owners, permission strings, tier,
  session-required or session-less, and their return shapes.
- Event-bus topics emitted by shipped packages that could drive **live updates**
  per view: `session.*`, `plugin.*`, `capability.*`, `system.*`,
  `gateway.invocation`, `browser.*`, `sdk.*` — exact event names + payload shape.
- browser-runtime (`@platform/browser-runtime`, shipped 2026-08-02): which
  `browser.*` events exist (page loaded, instance created/destroyed, crash…),
  and whether any cap lists browser instances.
- What backs a **Logs** view: `audit.log` file shape (one JSON object per line,
  fields per CONTEXT.md Audit Log) vs `gateway.invocation` events vs anything
  else. Is there any log-read cap?
- What backs an **Errors** view: denied/errored invocations in audit records /
  `gateway.invocation` (`status: denied|error`), `event.handler_failed`, plugin
  `plugin.handler.error` — what exists.
- What `gateway.metrics` actually returns today (shape, scope).

## Resolution must record

A table: view → backing cap(s) (+ owner/tier/permission/session-less) → live
event topic(s) (+ payload) → gaps (views with no clean backing — candidates for
`dashboard.view.*` aggregation), with file:line cites. Post as resolution entry
in this ticket.

## Progress

**2026-08-03 — Resolved (research subagent, all facts verified against source).**
Per-view verdict matrix (full detail in the subagent report — key cites below):

| View | Backing cap (owner/tier/perm/session-less) | Output | Live events | Verdict |
|---|---|---|---|---|
| Sessions | `session.list` (session-manager / read / `platform.session.read` / session-less) | `[]` always — v1 stub (`factory.ts:322-327`) | `session.created/suspended/resumed/destroyed/cleanup_resources` (events.ts:31-60) | Events clean; **cap is a stub** |
| Browser Instances | **none** — `browser.query` is DOM query on ONE tab, not listing; session registry private Map, no enumeration | — | **browser-runtime publishes ZERO events** (only subscribes to session.*, lifecycle.ts:39-54) | **Gap — no backing** |
| Installed Plugins | `plugin.list` (plugin-manager / read / `platform.plugin.read` / session-less) | `InstallRecord[]` (types.ts:66-73) | `plugin.installed/updated/reloaded/uninstalled/enabled/disabled/cleanup`, `plugin.handler.error`, `plugin.handler.loaded{ok:false}` | **Clean** |
| Registered Caps | `capability.list` + `capability.describe` (capability-registry / read / `platform.capability.read` / session-less) | scope-filtered cards; **`[]` when caller has no scope** | `capability.registered/updated/removed` | **Clean** (scope-filter caveat) |
| Runtime Health | `system.health` `{status:"ok"}` + `system.info` `{name,version}` + `system.version` `{version,buildHash:null}` + `gateway.status` `{uptimeMs,tenantCount,pluginCount,status}` (all gateway owner, read, session-less) | static values only | none | **Clean** (snapshot-only) |
| Metrics | `gateway.metrics` (gateway / read / `platform.gateway.read` / session-less) | **placeholder zeros** `{invocations:{ok:0,denied:0,error:0},rateLimitDenials:0,authFailures:0}` (factory.ts:378-384) | none | **Gap — no real counters** |
| Logs | **none** — only `gateway.configuration` leaks the audit path; no CLI `logs` command | — | `gateway.invocation` = exact mirror of every audit line (AuditRecord, types.ts:91-107), emitted on EVERY exit path incl. denied/error | **Gap — file + events only** |
| Errors | **none** — no error-listing cap; 18 `GATEWAY_*` codes (packages/errors/src/index.ts:36-55) | — | `gateway.invocation` (status error/denied), `event.handler_failed`, `plugin.handler.error`, `sdk.invoke.failed` | **Gap — aggregate from gateway.invocation** |

Facts D1 depends on:
- **All read-tier discovery caps are session-less** (16-member set, handle-invocation.ts:46-63) — the dashboard's invokes need no session.
- `capability.list` scope-filters: token scope `platform.*.read` (read rank) sees all read-tier cards; `[]` only for no-scope callers (bootstrap `["*"]` sees all).
- `gateway.invocation` is the universal live spine: every invocation (ok/denied/error) → one event with AuditRecord payload. Backs Logs AND Errors live views.
- `gateway.metrics` placeholder zeros → Metrics view is snapshot-of-nothing today; real counters are a gateway-core change (would surface as drift if the view demands them).
- Browser Instances has ZERO shipped backing (no cap, no events, no enumeration) — D1 must decide: defer the view, or scope a `dashboard.view.browserInstances` + a gateway-side enumeration seam (a real change, not a wrapper).

Delivery: research ticket → `delivery: decision-only` (nothing to build from this ticket alone; it unblocks D1).
