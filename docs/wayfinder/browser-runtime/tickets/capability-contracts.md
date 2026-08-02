# Capability contracts

**Type:** `wayfinder:grilling` (HITL)
**Status:** unclaimed
**Assigned:** —
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

(AFNK — grilling session.)
