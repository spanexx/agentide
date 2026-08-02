# sdk-browser and browser-runtime boundary doc

**Type:** `wayfinder:task` (HITL — doc patch)
**Status:** closed 2026-08-02
**Blocks:** —

## Question

Update `docs/architecture/Agentide.md` §6 (SDKs) and §7 (Runtimes) — and
the runtime examples in `docs/architecture/Runtime_Capabilities.md` — so
that the *boundary* between `@platform/sdk-browser` (Frontend SDK) and
`browser-runtime` (#12) is unambiguous.

## Why this is a `task`, not a `grilling`

The decision is already implicit in the architecture: SDKs *register*
capabilities, runtimes *execute* them. They live on opposite sides of the
Gateway. But the doc text blurs the line:

- `Agentide.md` §6 (Frontend SDK responsibilities) lists
  `browser.navigate`, `browser.click`, `browser.input`, `browser.read`,
  `browser.scroll` as **example capabilities the Frontend SDK would expose**.
  Wrong: those examples belong to browser-runtime, not the SDK.
- §6 also names "Navigation" and "UI state" as Frontend-SDK
  responsibilities. The latter isn't defined anywhere.
- `Runtime_Capabilities.md` calls Browser Runtime "Status: built." That's
  wrong for v1 — browser-runtime doesn't exist yet (it's #12, future). The
  only "Browser Runtime" today is the *specification*, not an implementation.

## What the patch must accomplish

1. In `Agentide.md` §6 (Frontend SDK), remove the `browser.navigate` family
   of examples from the SDK responsibilities list. Replace with a pointer:
   "Browser automation capabilities (`browser.*`) are provided by
   `browser-runtime` (Runtime Plugin, #12), not by the SDK. The SDK's
   role is to expose *application* capabilities from a web app — same as
   `@platform/sdk-node` exposes them from a Node app."

2. In `Agentide.md` §6, give a one-paragraph working definition of "UI
   state" — or remove it from the responsibilities list if it has no
   concrete meaning. (Cross with T1's resolution.)

3. In `Agentide.md` §7 (Runtimes), flip "Browser Runtime — Status: built."
   to "Status: not yet built (backlog #12)." Docker / Git / File / K8s /
   Database runtime paragraphs already say "Status: not yet built."

4. In `Runtime_Capabilities.md`, the Browser Runtime example namespace
   block (`browser.navigate`, `browser.click`, etc.) is fine to *list*
   the future namespace but should carry an explicit "(future — see
   browser-runtime backlog #12)" header. The worked tier-table for
   browser caps can stay as the canonical example.

5. Add a short "Boundary at a glance" sentence to `Agentide.md` §6:
   "Frontend SDK = installed *inside* the app, registers capabilities
   owned by the app. Runtime Plugin = installed *alongside* the platform,
   exposes execution environment capabilities."

## Closing the ticket

- PR or patch with the five changes above;
- `docs/drift.md` entry if any of the doc updates shift the
  documented intent (Cross with T1's outcome).

## Resolution (2026-08-02)

All five changes applied + one same-boundary fix (noted below). Ticket closed;
no drift entry needed — the patch corrects stale doc text to match already-
settled intent (SDKs register, runtimes execute; browser-runtime is backlog #12).

1. **`docs/architecture/Agentide.md` §6 Frontend SDK** — `browser.navigate`
   family removed from responsibilities + example capabilities (now
   `customer.read` / `order.submit`). Added the pointer sentence:
   "Browser automation capabilities (`browser.*`) are provided by
   `browser-runtime` (Runtime Plugin, backlog #12), not by the SDK."
2. **§6 "UI state" defined** (crossed with T1): the live, dev-controlled
   catalog of the page's annotated capabilities, scoped to the current page —
   kept in sync via initial scan + `MutationObserver` walking `data-sdk-cap`;
   explicitly *not* a separate state object. "Navigation" responsibility
   removed (belongs to browser-runtime).
3. **§7 Browser Runtime** — "Status: built." → "Status: not yet built
   (backlog #12)." Backend Runtime stays "built" (accurate); Future Runtimes
   unchanged.
4. **`docs/architecture/Runtime_Capabilities.md`** — Browser Runtime namespace
   block now carries "(future — see `browser-runtime`, backlog #12: no
   implementation ships in v1; this namespace is the specified, canonical
   example only.)" header. Worked tier-table for browser caps untouched.
5. **§6 "Boundary at a glance"** sentence added: "Frontend SDK = installed
   *inside* the app, registers capabilities owned by the app. Runtime Plugin =
   installed *alongside* the platform, exposes execution environment
   capabilities." (phrased as the ticket specified: same role as
   `@platform/sdk-node` in a Node app).

**Extra (same boundary, same doc):** `Agentide.md` §3 "Applications expose"
example listed `browser.navigate` / `browser.click` as application-exposed
caps — removed, with a one-line pointer to `browser-runtime` (#12). This was
the same blur the ticket exists to fix; flagged here rather than left silent.

**Facts later work depends on:** §6 Frontend SDK responsibilities now read
"register application capabilities from the page (DOM-annotation model)",
"UI state (defined)", "browser communication (WebSocket, same wire protocol)",
"dispatch invocations as DOM events (CustomEvent fan-out)". These mirror the
T1/T2 wayfinder locks — safe for the feature-pipeline GRILL to quote.

**Delivery tag:** `delivery: feature-pipeline` — T7 was the last open ticket;
the map is complete and the way is clear.
