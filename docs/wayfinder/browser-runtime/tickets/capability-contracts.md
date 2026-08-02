# Capability contracts

**Type:** `wayfinder:grilling` (HITL)
**Status:** claimed (2026-08-02, current session)
**Assigned:** spanexx
**Blocked by:** Engine and browser lifecycle research (T1)
**Blocks:** Screenshot payload (T3), sdk-browser coupling after
navigate (T4), BrowserContext suspend/resume (T5), browser.wait
semantics (T6)

## Question

What is the input/output contract of each `browser.*` and
`browser.tab.*` capability — parameters, return shape, error codes —
as seen by a caller through the Gateway?

## What I know

- Capability set locked: `browser.launch`, `browser.navigate`,
  `browser.click`, `browser.type`, `browser.scroll`, `browser.wait`,
  `browser.screenshot`, `browser.close`, `browser.tab.open`,
  `browser.tab.switch`, `browser.tab.close`.
- Session model locked: one Chromium process, one BrowserContext per
  session, tabs inside the context. `browser.launch` is explicit.
- CONTEXT.md tiers: `browser.screenshot` = read, `browser.navigate`
  = act, `browser.click` = act — runtime-tier caps owned by the
  Browser Runtime Plugin.
- Error mapping should mirror the backend-runtime matrix
  (`HANDLER_NOT_FOUND` → `GATEWAY_CAPABILITY_NOT_FOUND`, etc.) where
  applicable — but browser-specific failures (no context launched,
  selector not found, tab index out of range, navigation timeout)
  need their own codes.
- The agent's view: capability invocations flow
  agent → Gateway → plugin manager → browser-runtime handler
  (in-process, per `gateway-plugin-dispatch`).
- Inputs are NOT logged in the audit log (PII stays in the
  application); outputs are.

## Resolution

**Status: CLOSED (2026-08-02, 10 grill questions locked, 2 rounds).**

### Global contract rules (all 12 caps)

- **Plain data everywhere.** No Playwright types leak into contracts
  (driver-first rule, T1). Selectors are strings, tabs are numeric
  ids, options are flat JSON.
- **Selector strategy: CSS only in v1.** `selector` is a plain CSS
  selector string. `text=` / `role=` / `xpath=` layer in v2 behind
  the driver — contracts don't carry a strategy field.
- **Instance disambiguation in v1 (F8, feature-pipeline):** one
  registered cap type can cover N page elements (three `add.cart`
  buttons). `browser.query` counts + addresses them; `instance`
  (1-based, click/type) targets the nth match; ambiguous click/type
  (no instance, >1 matches) → `BROWSER_SELECTOR_AMBIGUOUS`.
- **Tab addressing: numeric `tabId`, optional everywhere, default =
  most recently active tab.** First tab auto-created on launch with
  `tabId: 0`; ids increment per context. `browser.tab.switch` changes
  which tab is "active".
- **Optional `tabId` on every per-tab cap** (navigate, click, type,
  scroll, wait, screenshot, close).
- **Audit:** inputs not logged (PII stays in the app), outputs are —
  per session model.
- **Errors: `BROWSER_*` codes pass through from the plugin to the
  caller.** The gateway wraps handler failures in the
  `GATEWAY_HANDLER_ERROR` envelope (per gateway-plugin-dispatch) and
  preserves the `BROWSER_*` code in the structured details; the
  caller-visible error code is the `BROWSER_*` one. `GATEWAY_*` codes
  stay for infra failures only.
- **Retryable policy — "timeout/race retryable, misuse not":**
  - `retryable: true`: `BROWSER_WAIT_TIMEOUT` (T6),
    `BROWSER_SELECTOR_NOT_FOUND`, `BROWSER_SELECTOR_TIMEOUT`,
    `BROWSER_NAVIGATION_TIMEOUT`, `BROWSER_LAUNCH_FAILED`.
  - `retryable: false`: `BROWSER_NO_CONTEXT`, `BROWSER_ALREADY_LAUNCHED`,
    `BROWSER_TAB_NOT_FOUND`, `BROWSER_CLOSED`, `BROWSER_NAVIGATION_FAILED`
    (bad URL/DNS/TLS — caller must fix input, not retry),
    `BROWSER_SELECTOR_AMBIGUOUS` (F8: >1 matches without `instance` —
    caller must disambiguate, not retry).

### Per-capability contracts

