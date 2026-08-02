# Screenshot payload

**Type:** `wayfinder:grilling` (HITL)
**Status:** unclaimed
**Assigned:** —
**Blocked by:** Capability contracts (T2)
**Blocks:** Human observability in v1 (T7)

## Question

What does `browser.screenshot` return to the caller — inline base64
in the JSON response, or a reference to a session-owned Resource on
disk?

## What I know

- The docs example (`Agentide.md` / sims) shows `browser.screenshot`
  returning inline base64. Real screenshots can be megabytes, and the
  Gateway logs output shapes.
- The platform's primary path for agents is **structured capability
  invocation** — sdk-browser's `data-sdk-cap` annotations mean the
  agent calls `customer.read` and gets structured data, not a PNG.
  `browser.screenshot` is a low-level runtime primitive for
  observation, debugging, dashboard inspection — not the primary
  agent interaction.
- CONTEXT.md: outputs go back to the caller over the wire; audit log
  records status/error but NOT input payloads.
- The user's steer: "keep it simple (inline base64, size-capped) or
  treat it as a session Resource (write to disk, return a
  reference)" — open.
- This decision feeds Human observability in v1 (T7): if screenshots
  are Resources, a human dashboard can stream them; if inline, they
  ride the invoke response.

## Resolution

(AFNK — grilling session.)
