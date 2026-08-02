# Human observability in v1

**Type:** `wayfinder:prototype` (HITL)
**Status:** unclaimed
**Assigned:** —
**Blocked by:** Screenshot payload (T3)
**Blocks:** —

## Question

In v1 the runtime must be headless AND human-observable. What does
"human observes the browser" concretely mean for browser-runtime,
and where does it stop vs `dashboard-core` (BI[13])?

## What I know

- Chart grill locked: "we have to start from v1 to do headless and
  human to observe, both". The user's framing: this is dev tooling —
  can a human developer watch what the browser is doing — NOT the
  agent interaction path. The agent path is structured capability
  invocation via sdk-browser.
- The user flagged that "stream screenshots to dashboard" is likely a
  `dashboard-core` (BI[13]) concern and "probably doesn't belong in
  this map at all".
- So the real question is the boundary: what observability ships
  *inside* browser-runtime v1 (e.g. headed mode with a debug
  port? screenshot-on-demand for humans? console/page event
  surfacing?) vs what is deferred to dashboard-core.
- This ticket is a prototype because "how should it look" is the key
  question — a cheap, rough artifact (headed run, debug port, a
  screenshot endpoint) for the human to react to.
- Depends on Screenshot payload (T3): inline base64 vs session
  Resource changes what observation primitives are cheap.

## Resolution

(AFNK — prototype session.)
