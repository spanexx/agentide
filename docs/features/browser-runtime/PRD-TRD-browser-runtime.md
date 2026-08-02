# PRD-TRD: Browser Runtime

**Slug:** browser-runtime
**Status:** Draft
**Date:** 2026-08-02

## Why This Exists

Agents on the platform can call structured capabilities, but nothing can
drive a real browser for them. Without a browser runtime, an agent cannot
open a web page, click through a checkout, read what the page renders, or
screenshot a result — every task that touches the web dies at "no browser".

`@platform/browser-runtime` closes that gap: a session-scoped browser
driver exposed as 12 `browser.*` capabilities, dispatched in-process by
the Gateway through the plugin system. The agent opens tabs, navigates,
interacts via plain CSS selectors, waits, screenshots, and tears down —
without ever handling Chromium internals. The engine is Playwright v1 with
the binary self-provisioned at install time (`@playwright/browser-chromium`
exact-pin, Q1), so install == usable with zero ops steps.

Cost of not building it: the platform's browser story stays a stub —
sdk-browser (shipped) has no runtime to register its page capabilities
against, and every agent task that needs a real page remains unservable.

## Behavioral Spec

### Scenario 1: Launch and first tab

**Given** a fresh session
**When** the agent calls `browser.launch` (default headless)
**Then** a Chromium process + one BrowserContext start, tab 0 exists, and
the result is `{ launched: true, mode: 'headless' }`; a second `launch`
errors `BROWSER_ALREADY_LAUNCHED` (retryable: false)

### Scenario 2: Navigate is the sync point (T4 + F11)

**Given** a launched session
**When** the agent calls `browser.navigate { url, tabId }` on an occupied tab
**Then** the tab's page is replaced (never an error, never a new tab; F2),
and the result is `{ tabId, url, capabilities, capsSettled }` where
`capabilities` is the runtime's per-tab cap snapshot (Q5-revision) and
`capsSettled` comes from a DOM read of `[data-sdk-cap]` elements with a
stability re-read (F11); on settle-timeout it returns what it has with
`capsSettled: false`

### Scenario 3: Destructive-navigation guard (F7)

**Given** a tab whose page hosts registered caps
**When** the agent navigates it to a **different** url
**Then** `BROWSER_NAVIGATION_DESTRUCTIVE` (retryable: false); same-url
re-navigate stays allowed, `newTab: true` always allowed, plain tabs
navigate freely

### Scenario 4: Query, instance, ambiguity (F8)

**Given** a page with three `.add-cart` buttons
**When** the agent calls `browser.query { selector: '.add-cart', tabId }`
**Then** `{ matches: 3, addresses: string[] }` — concrete CSS addresses
(pid-anchored `[data-pid="202"] .add-cart` when the DOM has data attrs,
else nth-of-type) reusable verbatim in click/type; `matches: 0` is a
result, never an error
**When** click/type is called without `instance` and the selector matches
>1 element
**Then** `BROWSER_SELECTOR_AMBIGUOUS` (retryable: false — misuse);
`instance: N` (1-based) targets the Nth match

### Scenario 5: Wait semantics (T6)

**Given** a launched session
**When** the agent calls `browser.wait { wait: 'selector', selector }`
(default 30s, cap 120s) and the element never appears
**Then** `BROWSER_WAIT_TIMEOUT` (retryable: true)
**When** `browser.wait { wait: 'time', ms }`
**Then** the runtime sleeps `ms` and returns `{ waited: true }`

### Scenario 6: Screenshot payload (T3)

**Given** a tab
**When** the agent calls `browser.screenshot { tabId, format?, quality? }`
and the raw image ≤ 256 KiB
**Then** `{ format, mode: 'inline', data: <base64>, bytes }`
**When** the image exceeds 256 KiB (or `mode: 'resource'` is forced)
**Then** `{ format, mode: 'resource', resourceId, bytes }` — written to
the session resource dir, cleaned up via `session.cleanup_resources`
**When** `mode: 'inline'` is forced and the image is oversized
**Then** `BROWSER_SCREENSHOT_TOO_LARGE` (retryable: false)

