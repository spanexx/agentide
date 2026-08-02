# IMPL: Browser Runtime

**Slug:** browser-runtime
**Status:** Draft
**Date:** 2026-08-02

## Phase Plan

**Before Phase 1:** opensrc findings recorded in Dependency Analysis below
(Playwright 1.62.1).

### Phase 1: Envelope extension (AUDIT F10 — approved by user)

**Build:**
- `packages/plugin-manager/src/index.ts` — in the handler-throw wrap
  (`PLUGIN_HANDLER_ERROR`): preserve `originalErrorCode` + `retryable` in
  details **when the thrown error carries them** (duck-typed check, e.g.
  `typeof (e as any)?.code === "string" && typeof (e as any)?.retryable === "boolean"`).
  Additive — no existing details key renamed.
- `packages/gateway-core/src/dispatch.ts` — `translatePluginError`: pass
  `originalErrorCode` + `retryable` through into `GATEWAY_HANDLER_ERROR`
  details when present.
- Tests: plugin-manager + gateway-core unit tests asserting the two new
  details keys survive the wrap when present, and that errors WITHOUT the
  fields behave exactly as before (backward compat).

**Verify:**
- [ ] `pnpm --filter @platform/plugin-manager test` + gateway-core tests green
- [ ] Old-shape handler errors (plain Error) still yield identical envelopes (no `originalErrorCode` key)
- [ ] Browser-shaped errors (`Error` with `code: "BROWSER_WAIT_TIMEOUT"`, `retryable: true`) surface `details.browserCode` + `details.retryable: true` at the caller

**Blocked by:** nothing

### Phase 2: Package scaffold

**Build:**
- `packages/browser-runtime/package.json` — `@platform/browser-runtime`,
  deps: `@playwright/browser-chromium` (exact-pin `1.62.1`),
  `playwright-core` (`1.62.1`), `@platform/errors` workspace:*; devDeps
  per sibling convention; scripts build/test/lint/typecheck
- `packages/browser-runtime/tsconfig.json` — extends base, references
  `../errors`
- `packages/browser-runtime/manifest.yaml` — runtime plugin manifest:
  `runtime: { id: browser, entry: ./dist/index.js }`, version, all 12 caps,
  **explicit tiers for `launch` (act), `screenshot` (read), `close`
  (destructive), `tab.close` (destructive)** — audit Finding 9; remaining
  caps may rely on convention (navigate/click/type/scroll/wait/query →
  read/act inferred; `tab.open`/`tab.switch` = act)
- `packages/browser-runtime/src/types.ts` — plain-data `BrowserDriver`
  interface (driver-first, T1), per-tab state, session state, error
  payloads; `<350 lines/file` rule

**Verify:**
- [ ] `pnpm install` succeeds; `@playwright/browser-chromium@1.62.1` exact in lockfile
- [ ] `tsc --build` passes; `pnpm --filter @platform/browser-runtime lint` clean
- [ ] manifest parses via plugin-manager `parseManifest` + `tierFromConvention` yields the 4 explicit tiers

**Blocked by:** Phase 1 (manifest cap names unchanged, but envelope tests run first)

### Phase 3: Lifecycle core — launch, close, tabs

**Build:**
- `src/driver.ts` — Playwright adapter implementing `BrowserDriver`:
  chromium.launch (mode pool: default headless, lazy headed), one
  context per session, `browser.on("disconnected")` → mark dead
- `src/session.ts` — per-session state machine: `{ launched, mode,
  context, tabsById, activeTabId, nextTabId, dead }`; launch seeds
  `nextTabId = 1` (F1 — tab 0 exists at launch, ids never reused per
  context; fresh context after relaunch resets counter)
- `src/handlers.ts` — handler map `{ [cap]: async (input, ctx) => result }`
  (plugin dispatch shape, audit Finding 10): `browser.launch`
  (BROWSER_ALREADY_LAUNCHED / BROWSER_LAUNCH_FAILED retryable:true),
  `browser.close` ({tabId} = tab-only, omitted = context teardown —
  never kills shared process; F3), `browser.tab.open` / `browser.tab.switch`
  / `browser.tab.close`
- `src/errors.ts` — `BrowserError extends Error` with `code` +
  `retryable` fields (feeds Phase 1 extension); BROWSER_* code constants +
  retryable table from capability-contracts.md

**Verify:**
- [ ] Unit tests: launch → tab 0 exists, second launch errors
  `BROWSER_ALREADY_LAUNCHED`; tab.open returns ascending unique ids;
  tab.switch changes active; close {tabId} keeps context; close without
  tabId tears down
