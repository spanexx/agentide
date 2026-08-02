# Screenshot payload

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed
**Assigned:** spanexx
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

**Status: CLOSED (2026-08-02, 9 grill questions, 3 rounds).**

### Locked decisions

- **Carrier: inline base64 first, session Resource over cap.** Under
  the size cap the image rides the invoke response as base64 (simple,
  wire-instant). Above it, browser-runtime writes the image to a
  session-owned resource file and returns a reference. Both surfaces
  exist; the happy path stays simple, the escape hatch handles MB
  shots. Screenshot is a low-level observation primitive, not the
  primary agent path — this keeps that posture.
- **Size cap: 256 KiB raw image bytes** (pre-base64). Rationale
  grounded in context-window math: base64 inflates ~1.33×, LLM tokens
  ≈ 4 chars each, so 256 KiB ≈ 85k tokens worst case inline. The cap
  is context protection — above it the image never enters the
  response, so it never enters the agent's context. Typical viewport
  PNGs (1280×800, ~100–400 KiB raw) mostly stay inline; fullPage /
  large viewports spill to resource.
- **Return shape: discriminated.** `{ format: 'png'|'jpeg', mode:
  'inline'|'resource', data?: base64, resourceId?: string, bytes }` —
  `data` XOR `resourceId`, `mode` discriminates. Audit logs this
  shape only (`{ mode, bytes, format }`), never the image itself, in
  either mode (matches CONTEXT.md outputs-logged-shape rule).
- **Input (extends T2's `{ tabId?, fullPage? }`):**
  `{ tabId?, fullPage?, format?: 'png'|'jpeg', quality?: number,
  mode?: 'inline'|'resource' }` — `png` default, `quality` 0–100
  default 80 (ignored for png), `mode` default `'auto'` (cap
  decides). `mode: 'resource'` lets the caller force a reference to
  keep context lean; `mode: 'inline'` forces inline.
- **Forced inline + oversize → error `BROWSER_SCREENSHOT_TOO_LARGE`,
  `retryable: false`.** Caller forced a mode the data can't fit — fix
  input (use resource mode), don't retry. Consistent with the T2
  retryable policy (misuse not retryable).
- **Resource lifecycle: session-owned.** File lives in the session
  resource dir, cleaned on `session.closed` by session-manager — no
  per-call cleanup, no TTL, no explicit delete cap. Reuses the
  existing session resource tracking (map Notes: `session.closed`
  cleanup).

### What this unblocks

- T7 Human observability in v1: screenshots can be Resources
  (`mode: 'resource'`), so a human dashboard can stream them from the
  session resource dir — but v1 doesn't depend on it; inline also
  rides the invoke response. The dashboard question stays in T7.

### Open questions for later tickets

- None — payload shape, cap, lifecycle, audit all locked. Image
  format options (jpeg quality, scale) are driver-level detail for
  build time.

### Delivery routing

**`delivery: decision-only`** — this ticket resolved a contract
question with no build work; the build happens via the map's eventual
`delivery: feature-pipeline` for browser-runtime itself.
