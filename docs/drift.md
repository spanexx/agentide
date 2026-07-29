# Drift Log
**Last updated:** 2026-07-29  **Open:** 1  **Resolved:** 8  **Critical/High:** 0

## Open

- **D-1** (Medium, 2026-07-27, reporter: session-manager implementation) — session-manager pipeline documents disagree on touch visibility, resource attach state, and minimum timeout values.
  - Doc claim: `SessionManager` interface omits `touch()`, while FLOW requires every capability call to reset the idle timer (`docs/features/session-manager/TRD-session-manager.md:194-220`, `docs/features/session-manager/FLOW-session-manager.md:39-42`)
  - Code reality: public API includes `touch(sessionId)`, and attach permits suspended sessions (`packages/session-manager/src/types.ts:70-82`, `packages/session-manager/src/resources.ts:8-16`)
  - Why matters: Gateway integration and timeout tests need one consistent contract.
  - Owner: session-manager
  - To fix: reconcile PRD/TRD/FLOW/IMPL in follow-up doc pass.
  - Related: none

- **D-2** (Low, 2026-07-29, reporter: feature-pipeline-review) — `sdk-node` PRD-TRD events table missing 8th event `sdk.capability.rejected`. Resolved this session — see D-6.
  - Doc claim: events table lists 7 events (`docs/features/sdk-node/PRD-TRD-sdk-node.md:173-182`)
  - Code reality: `SdkEventPublisher.capabilityRejected()` exists and emits `sdk.capability.rejected` (`packages/sdk-node/src/events.ts:177-187`); full coverage test in `packages/sdk-node/src/__tests__/register.test.ts:126-152`
  - Why matters: subscribers reading only PRD-TRD are surprised by the event.
  - Owner: sdk-node
  - To fix: PRD-TRD updated; events.ts code map header updated.

- **D-3** (Low, 2026-07-29, reporter: feature-pipeline-review) — `sdk-node` PRD-TRD §API Contracts describes `register()` as throwing on Gateway-level collisions, but the real behavior is async event-driven. Resolved this session — see D-7.
  - Doc claim: `register()` "Throws on: ... Capability already registered by another app (collision)" (`PRD-TRD-sdk-node.md:157-161`)
  - Code reality: `register()` always resolves locally; Gateway rejection is surfaced later as `sdk.capability.rejected` event (`packages/sdk-node/src/index.ts:132-163`, `packages/sdk-node/src/invoke.ts:106-117`)
  - Why matters: callers await register() and assume the post-`await` state reflects Gateway acceptance.
  - Owner: sdk-node
  - To fix: PRD-TRD contract rewritten to describe async event-driven model.

- **D-4** (Low, 2026-07-29, reporter: feature-pipeline-review) — `sdk-node` PRD-TRD §Scenario 5 conflates developer-initiated `disconnect()` with simulated Gateway drop. Resolved this session — see D-8.
  - Doc claim: Scenario 5 says "the Gateway process dies (simulated by `disconnect` command)" — `PRD-TRD-sdk-node.md:44`
  - Code reality: real `sdk.disconnect()` sets `closed=true` and prevents reconnect (`packages/sdk-node/src/index.ts:182-193`, `packages/sdk-node/src/client.ts:136-138, 177-178`); the sim's `disconnect` command uses a dropper shim to fire a mock close event instead.
  - Why matters: anyone running the sim and then calling real `disconnect()` gets different behavior than the doc implies.
  - Owner: sdk-node
  - To fix: Scenario 5 rewritten to distinguish explicit `disconnect()` (no reconnect) from unexpected drop (auto-reconnect); sim's dropper behavior now documented in the scenario note.

- **D-5** (Low, 2026-07-29, reporter: feature-pipeline-review) — `sdk-node` IMPL Phase 3 references `connect.ts` and `connect.test.ts` that were consolidated into `index.ts` and `lifecycle.test.ts`. Resolved this session — see D-9.
  - Doc claim: IMPL Phase 3 lists `packages/sdk-node/src/connect.ts` and `connect.test.ts` as deliverables (`IMPL-sdk-node.md:58-59`)
  - Code reality: `connect()` logic inlined in `index.ts:121-130`; 9 tests for connect behavior in `lifecycle.test.ts`; `grep` returns 0 matches for `connect.ts` or `connect.test.ts` anywhere in `src/`.
  - Why matters: IMPL doc lies about file layout; future agents following the IMPL would create the wrong files.
  - Owner: sdk-node
  - To fix: IMPL Phase 3 updated with module-layout note pointing to the actual final structure.

