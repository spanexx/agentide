# browser.wait semantics

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed 2026-08-02 (grilling session)
**Assigned:** spanexx
**Blocked by:** Capability contracts (T2)
**Blocks:** —

## Question

What does `browser.wait` wait for — a selector / load state, a fixed
duration, or both?

## What I know

- `browser.wait` is in the locked capability set (Runtime_Capabilities.md
  canonical namespace), but its semantics are unspecified.
- Playwright offers `waitForSelector`, `waitForLoadState`,
  `waitForTimeout`, plus auto-waiting locators (click/type already
  wait implicitly).
- Options surfaced in chart grill: (a) wait for selector/load state
  with timeout surfaced as an error; (b) fixed-duration sleep
  (`{ ms }`); (c) both. Unresolved — this ticket.
- If both, need to decide the input shape (discriminated union?) and
  which is the default.
- Default timeouts and their error codes should align with the
  Capability contracts ticket (T2).

## Resolution (2026-08-02, grilling session — locked)

1. **Wait target:** both modes — `browser.wait` waits for a condition
   (selector / load state) AND has a fixed-duration mode. Rules out
   condition-only and duration-only.

2. **Input shape:** discriminated union on a `wait` field:
   `{ wait: 'selector', selector, state?, timeout? }` OR
   `{ wait: 'time', ms }`. No presence-based sniffing. `state?` uses
   Playwright's `visible | attached | hidden` (default `visible`);
   condition mode composes `locator.waitFor({ state })` and
   `page.waitForLoadState()` per T1 research. Duration mode is a
   `page.waitForTimeout(ms)`-style sleep with no condition.

3. **Default timeout:** 30s default in condition mode, per-call
   `timeout?` override, capped at 120s. Duration mode takes `ms`
   directly (no timeout interplay).

4. **Timeout result:** error with code `BROWSER_WAIT_TIMEOUT`,
   `retryable: true` (page may still load; agent may retry). Final
   error-code naming and registration live in **Capability contracts
   (T2)** — this ticket fixes semantics only.

**Delivery route:** this ticket is decision-only; it feeds the
eventual `feature-pipeline` run for browser-runtime (all tickets must
close first).

**Closed 2026-08-02.**