- [ ] Launch errors carry `code` + `retryable` fields (Phase 1 contract)

**Blocked by:** Phase 2

### Phase 4: Navigation + caps snapshot + guard

**Build:**
- `src/handlers.ts` — `browser.navigate`:
  - F2: target existing tab (default most-recently-active), never
    auto-open; `newTab: true` opens fresh tab (F1 counter)
  - F7 guard: tab has registered caps AND different url →
    `BROWSER_NAVIGATION_DESTRUCTIVE` (retryable:false); same-url and
    plain tabs pass
  - waitUntil: load | domcontentloaded | networkidle; timeout →
    `BROWSER_NAVIGATION_TIMEOUT` (retryable:true); bad URL/DNS/TLS →
    `BROWSER_NAVIGATION_FAILED` (retryable:false)
  - Output `{ tabId, url, capabilities, capsSettled }` (T4 sync point)
- `src/snapshot.ts` — per-tab cap snapshot (Q5-revision): captured at
  navigate; DOM-read settle (F11): `page.evaluate` counting
  `[data-sdk-cap]` (shipped CAP_ATTR), stability re-read (read → short
  wait → read; stable → `capsSettled: true`), settle-timeout →
  return-so-far with `capsSettled: false`
- `src/handlers.ts` — `capability.list({ tabId })` answered from snapshot
  (Q5/F9: registry untouched; no-arg passes through)

**Verify:**
- [ ] navigate on occupied tab replaces page (no new tab), returns
  `{tabId, url, capabilities, capsSettled}` with real `data-sdk-cap`
  counts on a fixture page
- [ ] F7 guard fires on different-url navigate with caps; same-url
  re-navigate OK; `newTab: true` OK
- [ ] DOM-read settle: fixture page with delayed cap injection →
  capsSettled:true after stability; never-appearing caps → capsSettled:false
  after timeout
- [ ] `capability.list({ tabId })` returns per-tab snapshot; no-arg list
  unchanged

**Blocked by:** Phase 3

### Phase 5: Interaction caps — query, click, type, scroll (F8)

**Build:**
- `src/handlers.ts`:
  - `browser.query { selector, tabId? }` → `{ matches, addresses }`;
    address algorithm: pid-anchored (`[data-pid="X"] <selector>`) when
    the match has an ancestor with a data attribute, else nth-of-type;
    `matches: 0` = result, never error
  - `browser.click { selector, tabId?, instance?, button? }` +
    `browser.type { selector, text, tabId?, delayMs?, instance? }` —
    `instance` 1-based nth-match; >1 matches without instance →
    `BROWSER_SELECTOR_AMBIGUOUS` (retryable:false); not found →
    `BROWSER_SELECTOR_NOT_FOUND` (retryable:true), timeout →
    `BROWSER_SELECTOR_TIMEOUT` (retryable:true)
  - `browser.scroll { direction, px?, tabId?, selector? }` —
    selector: scrollIntoViewIfNeeded; px: wheel; default: down one viewport
- Address reuse: query output usable verbatim as click/type selector

**Verify:**
- [ ] Fixture page (3 `.add-cart` on `data-pid` rows): query → 3
  addresses; click without instance → AMBIGUOUS; `instance: 2` clicks
  the pid-202 row only
- [ ] 0-match query → `{ matches: 0, addresses: [] }` (no error)
- [ ] click/type with query-derived address works verbatim

**Blocked by:** Phase 4

### Phase 6: Wait + screenshot (T6, T3)

**Build:**
- `src/handlers.ts` — `browser.wait`: selector mode (30s default, 120s
  cap, BROWSER_WAIT_TIMEOUT retryable:true) + time mode
- `src/handlers.ts` — `browser.screenshot { tabId?, fullPage?, format?,
  quality?, mode? }`:
  - ≤256 KiB raw → inline base64 `{ format, mode:'inline', data, bytes }`
  - >256 KiB or forced `mode:'resource'` → write session resource dir,
    `{ format, mode:'resource', resourceId, bytes }`
  - forced inline + oversize → `BROWSER_SCREENSHOT_TOO_LARGE`
    (retryable:false)
  - audit-safe: log shape only (`{mode, bytes, format}`)

**Verify:**
- [ ] Small viewport screenshot → inline mode, base64 decodes to ≤256KiB
- [ ] Oversized (fullPage on tall fixture) → resource mode with
  resourceId; file exists in session dir
