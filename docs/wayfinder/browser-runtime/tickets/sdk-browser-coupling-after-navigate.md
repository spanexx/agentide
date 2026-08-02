# sdk-browser coupling after navigate

**Type:** `wayfinder:grilling` (HITL)
**Status:** claimed (2026-08-02, current session)
**Assigned:** spanexx
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

**Status: CLOSED (2026-08-02, 5 grill questions, 1 round).**

### Locked decisions

- **`browser.navigate` is the sync point: it carries the page's
  capabilities.** Output extends T2's `{ tabId, url }` to
  `{ tabId, url, capabilities, capsSettled }`. Browser-runtime waits
  for the page's registration to settle, so the agent gets the page
  picture in one round trip. Registration stays async internally
  (MutationObserver + initial scan); navigate is where it
  synchronizes.
- **Settle detection: DOM-read at navigate + timeout flag (AUDIT F11
  revision, 2026-08-02).** The original lock said browser-runtime waits
  for sdk-browser's "caps registered" signal "(event-bus, per
  session)" — REVERSED by audit: `sdk.capability.registered` fires on
  the SDK's page-local bus (createEventBus per createSdk), invisible to
  the gateway process where browser-runtime runs; no per-registration
  bus event exists gateway-side. Revised: browser-runtime reads the
  tab's own DOM via Playwright `evaluate` counting `[data-sdk-cap]`
  elements (the shipped CAP_ATTR from sdk-browser observer.ts), settle
  = stability re-read (read → short wait → read; stable →
  `capsSettled: true`, changed → keep waiting to the settle timeout).
  Zero shipped-package changes; naturally per-tab; immune to the
  sdk-browser register-frame bug (drift D-40: name-only register frame
  fails registry validation → register-failed close — caps never reach
  the gateway; the DOM is the ground truth; D-40 FIXED 2026-08-02 as a
  follow-up (sdk-browser full register frame, docs/drift.md)). On timeout → return what's
  registered so far with `capsSettled: false`. No fixed-delay guessing,
  no unbounded block.
- **Timeout is not an error.** `{ tabId, url, capabilities: [],
  capsSettled: false }` — navigate itself succeeded; plain pages
  without sdk-browser are legitimate (empty caps), not failures. The
  agent can re-query `capability.list` later if it wants fresh caps.
- **Tab-scoped registrations (F9 revision, feature-pipeline audit).**
  Navigate's caps are scoped to that tabId; two tabs of the same app are
  distinguishable — but NOT via registry owner metadata. The shipped
  capability-registry keys by name+version (store.ts) and cards carry no
  owner/tabId (types.ts); sdk-browser (shipped) has no tab awareness to
  pass. Revised: browser-runtime holds a per-tab cap snapshot (captured at
  navigate) and serves `capability.list({ tabId })` from it; the shipped
  registry is NOT modified. Backward compatible: no-arg list unchanged.
  Original text locked "extends the shipped capability-registry contract —
  registry.register owner metadata + capability.list filter" — REVERSED by
  audit, flagged for user review; browser-runtime v1 depends on the revision.
- **Re-read after in-page change: re-navigate OR filtered list.**
  Both work: agent re-invokes `browser.navigate` (idempotent on same
  tab — re-navigates, re-waits, fresh caps) as the explicit sync
  point, or queries `capability.list({ tabId })` for a lighter read.
  No separate `browser.page.read` cap — ruled out (one more cap,
  zero new information).

### What this unblocks

- T5 BrowserContext suspend/resume: navigate's contract is now
  stable (`{ tabId, url, capabilities, capsSettled }`) and
  tab-scoped registrations exist, so suspend semantics can be
  decided against a known contract.
- The agent loop (sdk-browser T1) now has its missing sync point:
  steps 3–4 (introspect/register) are bounded by navigate, step 5
  ("what's on this page?") answers from navigate's result.

### Open questions for later tickets

- None sharp enough to ticket. Settle timeout duration + event name
  are driver-level detail for the build (feature-pipeline).

### Delivery routing

**`delivery: feature-pipeline`** — this ticket produced clear
requirements with cross-pack surface (browser-runtime + a
capability-registry contract extension). Not decision-only; the
build is real and multi-file.
