# Drift Log
**Last updated:** 2026-07-29  **Open:** 8  **Resolved:** 15  **Critical/High:** 0

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

- **D-14** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` IMPL Status section shows all 8 phases as "⏳ Pending" despite full implementation. Resolved this session — see D-21.
  - Doc claim: `IMPL-permission-tiering.md:176-185` (original) — every phase "⏳ Pending".
  - Code reality: All 8 phases implemented across 5 packages: `capability-registry` (types + validator), `plugin-manager` (tier-convention), `platform-capabilities` (caps refactor), `gateway-core` (authz + filter), `agentide` (CLI).
  - Why matters: future agents reading IMPL would re-implement already-shipped work.
  - Owner: permission-tiering
  - To fix: IMPL §Status Updates rewritten to mark each phase ✅ Complete with file:line citations.

- **D-15** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` PRD-TRD & IMPL claim "No new flags" for CLI, but `--tier` flag exists (added by BI[6]). Resolved this session — see D-22.
  - Doc claim: PRD-TRD §Technical Design and IMPL Phase 5 both say "No new flags" for `packages/agentide`.
  - Code reality: `cli.ts:16` help text includes `[--tier <read|write|act|destructive>]`. CLI supports `--tier` filter (`cli.ts:214-229`). 4 tests in `cli-tier-column.test.ts:39-68` cover it. CONTEXT.md correctly documents it as a BI[6] addition.
  - Why matters: doc lies about CLI surface; future agents may remove `--tier` thinking it's an unowned flag.
  - Owner: permission-tiering
  - To fix: PRD-TRD §Technical Design and IMPL Phase 5 rewritten to note `--tier` was added by BI[6).

- **D-16** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` PRD-TRD Scenario 4 says "an error is thrown" for unknown tier derivation, but code returns `null` silently. Resolved this session — see D-23.
  - Doc claim: PRD-TRD §Scenario 4 — "If the computed tier doesn't match a known tier value, an error is thrown."
  - Code reality: `deriveTier()` at `validate.ts:91-101` returns `null` for unknown last segments. `validateRecord()` allows `null` for platform caps — no error thrown.
  - Why matters: documented contract diverges from lenient code behavior; platform caps with unknown permission verbs silently show `tier: null`.
  - Owner: permission-tiering
  - To fix: PRD-TRD §Scenario 4 rewritten to match lenient behavior (silent `null` fallback; operator responsible for explicit tier on runtime caps).

- **D-17** (Medium, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` IMPL Phase 2 Verify checklist lists 6 tier-convention unit tests, none of which exist. Resolved this session — see D-24.
  - Doc claim: IMPL Phase 2 Verify checklist (`IMPL-permission-tiering.md`) — 6 unit tests for `tierFromConvention` and `buildCapabilityRecords`.
  - Code reality: `packages/plugin-manager/src/__tests__/tier-convention.test.ts` did not exist before this session; tier convention was exercised only via integration-level paths.
  - Why matters: pure-function regression safety net was missing. A change to `tierFromConvention` or `buildCapabilityRecords` could silently break install paths.
  - Owner: permission-tiering
  - To fix: 11 unit tests written (`tier-convention.test.ts`), all passing.

- **D-18** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` CLI `--tier` filter re-parses permission strings instead of using first-class `card.tier` field. Resolved this session — see D-25.
  - Doc claim: PRD-TRD §Design rationale — tier field introduced specifically to avoid "parsing twice."
  - Code reality: `cli.ts:226-228` (original) — `full.permissions.some((p) => p.endsWith(`.${tierFilter}`))`. Permission-string parse, not card.tier lookup.
  - Why matters: works for 25 platform caps (all permissions end in `.read` or `.write`) but breaks for runtime caps or unusual permission names. Violates the design's "first-class tier field" spirit.
  - Owner: permission-tiering
  - To fix: `cli.ts` rewritten to use `card.tier !== tierFilter`. All 18 CLI tests still pass.

- **D-19** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` post-impl sim `stageTier()` did not exercise real `tierFromConvention()` from packages. Resolved this session — see D-26.
  - Doc claim: PRD-TRD §Simulation Contract — "post-impl sim walks the 8 scenarios using actual packages."
  - Code reality: `simulate.ts` (original) `stageTier()` printed hardcoded expected descriptions without importing or calling real `tierFromConvention()`.
  - Why matters: stage was theater — it printed what the doc said should happen, not what the real code does. Drift could go undetected.
  - Owner: permission-tiering
  - To fix: `tierFromConvention` now imported from `@platform/plugin-manager` (re-exported via `index.ts:107`); `stageTier()` calls it directly. `tier-convention.ts` re-exported from package index.

