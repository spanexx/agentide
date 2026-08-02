# Audit — browser-runtime decisions vs shipped sdk-browser + platform stack

**Date:** 2026-08-02
**Trigger:** User's grill-with-docs mandate: verify that the decisions locked for
`packages/browser-runtime` (T2/T4/T5, Q1-Q6, F7/F8, Q5-revision) do not contradict
what was actually shipped (sdk-browser, backend-runtime, gateway-core,
plugin-manager, capability-registry, session-manager).
**Method:** Read shipped source (file:line citations below) and compare against the
locked contracts in GRILL-browser-runtime.txt, the wayfinder tickets, and CONTEXT.md.

---

## Verdict summary

| # | Area | Verdict |
|---|---|---|
| 1 | Error envelope (BROWSER_* code + retryable through GATEWAY_HANDLER_ERROR) | **CONTRADICTION** — must be fixed in PRD (additive envelope extension) |
| 2 | T4 caps-settled signal ("event-bus, per session") | **CONTRADICTION** — signal is page-local; must switch to DOM-read at navigate |
| 3 | sdk-browser gateway registration (register wire frame) | **SHIPPED BUG FOUND** — name-only frame fails registry validation; connection closed with "register-failed" |
| 4 | Two tabs of the same app (T4 "distinguishable") | **LIMITATION** — backend-runtime replaces the first connection; document as v1 non-goal |
| 5 | T5 teardown event name (`session.closed`) | **CONTRADICTION (minor)** — shipped event is `session.destroyed` |
| 6 | F8 instance disambiguation vs sdk-browser count model | Consistent — verified |
| 7 | F7 destructive-navigate guard rationale | Consistent — verified (pagehide unregisters caps) |
| 8 | Q5-revision runtime-snapshot model | Consistent — confirmed (stronger: even appId-level registration is unreliable today, see #3) |
| 9 | Tiers (read/act/destructive) for plugin caps | Consistent — verified (with a manifest nuance) |
| 10 | Plugin dispatch shape (owner `plugin:<id>`, sessionId in ctx) | Consistent — verified |

---

## Finding 1 — Error envelope: BROWSER_* code + retryable are LOST in the shipped pipeline

**Contract claim** (`tickets/capability-contracts.md:63-70`):
> "Errors: `BROWSER_*` codes pass through from the plugin to the caller. The
> gateway wraps handler failures in the `GATEWAY_HANDLER_ERROR` envelope (per
> gateway-plugin-dispatch) and preserves the `BROWSER_*` code in the structured
> details; the caller-visible error code is the `BROWSER_*` one."

**Shipped reality:**
1. `plugin-manager/src/index.ts:218-226` — handler throw is wrapped:
   `PluginManagerError(PLUGIN_HANDLER_ERROR, ..., { pluginId, capabilityName, originalError: e.message })`.
   Only the **message** survives; the thrown error's **code and retryable are dropped**.
2. `gateway-core/src/dispatch.ts:167-170` (translatePluginError) maps it to
   `GatewayError(GATEWAY_HANDLER_ERROR, ..., { pluginId, capability, originalError: err.message })` —
   `retryable` defaults to `false` (errors.ts constructor default).
3. `gateway-core/src/handle-invocation.ts:309-318` — caller receives
   `{ error: { code: "GATEWAY_HANDLER_ERROR", message, details, retryable: false } }`.

**Consequence:** our retryable policy (GRILL T2 + Q4: `BROWSER_WAIT_TIMEOUT`,
`BROWSER_SELECTOR_NOT_FOUND/TIMEOUT`, `BROWSER_NAVIGATION_TIMEOUT`,
`BROWSER_LAUNCH_FAILED`, `BROWSER_CRASHED` = retryable: true) is **unexpressible**
through the plugin path as shipped. Callers always see `GATEWAY_HANDLER_ERROR`,
retryable: false. Note: `PRD-TRD-gateway-plugin-dispatch.md:48` itself only promises
the original **message** in details — our ticket overreached beyond its source doc.

**Resolution (locked for PRD-TRD):** additive, backward-compatible envelope
extension: plugin-manager preserves `originalErrorCode` + `retryable` in
`PLUGIN_HANDLER_ERROR` details when the handler throws an Error carrying those
fields; translatePluginError passes them into `GATEWAY_HANDLER_ERROR` details.
Envelope code stays `GATEWAY_HANDLER_ERROR`; callers match on
`details.browserCode` and honor `details.retryable`. Existing callers unchanged
(extra detail fields only). Contract wording in capability-contracts.md corrected
to match (done this session).

---

## Finding 2 — T4 caps-settled signal: "event-bus, per session" is impossible as written

**Contract claim** (`tickets/sdk-browser-coupling-after-navigate.md:44-49`, map.md
T4 bullet, CONTEXT.md T4 entry):
> "browser-runtime waits for sdk-browser's 'caps registered' signal (event-bus, per session)"

**Shipped reality:**
- `sdk-browser/src/index.ts:33-37` — `createSdk()` creates its **own local** event
  bus (`createEventBus()`), which only page-side subscribers see. The
  `sdk.capability.registered` event fires on that page-local bus
  (events.ts `SdkCapabilityRegisteredPayload`), **invisible to the gateway
  process** where browser-runtime runs.
- The only gateway-side observable is `backend-runtime/src/server.ts:158-190`
  handling of the `sdk.capability.register` wire frame — appId-keyed
  (`capsByAppId`), and it emits **no bus event per registration** (only
  `sdk.connection.accepted` / `sdk.connection.closed`).

**Resolution (locked for PRD-TRD):** browser-runtime reads the tab's DOM itself at
navigate — Playwright `evaluate` counting `[data-sdk-cap]` elements (the shipped
`CAP_ATTR` from `sdk-browser/src/observer.ts`). Settle = stability re-read
(read → short wait → read; stable → `capsSettled: true`, changed → wait up to the
settle timeout). Benefits: zero shipped-package changes; naturally per-tab; immune
to the register-frame bug in Finding 3 (reads the page regardless of wire state).

---

## Finding 3 — SHIPPED BUG: sdk-browser's register frame fails registry validation

**Evidence:**
- `sdk-browser/src/index.ts:131` — `sendRegister = (name) => client.send({ type: "sdk.capability.register", name })` — **name only**.
- `backend-runtime/src/server.ts:170-186` — builds the record from the frame:
  `version: msg.version` (undefined), `description: msg.description` (undefined), `permissions: []`.
- `capability-registry/src/validate.ts:34-43` — `validateRecord` requires
  **`version`** ("version is required") and **`description`** ("description is required").
- `backend-runtime/src/server.ts:190-196` — on register rejection:
  `safeClose(socket, 1000, "register-failed")` — **the SDK connection is closed**.
- Parity check: `sdk-node/src/index.ts:142-150` sends the full frame
  (`name, description, version, permissions, tier`) — sdk-node passes validation;
  sdk-browser can never succeed today.

**Consequence:** a page using sdk-browser connects, auths, registers → validation
fails → server closes the socket → reconnect loop (or dead connection). The page's
caps **never reach the registry**. Every doc that assumes "sdk-browser registers
caps with the Gateway" (sdk-browser-coupling ticket, sdk-browser T1 loop) is
currently broken end-to-end at the wire level.

**Impact on browser-runtime:** reinforces Finding 2's DOM-read resolution (it does
not depend on wire registration) and the Q5-revision runtime-snapshot model.
**Fix belongs to sdk-browser** (send `version` + `description` + `permissions` like
sdk-node, or backend-runtime defaults) — out of browser-runtime scope; logged as
drift D-40 for the sdk-browser owner. Flagged for user review (do not fix silently
— shipped package outside this pack's scope).

---

## Finding 4 — Two tabs of the same app: the second connection EVICTS the first

**Evidence:** `backend-runtime/src/server.ts` — the appId connection registry
replaces the previous socket for the same appId (`replacedSockets` WeakSet), and
the close handler runs `removeByOwner("backend-sdk-<appId>")` +
`capsByAppId.delete(appId)` + `rejectAllPending`. Two tabs of the same application
→ second tab kills the first tab's registrations and in-flight invocations.

**Consequence:** T4's "two tabs of the same app are distinguishable" holds **only**
in browser-runtime's per-tab snapshot (Q5-revision model). At the gateway, appId
registration is single-slot. **PRD non-goal (v1):** multi-tab-same-app at the
gateway; keying registrations by tabId is a cross-package change, deferred. The
per-tab snapshot makes this invisible to the agent loop for v1.

---

## Finding 5 — T5 teardown event: `session.closed` does not exist

**Contract claim** (GRILL T1/T5 lines, map.md T5 bullet, CONTEXT.md T5 entry):
> "`session.closed` = teardown"

**Shipped reality:** `session-manager/src/events.ts:5-11` — event names are
`session.created`, `session.suspended`, `session.resumed`,
`session.cleanup_resources`, `session.destroyed`. No `session.closed`.

**Resolution:** wording fixed across GRILL/map/CONTEXT (done this session):
teardown = `session.destroyed`; resource purge = `session.cleanup_resources`.

---

## Finding 6 — Consistent: F8 instance disambiguation vs sdk-browser count model

`observer.ts` dedups by capability name with a **count** (`CapabilityView.count`,
one card per name), and `CapabilityView` has no tabId/address — the SDK is
tab-unaware and instance-unaware by design (browser SDKs can't know page identity
across tabs). `browser.query { matches, addresses }` + `instance` is the
runtime-side lens over the same DOM fact. No contradiction; F8 complements the
shipped model (also matches the "count" convention: matches = count of `data-sdk-cap`
elements for that name on the tab).

---

## Finding 7 — Consistent: F7 destructive-navigate guard is grounded in shipped behavior

`lifecycle.ts` (pagehide, non-persisted) → `disconnect("pagehide")` → server close
handler → `removeByOwner` — navigating away **destroys** the page's gateway
connection and caps. F7's premise (different-url navigate on a caps-bearing tab
destroys live agent work) is real shipped behavior. bfcache (`persisted: true`)
keeps the connection — same-url re-navigate staying allowed is consistent.

