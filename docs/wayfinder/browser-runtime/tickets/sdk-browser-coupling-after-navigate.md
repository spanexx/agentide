# sdk-browser coupling after navigate

**Type:** `wayfinder:grilling` (HITL)
**Status:** unclaimed
**Assigned:** —
**Blocked by:** Capability contracts (T2)
**Blocks:** —

## Question

After `browser.navigate` completes, how does the agent learn what the
new page offers — does the navigate result carry the page's
capability list, or does the agent discover separately?

## What I know

- Boundary locked in sdk-browser T7: browser-runtime executes
  `browser.*`; sdk-browser (inside the page) introspects
  `data-sdk-cap` annotations and registers the page's *structured*
  capabilities with the Gateway via its own WebSocket.
- The agent loop (sdk-browser T1): navigate → sdk-browser
  re-introspects the new page → registers caps → agent discovers →
  agent invokes a cap → sdk-browser dispatches back to the DOM.
- Registration is async (MutationObserver + initial scan settle
  time). The gap between "page loaded" and "caps registered" is
  where the coupling decision lives.
- Options surfaced in chart grill: (a) navigate result includes the
  page's caps after waiting for registration to settle; (b) agent
  queries the capability registry separately; (c) on-demand
  `browser.page.read` cap. Unresolved — this ticket.

## Resolution

(AFNK — grilling session.)