- **D-20** (Low, 2026-07-29, reporter: feature-pipeline-review) — `permission-tiering` post-impl sim dropped `stageInvoke()` and `stageAudit()` from pre-impl's 8 stages. Resolved this session — see D-27.
  - Doc claim: pre-impl sim had 8 stages: setup, token, filter, invoke, tier, validate, audit, scenario.
  - Code reality: post-impl sim (original) had 6 stages — `invoke` and `audit` were dropped.
  - Why matters: standalone invoke/audit flows were hidden; users had to step through `stageScenario()` to see denial + audit.
  - Owner: permission-tiering
  - To fix: `stageInvoke()` and `stageAudit()` re-added to `simulate.ts` and registered in `STAGES` map. Help text updated.

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
- **D-14 → D-21** (Resolved 2026-07-29 by drift-permission-tiering audit) — IMPL §Status Updates rewritten: each of 8 phases now marked ✅ Complete with file:line citations (`IMPL-permission-tiering.md:172-196`). Verified by re-reading the new status block.
- **D-15 → D-22** (Resolved 2026-07-29 by drift-permission-tiering audit) — PRD-TRD §Technical Design and IMPL Phase 5 both rewritten: `--tier <read|write|act|destructive>` and `--owner` filters now cited as BI[6] additions (with file:line for `cli.ts:214-229`). Verified by re-reading `PRD-TRD-permission-tiering.md:134-138` and `IMPL-permission-tiering.md:77-79`.
- **D-16 → D-23** (Resolved 2026-07-29 by drift-permission-tiering audit) — PRD-TRD §Scenario 4 rewritten to match lenient behavior: "If the computed tier doesn't match a known tier value, the tier is set to `null` (silent fallback — the operator is responsible for declaring an explicit tier on runtime caps via the verb convention). Platform caps with unknown permission verbs simply show `tier: null` in the catalog." Verified by re-reading `PRD-TRD-permission-tiering.md:43`.
- **D-17 → D-24** (Resolved 2026-07-29 by drift-permission-tiering audit) — 11 unit tests added at `packages/plugin-manager/src/__tests__/tier-convention.test.ts`. Covers IMPL Phase 2 Verify checklist (3 tierFromConvention direct cases, plus exhaustive verb-list coverage) plus 4 `buildCapabilityRecords` tests (explicit tier, override, inferred, TIER_REQUIRED error). All 119 plugin-manager tests pass; full repo: 394/394 pass.
- **D-18 → D-25** (Resolved 2026-07-29 by drift-permission-tiering audit) — `cli.ts:223-228` rewritten: `card.tier !== tierFilter` replaces `full.permissions.some(p => p.endsWith(`.${tierFilter}`))`. All 18 CLI tests still pass; typecheck clean.
- **D-19 → D-26** (Resolved 2026-07-29 by drift-permission-tiering audit) — `simulate.ts:23` imports `tierFromConvention` from `@platform/plugin-manager`. `plugin-manager/src/index.ts:107` re-exports from `./tier-convention.js`. `stageTier()` calls the real function and prints `tier=<result>`. Verified by reading the new `stageTier` body.
- **D-20 → D-27** (Resolved 2026-07-29 by drift-permission-tiering audit) — `simulate.ts` `STAGES` map now includes `invoke` and `audit` (line 152-160). `stageInvoke()` exercises 3 invocations (bootstrap, read-denied, write-ok). `stageAudit()` reads `${dataDir}/audit.log` via in-mem fs and notes the overwrite-vs-append caveat. Help text updated.
