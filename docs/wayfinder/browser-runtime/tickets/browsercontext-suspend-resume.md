# BrowserContext suspend/resume

**Type:** `wayfinder:grilling` (HITL)
**Status:** unclaimed
**Assigned:** —
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

(AFNK — grilling session.)
