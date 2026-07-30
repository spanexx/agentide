# Capability surface and UI state

**Type:** `wayfinder:grilling` (HITL)
**Status:** claimed (2026-07-30, current session)
**Assigned:** spanexx
**Blocks:** Manifest and handler transport in browser (T2), Frontend developer
experience (T4), Package shape and dependencies (T6), the feature-pipeline run.

## Question

What capabilities does `@platform/sdk-browser` register, what does the
"UI state" responsibility mean in practice, and how does the developer
expose each capability without bloating the agent's context with the
whole DOM?

## What I know

- The architecture (`Agentide.md` §6) labels the Frontend SDK's
  responsibilities as "Register browser capabilities, Navigation, UI
  state, Browser communication" and gives `browser.navigate`, `browser.click`,
  `browser.input`, `browser.read`, `browser.scroll` as examples. T7
  disentangles these from browser-runtime (#12).
- CONTEXT.md tiers `browser.screenshot = read`, `browser.navigate = act`,
  `browser.click = act` — runtime-tier examples owned by the Browser
  Runtime Plugin, not the SDK.
- The Frontend SDK role is positioned as "the browser counterpart of
  sdk-node" — installed in a web app, exposes app-level capabilities,
  the Gateway routes invocations back to the right handler.
- Backend-runtime (BI[8b], shipped) already accepts WebSocket
  connections with the wire protocol sdk-node uses. sdk-browser
  reuses it.

## Decisions locked so far

### Q1 (2026-07-30, this session) — capability surface

**Original recommendation (rejected):** business capabilities from a
web app, mirroring `@platform/sdk-node`. The frontend developer writes
app-level handlers (`app.session.cart.read`, `app.session.theme.set`,
etc.) and registers them with the Gateway.

**Corrected scope (locked):** browser automation as a capability
surface. The browser is an observed, controlled thing; the agent
loop is:

1. agent → "go to www.myecom.com"
2. gateway → `browser.navigate` → browser-runtime
3. browser-runtime navigates; sdk-browser (running inside the page)
   introspects the new page
4. sdk-browser registers available caps (menu items, annotated
   buttons, annotated links)
5. agent → "what's on this page?"
6. agent → invokes a cap (e.g., click a button)
7. sdk-browser dispatches the invocation back to the DOM (fires the
   underlying event)
8. page reacts / navigates; SDK re-introspects; loop

`@platform/sdk-browser` = registration/introspection/dispatch layer
running inside the browser tab. `browser-runtime` (BI[12]) = the actual
browser-execution engine (launch, navigate, etc.). Tightly coupled pair,
same loop, different responsibility.

**Annotation model:** developer annotates DOM elements with capability
metadata. The agent never sees the DOM dump. The agent's catalog is
exactly the set of annotated capabilities the dev chose to expose —
bounded by the dev's intent.

### Q2 (2026-07-30, this session) — "UI state" redefinition

The phrase from `Agentide.md` §6 ("UI state" as a Frontend SDK
responsibility) had no concrete definition. With Q1 locked, **"UI
state" is the live capability catalog, scoped to the current page**:

- the agent sees the caps the SDK has registered for the current page,
  plus meta (description, input/output schema, tier);
- the SDK reconciles this catalog as the page changes (mutation observer,
  SPA navigation);
- caps are dynamic — pop into existence when an annotated element
  mounts, disappear when it unmounts;
- the agent's context is the catalog, never the DOM.

### Q3 (2026-07-30, this session) — metadata location → **A inline data attributes**

All capability metadata on the DOM element. `<button data-sdk-cap="cart.add"
data-sdk-desc="..." data-sdk-input='{...}' data-sdk-tier="act">`. Spice-jar
analogy: the label is on the jar. One source of truth.

**Why A over B/C/D:**
- one source of truth = no two-place sync;
- discoverable in the component source;
- framework-agnostic (works in React/Vue/Svelte/plain HTML);
- lowest dev ceremony;
- scales from 5 caps to 80+ caps without piling up.

**Cost acknowledged:** JSON-in-HTML-attribute is slightly ugly for nested
schemas. Mitigation: provide an `sdkCap` JSX helper that returns the
attribute string. Plain-string form still works.

### Q4 (2026-07-30, this session) — introspection trigger → **A MutationObserver**

SDK watches the DOM continuously. `data-sdk-cap` element mounts →
register with Gateway; element unmounts → unregister. `sdk.init()` once,
SDK does the right thing on every route change / conditional render.

**Why A over B/C:** the user-stated goal is dev-does-it-once. Continuous
observation is the right "right thing." Dev never wires `useEffect`s
against the SDK.

### Q5 (2026-07-30, this session) — invocation mechanism → **A DOM events**

SDK dispatches `CustomEvent('sdk:invoke', { detail: input })` on the
annotated element. Element-type-aware: native `click` for `<button>`,
native `submit` for `<form>`, native `input` for inputs. App code stays
untouched (existing `addEventListener`/`onClick`/`onSubmit` just works).

**Why A over B/C/D/E:** framework-agnostic, zero coupling to the app's
JS, every invocation is a visible / traceable DOM event, real for the
"agent invokes while user watches" flow.

### Q6 (2026-07-30, this session) — input delivery → **A + C (form-fallback)**

- **Default (`A`):** agent input lands in `CustomEvent.detail`. App
  reads `event.detail.sku` etc.
- **For `<form>` elements (`C`):** SDK reads `data-sdk-input`, populates
  matching form fields by name, then submits the form natively. Path of
  least resistance for real form workflows.

`B` and the rest fold under A/C as deviations.

## Default values (sane defaults where the dev omits the attr)

| Attribute | Default | Note |
|---|---|---|
| `data-sdk-tier` | `act` | Dev must declare `destructive` explicitly (e.g., a delete button) |
| `data-sdk-version` | `1.0.0` | Dev can override when a cap evolves |
| `data-sdk-desc` | empty string | Strongly encouraged but not enforced |
| `data-sdk-input` / `data-sdk-output` | empty schema `{}` | Cap accepts no input / returns nothing structured |

## Resolved — open questions moved to follow-on tickets

- **Connection identity (appId, JWT transport, Origin allowlist, native
  `WebSocket` API)** → T5 (WebSocket transport details).
- **Manifest shape consumed by the SDK at install time** → T2 (manifest
  and handler transport in browser).
- **DOM vs. JS handler hybrid support** → punted. v1 = DOM annotation
  only. JS-handler support can ship as a v2 if a customer asks.
- **Collision across tabs (two tabs of the same app both register
  `cart.add`)** → punted to a follow-on ticket when first hit.
- **Shadow DOM / iframe sub-trees** → punted. v1 = light DOM only.

## Resolved

Closed 2026-07-30, this session.

- **Q1 — Capability surface:** browser automation as a capability surface.
  Dev annotates DOM elements; SDK introspects; agent sees dev-exposed
  catalog. Rejected alternate: business caps from app JS handlers (would
  not satisfy the user's "agent while user watches" loop and would bloat
  the agent's context with the DOM dump).
- **Q2 — UI state:** the live, dev-controlled capability catalog scoped
  to the current page. Agent never sees DOM; agent sees the registered
  caps the dev chose to expose.
- **Q3 — Metadata location:** inline data attributes (option A).
- **Q4 — Introspection trigger:** continuous `MutationObserver` (option A).
- **Q5 — Invocation mechanism:** DOM event dispatch with element-type
  detection (option A).
- **Q6 — Input delivery:** CustomEvent detail, with form-field fallback
  for `<form>` elements (A + C).

## Verification note

- Code path: `packages/sdk-browser/src/introspect.ts` (MutationObserver),
  `packages/sdk-browser/src/register.ts` (cap-registration shape),
  `packages/sdk-browser/src/dispatch.ts` (CustomEvent + form-fill).
- Doc path: replace Q1 wording in `docs/architecture/Agentide.md` §6
  and T7 patch (the boundary doc) reflects these decisions.
- Drift log: D-XXX (TBD on close) — doc-vs-code shifts if the
  architecture doc's "UI state" paragraph is replaced by these locked
  decisions.

## Closing the ticket

Resolution must record:

- Q1 final answer + the rejected alternate + why the alternate was
  wrong;
- Q2 working definition of "UI state";
- Q3 chosen metadata location and the registration trigger
  (auto vs. imperative);
- any drift items that surface (cross-ticket with T7, docs drift log).