---

## Resolved

- **D-2 → D-6** (Resolved 2026-07-29 by drift-sdk-node audit) — PRD-TRD events table now lists 8 events including `sdk.capability.rejected` with payload `{ appId, capability, reason }` and the asynchronous "When" clause. `events.ts` code map header updated to say "8 documented events" and CIDs list the rejected payload. Verified by re-reading `PRD-TRD-sdk-node.md:182` and `events.ts:6, 16`.
- **D-3 → D-7** (Resolved 2026-07-29 by drift-sdk-node audit) — PRD-TRD §API Contracts `register()` rewritten: synchronous throws limited to local validation (manifest missing/invalid, handler mismatch); Gateway-level rejection (collision, unauthorized) explicitly routed through the `sdk.capability.rejected` event with file:line citations to `events.ts:177-187` and `invoke.ts:106-117`. Verified by re-reading `PRD-TRD-sdk-node.md:157-162`.
- **D-4 → D-8** (Resolved 2026-07-29 by drift-sdk-node audit) — PRD-TRD §Scenario 5 rewritten: trigger now reads "the Gateway connection drops unexpectedly ... *not* a developer-initiated `sdk.disconnect()`"; "Then" clause cites the actual `reason` values (`"simulated-drop"`, `"error"`), the 30s backoff cap and ±20% jitter, and the `reconnected: true` payload field. A new sim-note paragraph explains the dropper shim and that `reset` is the real tear-down command. Verified by re-reading `PRD-TRD-sdk-node.md:41-47`.
- **D-5 → D-9** (Resolved 2026-07-29 by drift-sdk-node audit) — IMPL Phase 3 has a module-layout note pointing readers to `index.ts:121-130` for the inlined `connect()` and `lifecycle.test.ts` (9 tests) for the consolidated test coverage. Verified by re-reading `IMPL-sdk-node.md:58-61`.
- **D-10** (Accepted drift, 2026-07-29, sdk-node post-impl sim) — Post-impl sim replaces xterm.js terminal with a custom `<input>` + `<div>` terminal; no ANSI parsing, colors via CSS classes.
  - Doc reality: pre-impl sim was designed for full xterm.js emulation; post-impl sim is a styled chat box. Both show the same info.
  - Why matters: the divergence is intentional simplification (no CDN, faster load, browser-stable). Logging so a future reader of the archived pre-impl sim doesn't think it's missing functionality.
  - Verified by: drift-sdk-node audit, .reports/2026-07-29-drift-sdk-node.md.
- **D-11** (Accepted drift, 2026-07-29, sdk-node post-impl sim) — Post-impl sim uses `setInterval` polling (100ms) to detect state changes from async commands instead of inline `await sleep()`.
  - Doc reality: pre-impl sim had hardcoded delays per step; post-impl polls real SDK state. Better robustness for real timing.
  - Why matters: divergence is improvement. Logging so the pre-impl/post-impl diff isn't read as missing behavior.
  - Verified by: drift-sdk-node audit.
- **D-12** (Accepted drift, 2026-07-29, sdk-node post-impl sim) — Post-impl sim creates a real `createSdk()` instance per `cmdConnect()`; uses a dropper callback to fire a mock close event (bypassing real `sdk.disconnect()`) so the reconnect path is observable.
  - Doc reality: pre-impl sim used a single mutable global state. Post-impl sim drives the real SDK and works around the deliberate `disconnect()=no-reconnect` design.
  - Why matters: inherent to driving a real SDK from a browser sim. Sim's approach correctly uses the SDK's close/backoff mechanism, just via a different code path than the doc implies.
  - Verified by: drift-sdk-node audit.
- **D-13** (Accepted drift, 2026-07-29, sdk-node post-impl sim) — Post-impl sim's `sdk-iife.js` bundles the real SDK with a `ws→globalThis.WebSocket` shim (`ws-shim.cjs`) so it loads in the browser; the sim's prototype patch on `WsClient.prototype.open` then intercepts before any real socket is opened.
  - Doc reality: pre-impl sim was fully in-memory stubs. Post-impl needs the shim so the bundle parses without the `ws` Node-only import.
  - Why matters: necessary browser adaptation. Logging so the shim isn't read as missing functionality.
  - Verified by: drift-sdk-node audit.
