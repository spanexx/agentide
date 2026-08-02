# browser.wait semantics

**Type:** `wayfinder:grilling` (HITL)
**Status:** unclaimed
**Assigned:** —
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

## Resolution

(AFNK — grilling session.)
