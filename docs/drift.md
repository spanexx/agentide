# Drift Log
**Last updated:** 2026-07-30  **Open:** 1  **Resolved:** 16  **Critical/High:** 0


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
- **D-1 → D-28** (Resolved 2026-07-29 by session-manager doc reconciliation) — session-manager docs were reconciled with code across 5 points of disagreement:
  - **`touch()` visibility (TRD + IMPL):** Code has `touch(sessionId)` at `packages/session-manager/src/index.ts:132-138` and in the `SessionManager` interface at `types.ts:137`. FLOW already cited `touch()` behaviorally (`FLOW-session-manager.md:41`). TRD §2.3 was missing the API contract; added a full entry (params, response, errors, side effects) at `TRD-session-manager.md:276-290`. TRD high-level architecture diagram updated to list `touch()` (`TRD-session-manager.md:72`). IMPL Phase 0 §SessionManager interface updated to include `touch()` (`IMPL-session-manager.md:52`).
  - **`touch()` on non-active session (IMPL):** IMPL said "no-op" (`IMPL-session-manager.md:147` original). Code throws `SessionNotActiveError` (`index.ts:134`; test at `session-manager.test.ts:114`). IMPL corrected to: "`touch()` on a non-active session (suspended or archived) throws `SessionNotActiveError`".
  - **`attachResource` permits suspended (TRD + IMPL):** TRD §2.3 was silent on suspended. IMPL Phase 3 said "validates session is active" (`IMPL-session-manager.md:206` original). Code at `resources.ts:35` checks `status === "archived"` only — permits active AND suspended (test at `session-manager.test.ts:141-148`). TRD §2.3 `attachResource` updated: "Permitted when session status is `active` OR `suspended` — resources attached while suspended survive resume without re-attachment." IMPL Phase 3 updated: "validates session is active or suspended (rejects archived)".
  - **Minimum timeout value (IMPL):** IMPL Phase 1 said `timeout >= 1000` (`IMPL-session-manager.md:79` original). Code enforces `< 1` rejection at `index.ts:109-110`; tests use 1ms and 10ms (`session-manager.test.ts:107, 145`). IMPL corrected to `timeout >= 1`.
  - **No code changes required** — all behavior was already correct; the work was doc reconciliation. Full test suite: 394/394 pass; typecheck clean.

---

## D-29 — `gateway-plugin-dispatch` (BI[8a]) — DEFERRED pending design decision

**Where:** `packages/gateway-core/src/dispatch.ts:90-103` (stub for `plugin:<id>` owners); `docs/Feature_Backlog.md` row 8a.

**Found** 2026-07-30 during drift audit. The dispatch path for `owner.startsWith("plugin:")` throws `GATEWAY_MANAGER_UNAVAILABLE { retryable: true }` because `plugin-manager` doesn't yet expose a `handleInvocation()` API for the gateway to call into, and — more fundamentally — the manifest doesn't carry handler code, only capability metadata.

**Why this differs from BI[8b (the sibling pack that just shipped).** BI[8b] replaced a stub for a path whose wire protocol and handler location were *fully designed*: `backend-sdk-*` owner prefix, `@platform/sdk-node` was the handler host, only the kernel wiring was missing. BI[8a] is a **fundamental unresolved design question**: how does a plugin actually register a handler function?

Three plausible answers, each with different scope:
- **(a) In-process JS handler:** manifest gains a `runtime: { entry: "./dist/index.js" }` field; `plugin-manager` does `await import(entry)` to get a handler map. Needs module resolution + lifecycle for the loaded module.
- **(b) Child-process runtime:** each plugin is a separate Node process; gateway spawns it, communicates via IPC. Matches the architecture docs' "Runtime Capabilities → Browser Runtime example" but is a much bigger build (process supervisor, IPC protocol, crash recovery).
- **(c) WebSocket/IPC to a remote runtime:** analogous to BI[8b]'s `backend-sdk-*` path but for a runtime process rather than a SDK. Most architecturally clean but most surface area.

**Why deferred, not addressed now.** The current stub is non-blocking: any operator trying to invoke a `plugin:<id>` cap today gets a clear `MANAGER_UNAVAILABLE { retryable: true }` with the pluginId in `details`. No code path is currently broken. The cost of doing BI[8a] wrong is high: choosing (a) when the right answer is (b) means a future `browser-runtime` pack (Tier 4, item 12) hits a wall and we redo the interface. The PHILOSOPHY.md replaceability test is at risk if the plugin-loading design locks in too early.

**What unblocks BI[8a.** A concrete consumer. The fastest path: when BI[12 `browser-runtime` starts, BI[8a] can be designed in tandem — the browser runtime IS the first `plugin:<id>` consumer, so its handler-loading requirements (in-process browser-tab control vs remote WebDriver vs Playwright) constrain the API. Until then, BI[8a] is a design problem looking for a problem to solve.

**Status:** DEFERRED. Backlog row 8a remains `NOT STARTED`; no code changes in this session. The stub at `dispatch.ts:90-103` and the audit-recorded `MANAGER_UNAVAILABLE` response stay as the contract for anyone trying to invoke a runtime plugin cap before BI[8a] ships.

**Next agent/session actions:**
1. When starting BI[12 `browser-runtime`, do BI[8a] in the same or previous pack so the handler-loading design is informed by a concrete consumer.
2. The GRILL for BI[8a] must explicitly enumerate the handler-loading options (a/b/c above) and pick one with rationale tied to browser-runtime's needs.
3. The plugin-manifest schema gains a new top-level field (likely `runtime: { entry, type }` or similar). This is a breaking change to the manifest format — coordinate with the plugin-marketplace pack (#16) so marketplace-published plugins can declare their handler location.