| Cap | Input | Output | Errors |
|---|---|---|---|
| `browser.launch` | `{ mode?: 'headless' \| 'headed' }` (default `headless`; headed routes to the lazy headed-browser pool) | `{ launched: true, mode }` | `BROWSER_ALREADY_LAUNCHED` (false), `BROWSER_LAUNCH_FAILED` (true) |
| `browser.navigate` | `{ url, tabId?, newTab?: boolean, waitUntil?: 'load' \| 'domcontentloaded' \| 'networkidle', timeout? }` (`newTab: true` opens a fresh tab; default false) | `{ tabId, url }` | `BROWSER_NO_CONTEXT` (false), `BROWSER_TAB_NOT_FOUND` (false), `BROWSER_NAVIGATION_TIMEOUT` (true), `BROWSER_NAVIGATION_FAILED` (false), `BROWSER_NAVIGATION_DESTRUCTIVE` (false — different-url navigate on a tab with registered caps; use `newTab: true`; added in feature-pipeline F7) |
| `browser.click` | `{ selector, tabId?, instance?: number, button?: 'left' \| 'right' }` — `instance` 1-based, targets the nth match (F8) | `{ clicked: true }` | `BROWSER_NO_CONTEXT` (false), `BROWSER_TAB_NOT_FOUND` (false), `BROWSER_SELECTOR_NOT_FOUND` (true), `BROWSER_SELECTOR_TIMEOUT` (true), `BROWSER_SELECTOR_AMBIGUOUS` (false — >1 matches, no `instance`; F8) |
| `browser.type` | `{ selector, text, tabId?, delayMs?: number, instance?: number }` — `instance` 1-based (F8) | `{ typed: true, text }` | `BROWSER_NO_CONTEXT` (false), `BROWSER_TAB_NOT_FOUND` (false), `BROWSER_SELECTOR_NOT_FOUND` (true), `BROWSER_SELECTOR_TIMEOUT` (true), `BROWSER_SELECTOR_AMBIGUOUS` (false — >1 matches, no `instance`; F8) | `{ direction: 'up' \| 'down' \| 'left' \| 'right', px?: number, tabId?, selector? }` — selector given: scrollIntoViewIfNeeded; px: wheel-scroll; default: down one viewport | `{ scrolled: true }` | selector errors when `selector` given |
| `browser.wait` | T6: `{ wait: 'selector', selector, state?, timeout? }` OR `{ wait: 'time', ms }` | `{ waited: true }` | `BROWSER_WAIT_TIMEOUT` (true) |
| `browser.screenshot` | `{ tabId?, fullPage?: boolean }` | payload shape **deferred to T3** (inline base64 vs session Resource) | T3 |
| `browser.query` | `{ selector, tabId? }` — read cap, F8 | `{ matches: number, addresses: string[] }` — concrete CSS selectors (pid-anchored when available, else nth-of-type), reusable verbatim in click/type. 0 matches is a result, never an error — query exists to teach the agent | `BROWSER_NO_CONTEXT` (false), `BROWSER_TAB_NOT_FOUND` (false) |
| `browser.close` | `{ tabId? }` — tabId given: close that tab; omitted: tear down the session's context (session-end semantics). Never kills the shared Chromium process | `{ closed: true }` | `BROWSER_TAB_NOT_FOUND` (false), `BROWSER_NO_CONTEXT` (false) |
| `browser.tab.open` | `{ url?, tabId? }` | `{ tabId }` (new id) | `BROWSER_NO_CONTEXT` (false) |
| `browser.tab.switch` | `{ tabId }` | `{ tabId }` — activates + bringToFront | `BROWSER_TAB_NOT_FOUND` (false) |
| `browser.tab.close` | `{ tabId }` | `{ closed: true }` | `BROWSER_TAB_NOT_FOUND` (false) |

### What this unblocks

- T3 Screenshot payload: input side locked (`{ tabId?, fullPage? }`);
  only the output payload question remains.
- T4 sdk-browser coupling after navigate: navigate's output is now a
  plain `{ tabId, url }` — coupling question stands.
- T5 BrowserContext suspend/resume: contracts now stable, so suspend
  semantics can be decided against them.
- T6 browser.wait: closed; its `BROWSER_WAIT_TIMEOUT` retryable flag
  confirmed here.

### Open questions for later tickets

- `browser.screenshot` output shape → T3.
- Selector strict-mode policy — RESOLVED at contract level by F8
  (feature-pipeline): >1 match without `instance` →
  `BROWSER_SELECTOR_AMBIGUOUS` (retryable: false). No longer a driver-only
  detail.

(AFNK — grilling session.)