### Scenario 7: Crash recovery (Q4)

**Given** a browser process that dies mid-invocation
**Then** the in-flight call errors `BROWSER_CRASHED` (retryable: true),
the session is marked dead, and the next `browser.launch` auto-relaunches

### Scenario 8: Suspend/resume (T5 + F10)

**Given** a session with an open tab and typed form input
**When** the session suspends
**Then** the browser stays alive (no-op handlers on
`session.suspended`/`session.resumed`)
**When** the agent calls a browser cap after resume (gateway resume-first, F6)
**Then** it works instantly with DOM state intact — no explicit resume cap
**When** the session is destroyed (`session.destroyed`)
**Then** the context closes and the process exits; `session.cleanup_resources`
purges screenshot resources

### Scenario 9: Tab lifecycle (F1, F3)

**Given** a launched session
**When** `browser.tab.open` runs
**Then** a new tab gets the next id (launch seeds the counter at 1; ids
never reused per context; fresh context after crash-relaunch resets)
**When** `browser.tab.switch { tabId }` runs
**Then** that tab becomes active (default target for tabId-less caps)
**When** `browser.close { tabId }` runs
**Then** only that tab closes, context intact; `browser.close` without
tabId tears down the session context without killing the shared process

## Simulation Contract

Post-impl sim (`docs/features/browser-runtime/simulate.html`, HTML per
Q6) MUST demonstrate, in order:

```bash
# Scenario 1
launch            # → { launched: true, mode: 'headless' }; tab 0
launch            # → BROWSER_ALREADY_LAUNCHED (retryable: false)
# Scenario 4
query .add-cart   # → { matches: 3, addresses: [...pid-anchored...] }
click .add-cart   # → BROWSER_SELECTOR_AMBIGUOUS (retryable: false)
click .add-cart instance 2   # → { clicked: true }
# Scenario 2 + 3
navigate https://shop.example/   # → { tabId, url, capabilities, capsSettled }
navigate https://google.com      # → BROWSER_NAVIGATION_DESTRUCTIVE
# Scenario 6
screenshot        # → inline base64 under cap; oversize → resource mode
# Scenario 5
wait selector .never-appears     # → BROWSER_WAIT_TIMEOUT (retryable: true)
wait time 200                    # → { waited: true }
# Scenario 7
crash-simulate    # → BROWSER_CRASHED (retryable: true); relaunch works
# Scenario 8
suspend; type ...; resume-first auto  # → DOM intact, works instantly
# Scenario 9
tab.open; tab.switch 1; close 1; close # → tab-only, then session teardown
```

Also: demo mode exercising the full agent loop (navigate → query →
click/type → screenshot → wait), matching the pre-impl sim's flow.

## Technical Design

### Data Models

- **`BrowserDriver`** — plain-data interface, zero Playwright types on the
  public surface (driver-first rule, T1). Selectors are strings, tabs are
  numeric ids, options are flat JSON.