- [ ] `mode:'inline'` forced on oversized → BROWSER_SCREENSHOT_TOO_LARGE
- [ ] wait: selector never appears → BROWSER_WAIT_TIMEOUT after
  shortened timeout; `wait: 'time'` sleeps then `{ waited: true }`

**Blocked by:** Phase 5

### Phase 7: Crash recovery + session lifecycle (Q4, T5, F10)

**Build:**
- `src/session.ts` — `browser.on('disconnected')` → `dead: true`;
  next `browser.launch` auto-relaunches fresh context (counter reset, F1)
- `src/lifecycle.ts` — one event-bus listener, three events:
  `session.suspended`/`session.resumed` → no-op (keep alive),
  `session.destroyed` → close context + process exit (D-42: real event
  names — `session.closed` does not exist); `session.cleanup_resources`
  → purge screenshot resource files; zombie exit handler
- `src/index.ts` — exports the handler map default (plugin entry shape)
  + session factory

**Verify:**
- [ ] Crash fixture (kill browser process): in-flight call →
  BROWSER_CRASHED retryable:true; next launch relaunches; new tab ids
  start from 0
- [ ] session.suspended/resumed no-ops (browser stays alive, DOM intact)
- [ ] session.destroyed → context closed, process exited; cleanup
  resources removes screenshot files
- [ ] Full suite green; build + lint + typecheck clean

**Blocked by:** Phase 6

### Phase 8: Post-impl simulation

**Build:**
- `docs/features/browser-runtime/simulate.html` — post-impl sim
  (**different script** from `simulate-pre.html`; interconnected-
  simulation skill): terminal pane + tab cards + caps snapshot + event
  log; drives the REAL package via the same stub-gateway pattern sdk-
  browser's post-impl sim uses (Node `.mjs` sibling precedent D-38);
  demonstrates every PRD-TRD scenario + demo mode

**Verify:**
- [ ] All 9 PRD-TRD scenarios demonstrable, in order, via sim commands
- [ ] Side-by-side with simulate-pre.html shows no unexpected divergences
  (F7/F8/Q5 behaviors match the design)

**Blocked by:** Phase 7

## Phase Dependencies

Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Phase 1 is standalone (touches two
shipped packages, no browser-runtime code yet). Phase 2 scaffold can
start in parallel with Phase 1 work.

## Test Strategy

- Unit tests in `packages/browser-runtime/src/__tests__/` (vitest,
  repo convention). Playwright engine tests run against the real
  chromium binary via `@playwright/browser-chromium`; fixture pages
  are `data:` URLs or local HTML — no network.
- Phase 1 envelope tests live in plugin-manager + gateway-core
  `src/__tests__/` (their existing suites).
- Post-impl sim verification via Playwright browser test (sibling
  pattern: `/tmp/sim-test/test-browser-runtime-pre.js`).
- Run: `pnpm test` (root), `pnpm lint`, `pnpm typecheck`, `pnpm build`
  per package.

## Dependency Analysis (opensrc)

- **playwright-core@1.62.1** — Apache-2.0, active (Microsoft, ~weekly
  releases). Why: driver engine without downloading browsers. Call
  pattern: `chromium.launch`/`browser.newContext`/`page.evaluate` —
  never the `playwright` test-runner package.
- **@playwright/browser-chromium@1.62.1** — Apache-2.0, active,
  exact-pinned (Q1). Why: binary self-provisions at install time;
  install == usable, zero ops steps. Alternatives: `playwright-core
  install chromium` (manual step, rejected Q1); CDP raw (v2).
- No other new deps; all `@platform/*` are workspace packages.

## Rollout

- New package `packages/browser-runtime`, no existing behavior replaced.
- Phase 1 is the only change to shipped packages: additive details keys
  (backward compatible, approved by user). Both packages ship together
  in the browser-runtime PR.
- `docs/Feature_Backlog.md` BI[12] → shipped after this pipeline.

## Risk Notes

- Playwright 1.62.x is new (pinned exact) — verify the chromium binary
  download works in this environment before Phase 3 (`pnpm install`
  exercises it).
- Phase 4 settle timing: stability re-read must use short bounded waits
  to keep navigate latency sane (target <2s on typical pages).
- D-40 (sdk-browser register bug) is OUT of scope — DOM-read settle is
  immune by design; do NOT fix sdk-browser in this pack.
- `<350 lines/file` rule: split driver/session/handlers/snapshot/
  lifecycle/errors; handlers.ts may need splitting by phase if it
  grows (interactions vs navigation).
