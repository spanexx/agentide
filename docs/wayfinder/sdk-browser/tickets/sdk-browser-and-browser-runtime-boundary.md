# sdk-browser and browser-runtime boundary doc

**Type:** `wayfinder:task` (HITL — doc patch)
**Status:** open
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