- **Per-tab state** — each tab: `{ id, pageRef, url, capabilities: Cap[],
  capsSettled }` where `Cap = { name, tier, count, registered }`
  (mirrors sdk-browser's `CapabilityView`). Snapshot captured at navigate
  (Q5-revision); serves `capability.list({ tabId })` without touching the
  shipped capability-registry.
- **Session state** — `{ launched, mode, context, tabsById, activeTabId,
  nextTabId, dead }`; one context per session (T1).
- **Error payloads** — `{ code: BROWSER_*, message, retryable, details }`
  (see envelope below).

### API Contracts

- **12 capabilities** (owner `plugin:browser`, T2/F8): `browser.launch`,
  `browser.navigate`, `browser.click`, `browser.type`, `browser.scroll`,
  `browser.wait`, `browser.screenshot`, `browser.query`, `browser.close`,
  `browser.tab.open`, `browser.tab.switch`, `browser.tab.close` — exact
  input/output/error tables in `docs/wayfinder/browser-runtime/tickets/
  capability-contracts.md`.
- **Error envelope (AUDIT F10, approved):** envelope code stays
  `GATEWAY_HANDLER_ERROR`; the additive extension makes plugin-manager
  preserve `originalErrorCode` + `retryable` in `PLUGIN_HANDLER_ERROR`
  details when the handler throws an Error carrying them, and gateway-core
  pass them into `GATEWAY_HANDLER_ERROR` details. Callers match
  `details.browserCode`, honor `details.retryable`. Backward compatible.
- **Events consumed:** `session.suspended`, `session.resumed` (no-op),
  `session.destroyed` (teardown — F10/D-42; `session.closed` does not
  exist), `session.cleanup_resources` (resource purge).
- **Tiers:** manifest must declare tiers explicitly for `launch`, `close`,
  `screenshot`, `tab.close` — the shipped verb tables do not infer them
  (audit Finding 9): `launch` is in no verb list, `close` ∈ ACT_VERBS but
  `browser.close` without tabId is destructive, `screenshot` is a read
  despite being act-shaped, `tab.close` is destructive.

### Dependencies

- `@playwright/browser-chromium` — exact-pin; install-time binary
  self-provisioning (Q1). Version to be pinned at install time.
- `playwright-core` — driver engine (no browser download).
- `@platform/errors`, `@platform/gateway-core` (invocation context,
  sessionId), `@platform/session-manager` (events), `@platform/
  capability-registry` (registration types) — all shipped in-repo.
- Audit finding 9 nuance: launch/close/screenshot/tab.close tiers must be
  declared in the manifest explicitly.

### Architecture Notes

- Registers with the capability-registry as owner `browser` (manifest
  `runtime: { id: browser }`), dispatched in-process by the Gateway via
  `plugin:browser` owner (audit Finding 10: handler receives
  `(input, { pluginId, sessionId })` — sessionId keys per-session state).
- Async commands serialize via the Gateway's existing per-invocation
  serialization; the plugin adds no own concurrency (F4).
- Crash: `browser.on('disconnected')` marks session dead; next launch
  auto-relaunches (Q4). Zombie exit handler on process exit (T1).
- Lifecycle: one process + one context per session; context closes on
  `session.destroyed` (T1, D-42).

## Non-Goals

- Raw CDP engine or Playwright v2 (Rust rebuild) — v2.
- Screenshot/event streaming to a dashboard — dashboard-core BI[13].
- Chrome DevTools extension integration (#14), plugin-marketplace listing.
- `text=`/`role=`/`xpath=` selectors — CSS-only in v1.
- Per-context proxy/interception config — defaults only (Q3).
- Hard concurrency cap / session limits (Q2).
- Multi-tab-same-app at the gateway — backend-runtime replaces the first
  connection (D-43); per-tab snapshot makes it invisible to the agent.
- Keep-alive knob for suspended memory — v2 candidate (T5).
- Fixing the sdk-browser register-frame bug (D-40) — separate fix,
  approved out of this scope.

## Out of Scope (Future)

- `BROWSER_LIMIT_REACHED` code (Q2), keep-alive knob (T5), proxy config
  (Q3), screenshot format extras (T3 build detail).

## References

- `GRILL-browser-runtime.txt` — locked decisions Q1-Q6, F1-F12
- `AUDIT-vs-shipped-code.md` — 10 findings with file:line evidence
- `docs/wayfinder/browser-runtime/tickets/` — T1-T7 tickets (capability-
  contracts.md = authoritative per-cap tables)
- `docs/drift.md` — D-40..D-43 (open), D-37..D-39 (resolved)
- `IMPL-browser-runtime.md` — execution plan (separate doc)
- `simulate-pre.html` — pre-impl sim (to be reconciled)
- `docs/CONTEXT.md` — glossary + decision records
