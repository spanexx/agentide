# Engine and browser lifecycle research

**Type:** `wayfinder:research` (AFK)
**Status:** closed 2026-08-02 (research subagent)
**Assigned:** spanexx
**Blocks:** Capability contracts (T2)

## Question

What does Playwright v1 give us for each `browser.*` capability, how
do we install and manage the browser binary, and what is the CDP
upgrade path for the v2 Rust rebuild?

## What I know

- Engine locked in chart grill: **Playwright v1**; CDP (raw) is
  version 2 alongside a planned Rust rebuild (future effort, out of
  scope for this map).
- The capability surface is locked: `browser.launch`,
  `browser.navigate`, `browser.click`, `browser.type`,
  `browser.scroll`, `browser.wait`, `browser.screenshot`,
  `browser.close`, plus `browser.tab.open` / `browser.tab.switch` /
  `browser.tab.close`.
- Session model locked: one Chromium process, one BrowserContext per
  session, tabs inside the context.
- Open questions this research must answer:
  - Which Playwright API maps to each capability (launch args,
    `page.goto` / `locator.click` / `locator.fill` / `mouse.wheel` /
    `page.screenshot`, etc.)?
  - Headless vs headed: both are required in v1 (locked) — what does
    headed mode cost, and can one browser process serve both?
  - Browser binary install: `npx playwright install` at plugin
    install? System Chrome fallback? Version pinning strategy?
  - CDP upgrade path: what in the Playwright API surface makes the
    v2 CDP swap harder or easier?
  - Playwright's own browser lifecycle: `launch()` vs `connectOverCDP`,
    process cleanup on crash, graceful close.

## Resolution (2026-08-02, research subagent; docs verified: playwright.dev)

1. **API mapping** — `browser.launch` → `chromium.launch({ headless,
   channel?, args?, timeout? })`; `browser.navigate` →
   `page.goto(url, { waitUntil: 'load' })` (returns `Response | null`,
   throws on network failure only, not 4xx/5xx); `browser.click` →
   `locator.click({ timeout })` (locators auto-wait actionability,
   strict — multiple matches throw); `browser.type` →
   `locator.fill(text)` by default (clears, one input event), optional
   `pressSequentially` for human-like typing (`locator.type` is
   deprecated); `browser.scroll` → `page.mouse.wheel(deltaX, deltaY)`
   or `locator.scrollIntoViewIfNeeded()`; `browser.wait` → compose
   `locator.waitFor({ state })` / `page.waitForLoadState` /
   `page.waitForURL` (T6 grills exact semantics); `browser.screenshot`
   → `page.screenshot({ type: 'png' })` returns Buffer (element-level
   `locator.screenshot()` exists); `browser.close` → `context.close()`
   per session then `browser.close()` on teardown; `browser.tab.open`
   → `context.newPage()`; `browser.tab.switch` → `page.bringToFront()`;
   `browser.tab.close` → `page.close()` (closing last tab does NOT
   close the context).

2. **Headless + headed in v1** — one `chromium.launch()` serves ONE
   mode (process-level flag); `headless: true` is the full Chromium
   binary (since ~v1.49), `headless: 'shell'` lighter, `headless:
   false` headed. One downloaded Chromium build serves all three.
   **Recommendation:** lazy pool — default shared headless browser,
   lazily spawn a headed browser only when a session requests it;
   both host many contexts (keeps the one-process-one-context model).
   Headed on Linux servers needs Xvfb (`xvfb-run -a`) + `--with-deps`
   — document as host prerequisite.

3. **Browser binary install** — `npx playwright install chromium`
   lands in `~/.cache/ms-playwright`; `PLAYWRIGHT_BROWSERS_PATH`
   relocates, `=0` hermetics into node_modules. Exact-pin playwright
   version (each pins browser revisions); `channel: 'chrome'` as
   documented fallback only. Plugin install step runs `playwright-core
   install chromium` (idempotent) or depends on
   `@playwright/browser-chromium` (postinstall downloads). Disk:
   ~150–300 MB per browser build.

4. **CDP upgrade path** — Playwright exposes CDP directly
   (`newBrowserCDPSession()` / `context.newCDPSession(page)`) and
   `connectOverCDP(endpoint)`. **#1 design rule:** thin plain-data
   `BrowserDriver` interface with `PlaywrightDriver` implementation;
   zero Playwright types leak into capability contracts (tab ids,
   selector+strategy descriptors, not `Page`/`Locator` objects). v2
   Rust/CDP swaps the driver behind the same interface.

5. **Lifecycle** — use `launch()` (owns the process); crash → `browser
   .on('disconnected')`, mark dead, auto-relaunch on next launch;
   session cleanup = `context.close()` on `session.closed` (closes
   all tabs), `browser.close()` only when last context gone; add exit
   handler for zombie prevention (SIGKILLed Node can orphan
   Chromium). `context.newContext()` guarantees cookie/storage/cache
   isolation between sessions; `storageState()` enables suspend/
   resume (T5).

6. **Deps** — library API from `playwright` or `playwright-core`;
   NOT `@playwright/test` (test-runner coupling). Prod lean combo:
   `playwright-core` + `@playwright/browser-chromium`.
   Container/server notes: `chromiumSandbox: true` for untrusted
   pages, `args: ['--disable-dev-shm-usage']` for small /dev/shm,
   `PLAYWRIGHT_SKIP_BROWSER_GC=1` to avoid disk churn.

**Verdict:** research ticket closed — unblocks Capability contracts (T2)
with the driver-first design rule, mode pool, API mapping, and install
strategy above.
