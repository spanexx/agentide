# browser-runtime — Wayfinder map

> **Map title:** browser-runtime — finding the way to a shipped
> `@platform/browser-runtime` Runtime Plugin.
>
> **Status:** charting complete (7/7 tickets closed). Way is clear
> → next: `delivery: feature-pipeline` for the package build.
> Live tracker: this file + the 7 child ticket files.

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
| 2 | Capability contracts | `grilling` ✅ closed | — |
| 3 | Screenshot payload | `grilling` ✅ closed | — |
| 4 | sdk-browser coupling after navigate | `grilling` ✅ closed | — |
| 5 | BrowserContext suspend/resume | `grilling` ✅ closed | — |
| 6 | browser.wait semantics | `grilling` ✅ closed | — |
| 7 | Human observability in v1 | `prototype` ✅ closed | — |

**Frontier (open + unblocked):** none — all tickets closed; the way
is clear. Route: feature-pipeline for the package build.

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

- [**Capability contracts**](tickets/capability-contracts.md)
  (T2, closed 2026-08-02) — 12 caps' contracts locked (11 from T2 +
  `browser.query`, F8), plain data only: CSS-only selectors; numeric
  `tabId` (first tab 0, optional everywhere, default
  most-recently-active); per-cap input/output shapes (see ticket
  table); instance disambiguation in v1 (F8: `browser.query` counts +
  addresses matches, `instance` param on click/type, ambiguous
  click/type → `BROWSER_SELECTOR_AMBIGUOUS`); `BROWSER_*` error codes
  pass through the `GATEWAY_HANDLER_ERROR` envelope; retryable
  policy = timeout/race retryable (`BROWSER_WAIT_TIMEOUT`,
  `BROWSER_SELECTOR_NOT_FOUND/TIMEOUT`, `BROWSER_NAVIGATION_TIMEOUT`,
  `BROWSER_LAUNCH_FAILED`), misuse not (`BROWSER_NO_CONTEXT`,
  `BROWSER_ALREADY_LAUNCHED`, `BROWSER_TAB_NOT_FOUND`,
  `BROWSER_CLOSED`, `BROWSER_NAVIGATION_FAILED`,
  `BROWSER_SELECTOR_AMBIGUOUS`); screenshot input locked, output
  deferred to T3.

- [**Screenshot payload**](tickets/screenshot-payload.md)
  (T3, closed 2026-08-02) — inline base64 first, session Resource
  over 256 KiB cap (context protection: 256 KiB ≈ 85k tokens worst
  case inline; over cap the image never enters the response);
  discriminated return `{ format, mode: 'inline'|'resource', data?,
  resourceId?, bytes }`, audit logs shape only; input extended
  `{ tabId?, fullPage?, format?, quality?, mode? }` (mode default
  auto); forced inline + oversize → `BROWSER_SCREENSHOT_TOO_LARGE`
  retryable false; resources session-owned, `session.cleanup_resources`
  cleanup (AUDIT F10: shipped event is `session.cleanup_resources`,
  not `session.closed`).

- [**sdk-browser coupling after navigate**](tickets/sdk-browser-coupling-after-navigate.md)
  (T4, closed 2026-08-02) — navigate is the sync point: output
  `{ tabId, url, capabilities, capsSettled }`; settle detection =
  DOM-read at navigate (Playwright evaluate counting `[data-sdk-cap]`
  — shipped CAP_ATTR; stability re-read; AUDIT F11: the SDK's
  "caps registered" event fires on a page-local bus, invisible to the
  gateway — "event-bus, per session" reversed), timeout → empty caps + `capsSettled: false`, never an error (plain pages are
  legitimate); tab-scoped caps live in browser-runtime's per-tab snapshot
  (F9 revision: the shipped registry keys by name+version and cannot hold
  per-tab cards — `capability.list({ tabId })` served by the runtime,
  registry untouched); re-read via re-navigate or filtered list; **destructive-navigate guard
  (F7, feature-pipeline): different-url navigate on a caps-bearing tab →
  `BROWSER_NAVIGATION_DESTRUCTIVE` (retryable false) — use `newTab:
  true`; same-url re-navigate stays allowed**; `browser.page.read` ruled
  out. Known limitation (F12): two tabs of the same app evict each
  other at the gateway (backend-runtime single-slot per appId) — v1
  non-goal, invisible to the agent via the per-tab snapshot. Agent loop (sdk-browser T1) now has its sync point.

- [**BrowserContext suspend/resume**](tickets/browsercontext-suspend-resume.md)
  (T5, closed 2026-08-02, resolved autonomously — user delegated
  with review) — suspend keeps context + Chromium process alive
  (session-manager contract already promises resource retention);
  one listener, three events (`session.suspended`/`resumed` = no-ops,
  `session.destroyed` = teardown — AUDIT F10: shipped event name,
  `session.closed` does not exist; resource purge via
  `session.cleanup_resources`); trust gateway resume-first (Flow 2
  step 6) — no `BROWSER_SUSPENDED`, mid-call archive → `BROWSER_CLOSED`;
  memory cost accepted (~150–300 MB idle), keep-alive knob is a v2
  candidate; resume transparent to agent (no flag, no new cap).

- [**browser.wait semantics**](tickets/browser-wait-semantics.md)
  (T6, closed 2026-08-02) — waits for a condition AND has a
  fixed-duration mode. Input = discriminated union:
  `{ wait: 'selector', selector, state?, timeout? }` (state:
  `visible | attached | hidden`) OR `{ wait: 'time', ms }`. Default
  timeout 30s, per-call override capped at 120s; duration mode has no
  timeout interplay. Timeout → error `BROWSER_WAIT_TIMEOUT`,
  `retryable: true`; final error codes named in Capability contracts
  (T2).

- [**Human observability in v1**](tickets/human-observability-in-v1.md)
  (T7, closed 2026-08-02, resolved autonomously — user delegated
  with review; prototype built at
  `prototypes/browser-runtime-human-observability/`, 3 shapes) —
  v1 ships **shape A: The window** — human observability = headed
  mode (T1 mode pool) + screenshot-on-demand (T3 cap); zero new
  surface. No snapshot console (dashboard sentence → BI[13]), no
  event surface (console/nav/pageerror feed = BI[13]'s logs). Both
  human and agent use the same `browser.*` caps; the human path adds
  a headed window. Streaming/recording/remote-viewing/event
  persistence/cross-session views → dashboard-core (BI[13]); Chrome
  DevTools (#14) stays out. Remaining fog (binary management,
  concurrency, crash recovery, proxy) rode into the feature-pipeline
  GRILL and is RESOLVED — see GRILL-browser-runtime.txt Q1–Q4
  (2026-08-02): @playwright/browser-chromium dep, no hard concurrency
  cap (documented guidance), BROWSER_CRASHED retryable:true,
  Playwright default network.

## Not yet specified

- *(None — all fog resolved in the feature-pipeline GRILL, 2026-08-02.
  Cross-pack tabId filter on capability.list (T4) lands in the same
  pipeline per GRILL Q5.)*

## Out of scope

- **CDP (raw) engine + Rust rebuild** — version 2 of the engine;
  future effort, returns only as a fresh map. (User: "eventually we
  will use RUST to rebuild the system so put CDP as version 2".)
- **Dashboard-core streaming** (BI[13]) — live screenshot/video
  streams to a dashboard; dev tooling, not agent interaction.
- **Chrome DevTools integration** (backlog #14).
- **Plugin-marketplace listing** of browser-runtime.