---

## Finding 8 — Consistent (confirmed): Q5-revision runtime-snapshot model

No tab dimension exists anywhere in the shipped registration path:
sdk-browser has no tab awareness (`types.ts` Sdk has no tabId), backend-runtime
keys by appId, registry keys by `name\x1Fversion` per owner. Finding 3 makes the
appId-level path additionally unreliable for sdk-browser today. The runtime-snapshot
model (registry untouched, per-tab caps held by browser-runtime) is the only
design consistent with shipped reality.

---

## Finding 9 — Consistent: plugin cap tiers (with a manifest nuance)

- Plugin caps register as `type: "runtime"`; `validate.ts` requires tier
  `read | act | destructive` (no "write" for runtime).
- `tier-convention.ts` infers tiers from verbs: `query` ∈ READ_VERBS (browser.query
  = read ✓), `navigate/click/type/scroll/wait` ∈ ACT_VERBS ✓.
- **Nuance:** `launch` is in no verb list and `close` ∈ ACT_VERBS — the manifest
  must declare tiers explicitly for `browser.launch` (act), `browser.close`
  (destructive), `browser.screenshot` (read), `browser.tab.close` (destructive).
  Do not rely on convention for these.

---

## Finding 10 — Consistent: plugin dispatch shape

`handleInvocation(name, input, sessionId)` resolves the cap owner via
`registry.describe(name)`, requires `plugin:<id>` ownership, loads the handler
from `runtime.entry` ESM default export `{ [capName]: async (input, ctx) => result }`,
and passes `ctx = { pluginId, sessionId }` (`plugin-manager/src/handler-loader.ts:38-40`,
`index.ts:190-226`). **sessionId IS available to handlers** — per-session browser
state (T4/T5) is achievable. HANDLER_NOT_FOUND paths (no entry, disabled plugin,
cap not in map) all exist.

