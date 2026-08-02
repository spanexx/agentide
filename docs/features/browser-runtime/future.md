# Future: browser-runtime — what's NOT in v1, and what comes after

`@platform/browser-runtime` v1 ships the minimum needed to unblock gateway-side
browser automation (BI[12]): launch/navigate/click/type/scroll/wait/screenshot
over tab-scoped capability registration. Everything below is intentionally
deferred.

This file is the single source of truth for "what v2 / v3 / etc. look like."
Each section has a trigger — the event that would make us need it — and a
brief sketch of the API change.

---

## v1 baseline (documented behavior, not gaps)

These are how v1 works BY DESIGN. Agents must already handle them; the v2/v3
items below are the runtime-side assists that would make them automatic.

- **No text reading.** The 11 caps have no read-the-page capability. The
  agent's only eye is `browser.screenshot` (viewport, on demand, 256KiB cap,
  inline-first per T3). To "see" a product list the agent runs the **scan
  pattern**: `screenshot → scroll → screenshot → …`. Nothing auto-syncs after
  a scroll — a scroll silently invalidates the agent's last image, and
  re-capture is the agent's job.
- **Capability awareness is page-wide, instance-blind.** Capabilities are
  tab-scoped (T4): the agent always knows "this tab has `add.cart`" no matter
  where it scrolled. But the registry stores capability types, not instances —
  three products with the same button means the agent must **disambiguate
  selectors itself** (`#product-2 .add-cart`, `:nth-of-type(2)`). Clicking
  works off-screen (Playwright auto-scrolls); scroll is for observation.

---

## v2 — Production polish

Trigger: A real flow (e-commerce, dashboard) hits a wall the scan pattern can't
climb.

### v2.1 — Selector expansion (text= / role= / xpath=)
Drift log: none (locked as v2 candidate in T2 GRILL)

**Why:** CSS-only selectors (locked in T2) bite on dynamic pages with unstable
classes/ids. Agents currently fall back to `:nth-of-type` gymnastics.

**Sketch:**
- `browser.click` / `browser.type` / `browser.wait` accept `text=`,
  `role=`, `xpath=` prefixed selectors in addition to CSS.
- Selector syntax stays string-based (no selector-object shape change).
- Keep CSS as the documented default; richer selectors opt-in per call.

### v2.2 — Text reading (`browser.read`)
**Why:** Screenshot + image analysis is slow and error-prone for structured
content (product lists, prices, table rows). Agents want text, not pixels.

**Sketch:**
- New read-tier cap: `browser.read { selector?, tabId? }` →
  `{ text, elements: [{ text, count }] }` — textContent of the page or of
  matching elements.
- Returns plain text only (no layout/DOM tree — see v5); structure stays the
  agent's job via CSS.
- Pairs with v2.3 so "read the product grid" doesn't need exact selectors.

### v2.3 — Instance addressing (`browser.query`)
**Why:** "Three add.cart buttons, which one?" — the v1 answer is agent-side
selector disambiguation, which breaks when the page has no stable structure.

**Sketch:**
- `browser.query { selector, tabId? }` → `{ matches: N, addresses: [sel, …] }`
  listing concrete addresses (e.g. `:nth-of-type(i)` chains) for each match.
- `browser.click` / `browser.type` gain optional `instance: i` (1-based) to
  target one match without the agent composing the selector by hand.

### v2.4 — Full-page screenshots
**Why:** Long product lists make the viewport-slice scan tedious and
token-hungry (N screenshots per page).

**Sketch:**
- `browser.screenshot { fullPage: true }` — native full-page capture.
- T3 cap stays: full-page output nearly always exceeds 256KiB → auto-selects
  resource mode (or errors if `inline` forced). No cap change.

---

## v3 — Observation & awareness

Trigger: Agents prove the scan pattern is the bottleneck in real sessions.

### v3.1 — Post-action sync (opt-in)
**Why:** v1's staleness-after-scroll is by design (F7 philosophy: the runtime
never assumes what the agent wants). But some flows re-screenshot after every
action, a pattern the runtime could serve automatically.

**Sketch:**
- `browser.scroll { autoSnapshot: true }` → returns `{ snapshot: … }` (or a
  `page.updated` event the SDK can subscribe to).
- Explicitly OPT-IN; default behavior stays v1 (no magic sync).
- Shape decision (inline response vs event) rides on dashboard-core BI[13]
  event-surface work.

### v3.2 — Proxy support
Drift log: GRILL Q3 — network defaults locked, proxy named v2 candidate

**Why:** Enterprise deployments need egress control (corporate proxy,
per-site routing).

**Sketch:**
- `browser.launch { proxy: { server, bypass? } }` — passed through to
  Playwright's proxy config.
- Default remains Playwright's no-proxy behavior.

### v3.3 — Session persistence / cross-session tabs
**Why:** Long-running agents lose their tabs on process death; relaunch starts
from about:blank (T2: crash-relaunch = new context = fresh ids).

**Sketch:**
- Persist context (cookies, localStorage, tab list) to disk; relaunch restores
  it. Tab ids stay per-context (T2 contract unchanged — restore re-maps ids).
- Needs session-manager cooperation (v2 pack boundary decision).

---

## v4 — Platform extensions

Trigger: Platform needs beyond what v1-v3 cover.

### v4.1 — Human observability depth (T7 shape B/C)
**Why:** T7 locked v1 = shape A ("the window": headed mode + screenshot-on-demand,
zero new surface). A dashboard sentence / live snapshot console / event surface
was deferred.

**Sketch:**
- Route to dashboard-core BI[13] (same bucket as logs scope); browser-runtime
  just emits the already-defined bus events (capability.registered, audit
  lines) — the console is a dashboard concern, not a runtime cap.

### v4.2 — Streaming / recording / remote control
**Why:** Live streaming, session recording, and remote operator control are
recurring asks but need the gateway/dashboard plane, not the runtime.

**Sketch:**
- New pack or dashboard-core BI[13] extension; browser-runtime exposes only
  the underlying screenshot/event primitives it already has.

---

## v5 — Out of scope forever

These aren't planned at any version. If they come up, they get their own pack.

- **Accessibility-tree / DOM APIs** — exposing the a11y tree or raw DOM
  inspection is a different product than CSS-driven automation. Agents that
  need layout intelligence use v2.2/v2.3, not a DOM pipe.
- **Headless Chrome DevTools surface** — `chrome://inspect`-style deep tooling
  belongs to a devtools pack (prototype #14), not browser-runtime.
- **Anti-bot / stealth engineering** — defeating bot detection is out of
  scope forever (legal + maintenance burden).
- **Multi-browser engines** (Firefox/WebKit) — v1 is chromium-only
  (`@playwright/browser-chromium` exact-pin, GRILL Q1). Other engines = their
  own GRILL.

---

## Open questions for each future version

- v2.1: Do richer selectors weaken the CSS-only security story? — open
- v2.2: Return shape — page text, per-element text, or both? — open
- v2.3: `instance:` syntax vs pure query-then-click choreography? — open
- v2.4: fullPage default on or off? (token cost vs surprise) — open
- v3.1: inline response vs `page.updated` bus event? — depends on BI[13]
- v3.3: Cookie/localStorage persistence is a security review item — open

Each v2.x / v3.x ships only when a real flow needs it. v1 is the contract;
everything else is an extension.

---

## Related drift log entries

- None — the browser-runtime pack is not yet built; entries land after ship.
