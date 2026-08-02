# Human observability in v1

**Type:** `wayfinder:prototype` (HITL)
**Status:** claimed (2026-08-02, current session)
**Assigned:** spanexx
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

**Status: CLOSED (2026-08-02 — resolved autonomously: user
unavailable, delegated decision-making, will review. The prototype
was handed over (3 shapes, live at
`prototypes/browser-runtime-human-observability/`, run `node
serve.mjs`); the user should flip through it on review — the shape
mix below is the agent's call on their behalf and is amendable.)

### The decision

**v1 ships shape A — The window. Human observability is headed mode
+ screenshot-on-demand; browser-runtime adds no new observation
surface.**

- **Headed mode is the observation surface.** `browser.launch({ mode:
  'headed' })` opens a real Chromium window the human developer
  watches — already locked in the T1 mode pool (lazy headed browser,
  Xvfb on servers). Zero new surface: the chart-grill "headless AND
  human-observable" requirement is met by the mode pool alone.
- **Screenshot-on-demand covers visual peeks.** The T3
  `browser.screenshot` capability (inline base64 / session Resource)
  is human-callable through the Gateway — a human asks for the
  current page state exactly like the agent does. No separate
  "human snapshot" cap.
- **No snapshot console (B), no event surface (C) in v1.** B is a
  dashboard sentence — "show me a picture of the session" is what
  dashboard-core (BI[13]) builds (it polls `platform-capabilities`
  anyway, and its scope includes logs + metrics). C's
  console/nav/pageerror feed is literally BI[13]'s "logs" — it would
  duplicate the future dashboard and drag permission-tiering
  treatment (page internals exposure) into v1 for no agent value
  (the agent path is structured caps via sdk-browser, T4).
- **Where it stops:** browser-runtime's human story = window + caps.
  Streaming, recording, remote viewing, event persistence,
  cross-session views, console/log dashboards → dashboard-core
  (BI[13]). Chrome DevTools (#14) stays out of scope per the map.
- **Audience:** moot for A (no new surface). Both human and agent
  use the same `browser.*` caps through the Gateway; the human path
  adds a headed window, the agent path adds sdk-browser coupling
  (T4). No per-audience surface.
- **Surfacing runtime state to humans:** not a browser-runtime
  concern in v1. Session state is visible to humans via
  session-manager's own status surface (Gateway `getStatus`, Flow 2)
  — consistent with T5 (suspend keeps the browser alive; a human
  watching the window sees the session pause and resume live).

### Prototype verdict

The three shapes were built and verified (A — The window, B — The
snapshot console, C — The event surface; `?variant=` switch, ←/→
keys, floating bar). Verdict on the human side is pending — this
resolution records the agent's recommended shape (A) for review.
The prototype stays in `prototypes/` (gitignored, repo convention)
until the user confirms or amends; then delete per prototype skill.

### What this unblocks

- The map's final boundary question — every open decision is now
  resolved; the way to the destination is clear.
- Remaining fog (browser binary management, concurrency limits,
  crash recovery, network/proxy isolation) is not sharp enough to
  ticket now — it rides into the feature-pipeline GRILL for the
  package build.

### Delivery routing

**`delivery: decision-only`** for this ticket — a boundary decision,
no build work. The map itself now routes to
**`delivery: feature-pipeline`** for the `@platform/browser-runtime`
package build (per map Destination: "the build happens via
feature-pipeline once the way is clear").
