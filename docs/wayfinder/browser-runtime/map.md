# browser-runtime — Wayfinder map

> **Map title:** browser-runtime — finding the way to a shipped
> `@platform/browser-runtime` Runtime Plugin.
>
> **Status:** charting complete (0/7 tickets closed). Live tracker:
> this file + the 7 child ticket files.

## Destination

`@platform/browser-runtime` shipped as a v1 Runtime Plugin: an
execution engine that launches a Chromium browser process, gives each
session its own isolated `BrowserContext`, and executes the
`browser.*` capability family (launch, navigate, click, type, scroll,
wait, screenshot, close) plus tab management (`browser.tab.*`). The
package lives in `packages/browser-runtime/`, registers via a Runtime
Manifest (`runtime: { id: browser }`), and dispatches in-process
through the Gateway (`plugin:browser` owner). Per Wayfinder's
planning-not-doing default, tickets resolve decisions; the build
happens via `delivery: feature-pipeline` once the way is clear.

## Notes

- **Domain:** AI agent platform. An agent drives a real browser
  through the Gateway: `browser.navigate` to a page, `browser.click`
  / `browser.type` to act on it, `browser.screenshot` to observe.
  `@platform/sdk-browser` (shipped) rides inside the page and
  registers the page's *structured* capabilities; `browser-runtime`
  executes the *low-level* browser primitives. Tightly coupled pair —
  see sdk-browser map, T7 boundary doc.
- **Locked in chart grill (2026-08-02):**
  - Engine: **Playwright v1**. CDP (raw) is version 2, alongside a
    planned Rust rebuild of the system — future effort, out of scope.
  - `browser.launch` is an **explicit capability** (not implicit
    auto-launch).
  - Tab management uses a **`browser.tab.*` sub-namespace**
    (tab.open / tab.switch / tab.close).
  - Session isolation: **one Chromium process, one BrowserContext per
    session**. BrowserContext gives full cookie/storage/cache
    isolation without the cost of a browser process per session.
    Session end (timeout or explicit close) → `session.closed` →
    browser-runtime closes the context + all tabs; nothing leaks.
  - Package: `packages/browser-runtime`, `@platform/browser-runtime`.
  - Observability: v1 ships **headless AND human-observable** (both).
    What "human observe" means and where it stops vs `dashboard-core`
    (BI[13]) is a ticket below.
- **Reuse from shipped packs:** `session-manager` (session.closed
  cleanup event, resource tracking), `sdk-browser` (page-side
  introspection, coupling question open), `permission-tiering`
  (capability tiers — `browser.screenshot` = read, `browser.navigate`
  = act per CONTEXT.md), `gateway-plugin-dispatch` + `plugin-manager`
  (in-process `plugin:<id>` dispatch via dynamically imported
  handler, Plugin Manifest), `backend-runtime` (wire protocol,
  error-mapping matrix).
- **Standing preferences:** Wayfinder default mode (plan, don't do).
  Self-hosted Gateway assumed. No marketplace, no dev portal, no
  Chrome DevTools integration (#14). Dashboard-core streaming (BI[13])
  is a separate effort.
- **Assumed already shipped:** `gateway-core`, `capability-registry`,
  `event-bus`, `session-manager`, `plugin-manager`,
  `platform-capabilities`, `permission-tiering`, `sdk-node`,
  `backend-runtime`, `gateway-plugin-dispatch`, `sdk-browser`. Map
  invalidates if any of these reopens a settled question that affects
  the choices above.
- **Truthfulness:** if a ticket resolution contradicts another open
  ticket or a decision already settled, update *the map and the
  affected tickets*, not just the answer. Drift logs go in
  `docs/drift.md` per the project standard.
- **Standing grill rule:** every locked Q appends to
  `docs/CONTEXT.md` Decisions Log + posts a progress note on the
  ticket. Plain-English analogy: browser-runtime is the "remote
  control" (launch/point/click), sdk-browser is the "instrument
  panel" inside the page (structured readings).

## Open Tickets (frontier)

| # | Ticket | Type | Blocks |
|---|---|---|---|
| 1 | Engine and browser lifecycle research | `research` ✅ closed | Capability contracts |
| 2 | Capability contracts | `grilling` | Screenshot payload, sdk-browser coupling, suspend/resume, browser.wait |
| 3 | Screenshot payload | `grilling` | Human observability |
| 4 | sdk-browser coupling after navigate | `grilling` | — |
| 5 | BrowserContext suspend/resume | `grilling` | — |
| 6 | browser.wait semantics | `grilling` | — |
| 7 | Human observability in v1 | `prototype` | — |

**Frontier (open + unblocked):** Capability contracts (T2).
Everything else is blocked until Capability contracts resolves.

## Decisions so far

- [**Engine and browser lifecycle research**](tickets/engine-and-browser-lifecycle-research.md)
  (T1, closed 2026-08-02) — Playwright v1: `chromium.launch({ headless })`
  shared browser by default, lazily spawned headed browser only on
  demand (one build serves all modes; headed needs Xvfb on servers);
  per-cap API mapping (goto/locator.click/locator.fill/mouse.wheel/
  page.screenshot/context.newPage/bringToFront); **driver-first rule:**
  thin plain-data `BrowserDriver` interface, zero Playwright types in
  capability contracts — the v2 CDP/Rust swap rides on this; prod
  deps `playwright-core` + `@playwright/browser-chromium`, exact-pin;
  lifecycle via `browser.on('disconnected')` + auto-relaunch,
  `context.close()` on `session.closed`, zombie-prevention exit
  handler.

## Not yet specified

- **Browser binary management** — how/where Playwright browsers get
  installed (download at plugin install? system Chrome? version
  pinning). Likely graduates from the Engine research ticket.
- **Concurrency limits** — one Chromium process, many
  BrowserContexts: caps on simultaneous sessions/contexts, memory
  pressure handling.
- **Crash recovery** — what happens when the browser process dies
  mid-session: error surfaced to in-flight invocations, context
  state, retry semantics.
- **Network/proxy isolation** — per-context proxy or interception
  needs beyond defaults.

## Out of scope

- **CDP (raw) engine + Rust rebuild** — version 2 of the engine;
  future effort, returns only as a fresh map. (User: "eventually we
  will use RUST to rebuild the system so put CDP as version 2".)
- **Dashboard-core streaming** (BI[13]) — live screenshot/video
  streams to a dashboard; dev tooling, not agent interaction.
- **Chrome DevTools integration** (backlog #14).
- **Plugin-marketplace listing** of browser-runtime.