---

## Locked resolutions

1. **Error envelope (Finding 1):** additive extension to plugin-manager +
   gateway-core (preserve originalErrorCode + retryable in details); envelope code
   stays GATEWAY_HANDLER_ERROR; capability-contracts.md wording corrected.
   Cross-package but tiny and backward compatible — the PRD-TRD will scope it.
   **User review requested** (it touches two shipped packages).
2. **Caps-settled (Finding 2):** DOM-read at navigate (`[data-sdk-cap]` count,
   stability re-read). Zero shipped changes.
3. **Register-frame bug (Finding 3):** logged as drift D-40, owner sdk-browser.
   NOT fixed in this pack. **User review requested.**
4. **Two-tab limitation (Finding 4):** PRD non-goal.
5. **Event names (Finding 5):** docs corrected this session.

## References

- GRILL-browser-runtime.txt (Q4, T2, T4, T5; F7/F8)
- tickets/capability-contracts.md, tickets/sdk-browser-coupling-after-navigate.md
- map.md T3/T4/T5 bullets; CONTEXT.md T3/T4/T5 + Q5-REVISION + F8 entries
- Shipped source: sdk-browser (index.ts, observer.ts, events.ts, types.ts,
  lifecycle.ts, client.ts), backend-runtime (server.ts), gateway-core (dispatch.ts,
  handle-invocation.ts, errors.ts), plugin-manager (index.ts, handler-loader.ts,
  types.ts, tier-convention.ts, manifest.ts), capability-registry (validate.ts,
  store.ts, types.ts), session-manager (events.ts), sdk-node (index.ts)
