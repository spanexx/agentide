# BrowserContext suspend/resume

**Type:** `wayfinder:grilling` (HITL)
**Status:** claimed (2026-08-02, current session)
**Assigned:** spanexx
**Blocked by:** Capability contracts (T2)
**Blocks:** —

## Question

What happens to a session's BrowserContext when the session suspends
or resumes?

## What I know

- CONTEXT.md Session lifecycle: Active (running) ⇄ Suspended (paused,
  resources retained) → Archived (soft-delete, metadata retained for
  TTL). Session Manager tracks runtime resources per session;
  auto-cleaned on destroy.
- Session model locked: one Chromium process, one BrowserContext per
  session; session end → `session.closed` → browser-runtime closes
  context + tabs, nothing leaks.
- Options surfaced in chart grill: (a) context survives suspend —
  browser process stays alive, resume just continues; (b) suspend
  closes tabs, resume re-opens them to stored URLs. Unresolved —
  this ticket.
- Cross-cutting: browser-runtime must listen for `session.closed`
  (and possibly `session.suspended` / `session.resumed`) from
  session-manager's event bus.

## Resolution

**Status: CLOSED (2026-08-02, 5 grill questions — resolved
autonomously: user unavailable, delegated decision-making, will
review. Each choice below states the option taken and the reasoning;
reviewable.)**

### Locked decisions

- **Suspend keeps the BrowserContext (and Chromium process) alive.**
  Option (a). Grounded in the session-manager contract, which already
  guarantees "resources preserved across suspend/resume (browser tab
  still open, auth still valid)" — the browser is one of the session's
  runtime resources. Resume is instant, zero state loss (DOM, form
  inputs, scroll, in-page JS state all intact). Teardown on suspend
  would contradict the platform's own suspend semantics.
- **Event subscription: one listener, three events.**
  `session.suspended` → no-op (keep alive), `session.resumed` →
  no-op, `session.closed` → close context + process. The no-ops make
  the contract explicit and future-proof (a later keep-alive knob
  flips the suspended handler); `session.closed` is the only real
  teardown path — consistent with the chart-locked session model.
- **Cap calls during suspend: trust the gateway's resume-first.**
  Flow 2 step 6 is documented — the Gateway calls
  `sessionManager.resume(sessionId)` before routing any capability.
  Browser caps therefore always hit an active session; no
  `BROWSER_SUSPENDED` state, no queueing. If archive lands mid-call,
  `session.closed` kills the context and the in-flight invocation
  errors `BROWSER_CLOSED` (retryable: false, per T2 — session is
  gone, fix is a new session).
- **Resource cost: accepted.** An idle suspended session holds a live
  Chromium (~150–300 MB). This is the price of the instant-resume
  contract session-manager already promises; operators tune the idle
  timeout rather than the browser. No new config knob in v1 — keep
  the plugin surface minimal; the knob is a v2 candidate if memory
  becomes a real problem.
- **Resume is transparent to the agent.** No new cap, no flag on
  navigate output. The first post-resume cap call just works, DOM
  state intact. Caps have no suspend-awareness; the gateway already
  resolved the state machine before the call arrived.

### What this unblocks

- T7 Human observability in v1: suspend behavior is now settled —
  the browser is alive while the session lives, dead at
  `session.closed`. A human dashboard observing a suspended session
  sees the same browser state; no special resume handling needed.

### Open questions for later tickets

- Keep-alive knob (v2 candidate) if Chromium memory cost proves
  problematic in production. Not sharp enough to ticket now — a
  documented v2 candidate, not a live decision.

### Delivery routing

**`delivery: decision-only`** — contract decision, no build work.
The build ships with the map's eventual `delivery: feature-pipeline`
for browser-runtime itself; the session-manager events consumed here
(`session.suspended`/`session.resumed`/`session.closed`) already
exist in the shipped pack.
