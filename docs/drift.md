# Drift Log
**Last updated:** 2026-08-07  **Open:** 33  **Resolved:** 63  **Critical/High:** 0

## Open

- **D-100** (Low, 2026-08-07, reporter: adapter-mcp migration Phase 3) — adapter-core's `capability.lookup` descriptor extractor read a FLAT shape (`output.inputSchema`); the kernel's `capability.describe` returns `DescribeResult { capability: CapabilityRecord | null, selectedVersion }` (capability-registry `store.ts:112-129` nests under `capability`). The lookup shipped UNWIRED (A6 Q4 — "WS door doesn't gain discovery in v1"); the MCP migration is its first consumer. Without the fix, every MCP tool card would render the generic schema (every descriptor.inputSchema null).
  - Doc claim: A6 resolution — "lean utility... no tier logic in core"; lookup ships unwired (`docs/wayfinder/adapter-core/tickets/A6-capability-lookup.md`).
  - Code reality: `packages/adapter-core/src/capabilities/lookup.ts` `extractDescriptor` — flat read pre-fix; kernel shape verified at `packages/capability-registry/src/store.ts:76-129` (DescribeResult nests `capability`).
  - Why matters: silent data corruption if consumed as-is — tools lose their input schemas. Unwired status hid it until MCP migration.
  - Owner: adapter-core (A6 first consumer).
  - To fix: code — `extractDescriptor` reads the nested `capability` record with a flat fallback (done in adapter-mcp Phase 3, 2026-08-07). Core tests (flat fixtures) stay green via the fallback; MCP tests green via the nested read.
  - Verified by: adapter-mcp Phase 3 (core + MCP suites green).
- **D-95** (Low, 2026-08-07, reporter: adapter-core drift review) — PRD-TRD describes `lazy` auth mode as a distinct behavior; the shipped `auth-policy.ts` default is `early` and `lazy` behaves identically in v1 (deferral noted in code). Kernel-verifies-per-call is the intended future, not currently reachable.
  - Doc claim: PRD-TRD-adapter-core.md:108 — "`{mode: "early" | "lazy"}` knob; early verifies once at open and caches identity" (implies lazy ≠ early).
  - Code reality: `packages/adapter-core/src/auth-policy.ts:65` (`mode: options.mode ?? "early"`); `auth-policy.ts:4-5,63` — lazy noted as deferred, identical to early today.
  - Why matters: documentation-only; no operator sees a difference. The knob's promised lazy path exists as a stub.
  - Owner: adapter-core (A8 when MCP migrates — MCP may be the first true lazy consumer).
  - To fix: code — implement lazy verification (skip pipeline verify; kernel per-call) when A8 lands, or doc — mark the knob `early`-only in v1.
  - Verified by: adapter-core drift review 2026-08-07 (Contract Gap).

- **D-96** (Low, 2026-08-07, reviewer: adapter-core drift review) — A1's locked 6-key `createAdapterPipeline({gateway, config, input, output, errors, response})` shipped as `{gateway, errors, response}` with per-invocation `input`/`output` flowing through `PipelineInvocation` args; `config` passthrough omitted in v1. PRD-TRD now reflects the shipped shape.
  - Doc claim: PRD-TRD-adapter-core.md:116 (updated 2026-08-07 to shipped shape; original A1 ticket stated the 6-key form).
  - Code reality: `packages/adapter-core/src/pipeline.ts:15-21` — `AdapterPipelineOptions {gateway, response, errors}`; `PipelineInvocation` carries name/input/token/sessionId/mode per request; A1 mapping documented in the file header.
  - Why matters: shape is contract — a future door (A9 REST) must code to the shipped 3-key form, not the map's original wording.
  - Owner: adapter-core.
  - To fix: doc — done 2026-08-07 (PRD-TRD + IMPL updated).
  - Verified by: adapter-core drift review; pipeline.ts source.

- **D-97** (Low, 2026-08-07, reviewer: adapter-core drift review) — IMPL Phase 7 planned the pipeline wiring in `packages/adapter-websocket/src/server.ts`; it landed in `invoke.ts` (server.ts keeps transport lifecycle). IMPL updated 2026-08-07.
  - Doc claim: IMPL-adapter-core.md:93 (pre-fix) — "Edit `server.ts` — transportation lifecycle stays, invocation path uses pipeline handlers".
  - Code reality: `packages/adapter-websocket/src/invoke.ts` carries the `createAdapterPipeline` call; `server.ts` untouched by migration (git show 0bc1046 --stat).
  - Why matters: doc-only; next reader of IMPL would look in the wrong file.
  - Owner: adapter-core.
  - To fix: doc — done (IMPL Phase 7 updated).
  - Verified by: drift review 2026-08-07.

- **D-98** (Low, 2026-08-07, reviewer: adapter-core drift review) — the WebSocket door imports `originMatches` from `@spanexx/gateway-core` re-export, not from adapter-core — a one-import exception to A1's "doors import only adapter-core". Accepted under the zero-delta rule (moving it would touch origin-binding code with no behavior gain).
  - Doc claim: A1 lock — "doors import ONLY adapter-core (re-exports)" (`docs/CONTEXT.md` Decisions Log 2026-08-07).
  - Code reality: `packages/adapter-websocket/src/auth.ts` — `import { ERROR_CODES, originMatches, verifyToken, ... } from "@spanexx/gateway-core"`.
  - Why matters: a single seam-outstanding; if a door needs the same primitive later, adapter-core should re-export it.
  - Owner: adapter-core (A8 follow-up).
  - To fix: code — adapter-core re-exports `originMatches`; WS door imports it from adapter-core (mechanical, zero-delta).
  - Verified by: drift review 2026-08-07.

- **D-99** (Medium, 2026-08-07, reviewer: adapter-core drift review) — `packages/adapter-core` is not in the publish pipeline: release-please-config.json lists 14 packages, missing the 16th (adapter-core @0.1.0); release.yml build/publish filters likewise. A release run would silently never publish adapter-core. Fixed 2026-08-07 (config + manifest + workflow filters).
  - Doc claim: ci-cd-agentide skill — "15 packages published" / release-please config is the package list source.
  - Code reality: `.github/release-please-config.json` (14 entries, no adapter-core); `.github/release-please-manifest.json` (none); `.github/workflows/release.yml:53,61` filters (no adapter-core).
  - Why matters: release-blocking for the pack — adapter-core would build but never publish.
  - Owner: release pipeline.
  - To fix: code — add `packages/adapter-core` to config + manifest (0.1.0) + both workflow filters after gateway-core (dep order). Done 2026-08-07.
- Related: docs/wayfinder/adapter-core/map.md (A1).

- **D-100** (High, 2026-08-07, reporter: A9-R1 research) — `createCapabilityLookup.describe()` reads `name` / `description` / `inputSchema` / `tier` from the top level of the kernel response, but `capability.describe` returns `DescribeResult` with everything nested under `capability`. Empirically: every describe returns `{name:"", description:"", inputSchema:null, tier:null}` against the real kernel. The unit test passes only because the fake returns the flat shape the kernel never produces.
  - Doc claim: A6 lock — "byte-identical by construction" (CONTEXT.md Decisions Log 2026-08-07, A6 entry).
  - Code reality: `packages/adapter-core/src/capabilities/lookup.ts:106-115` (`extractDescriptor` reads top-level fields); `packages/gateway-core/src/factory.ts:572-578` (kernel returns `DescribeResult`, wrapping `CapabilityRecord` under `capability`); MCP's own extractor gets this right at `packages/adapter-mcp/src/translate.ts:114-127` (unwraps `rec["capability"]` first).
  - Why matters: latent in v1 (A6 shipped the lookup deliberately unwired, `capabilities/lookup.ts:8-9`), but live for A9 (REST intends to expose `GET /capabilities` via the shared lookup) and direct threat to A8's "MCP `scenarios.test.ts` + `translate.test.ts` run with ZERO edits" acceptance bar (swapping `listTools` onto the shared lookup would change tool schemas from real to empty).
  - Owner: adapter-core (lookup util).
  - To fix: code — `extractDescriptor` unwraps `rec.capability` first, mirroring MCP's pattern. Updates the lookup's unit test to use the real `DescribeResult` shape. Resolve BEFORE A9's `GET /capabilities` ships (Q5 deferred describe route on this bug); resolve BEFORE A8 migration swaps `listTools` onto the shared lookup.
  - Related: A6, A8, A9-R1 research report §14.2; A9 (Q5 deferred `{name}` route explicitly cites this).

- **D-93** (Medium, 2026-08-07, reporter: example-app logging pass) — gateway-minted JWTs encode `iat`/`exp` in epoch MILLISECONDS, not seconds. RFC 7519 expects NumericDate = seconds; any standard JWT library validating `exp` reads ms as seconds → expiry lands in year ~58568 → token treated as effectively never-expiring (and `iat` in the far future trips `iat`-future checks in some libs).
  - Doc claim: JWT is a standard token (`example/README.md` "a real JWT minted by its own `gateway.issueToken` API"; `docs/architecture/Agentide.md` security sections imply standard JWT semantics).
  - Code reality: `packages/gateway-core/src/factory.ts:265` → `exp: clock.now() + (req.expiresInMs ?? DEFAULT_TOKEN_TTL_MS)` with `clock.now()` in ms; `oauth-token-handler.ts:89` comment "// epoch ms, matching TokenClaims elsewhere in gateway-core" — deliberate internal convention, non-standard externally. Verified live 2026-08-07: minted token `iat=1786081669885 exp=1786085269885` (Δ = 3 600 000 ms = 1h).
  - Why matters: gateway-internal validation is self-consistent, but any external consumer (SDK, dashboard, third-party auth middleware) validating with a standard JWT lib silently disables expiry. Security-adjacent; also confuses log parsers (example app logged exp as year +058568).
  - Owner: gateway-core (token mint).
  - To fix: emit seconds (`Math.floor(clock.now()/1000)`) in the signed claims AND keep the internal expiry check in the same unit; add a test pinning `exp-iat === 3600` (seconds). Check `types.ts:122` comment + all consumers (session-mint, oauth handlers) for ms assumptions.
  - Related: example app logs a D-93 note when ms-exp detected (`example/src/platform/platform.agent.ts`).

- **D-91** (Medium, 2026-08-07, reporter: post-release-validation 0.4.0 smoke test) — `agentide invoke` with a narrow-scope token cannot reach any business capability: the auto-mint path (D-79) requires `session.create`, which a business-only token lacks, so even an IN-SCOPE cap (`product.list` with scope `product.list product.get`) is denied `GATEWAY_INSUFFICIENT_SCOPE — caller lacks required scope for "session.create"`. Deny-by-default works (out-of-scope `order.create` also denied), but the help text implies `--session` is optional for any token.
  - Doc claim: `agentide --help` → `invoke <cap> [--args ...] [--session <id>] [--mode call|stream]` — optional flag, no session-scope caveat (`packages/agentide/src/cli.ts` help block; verified 0.4.0).
  - Code reality: `packages/agentide/src/consumer.ts` withAutoSession always mints when `--session` omitted; gateway enforces the token's scope on `session.create` (verified live 0.4.0 against example app).
  - Why matters: operators minting narrow business tokens (Goals §7 security-by-default) can't drive the CLI headline use case at all; they must either grant `session.create` (broadening the token) or mint `*`. No documented path exists.
  - Owner: agentide CLI pack (next).
  - To fix: (a) doc — add the session-scope caveat to `invoke` help; (b) code — consider auto-mint with the caller's existing session scope checked per-cap, or surface a targeted error `error: invoke auto-mint needs session.create scope (grant it or pass --session)`. Decide in next CLI pack.
  - Related: D-79, D-80.

- **D-92** (Low, 2026-08-07, reporter: post-release-validation 0.4.0 smoke test) — `agentide capability list --owner <id>` silently no-ops on remote entries: no capability entry exposes an `owner` field over the wire, so the filter matches nothing (or is ignored) and platform caps print regardless.
  - Doc claim: `agentide --help` → `capability {list|describe} [--owner <string>] [--tier ...]` (`packages/agentide/src/cli.ts` help block; verified 0.4.0).
  - Code reality: live `capability list --owner nestjs-ecommerce --json` returned all platform caps; `capabilities --json` output contains zero `"owner"` keys (verified 0.4.0 against example app).
  - Why matters: operators cannot filter business vs platform caps remotely; discovery UX gap (Vision capability-first).
  - Owner: agentide CLI pack (next).
  - To fix: expose `owner` (e.g. `app:<id>` / `platform`) in `capability.list` responses, then let `--owner` filter on the client. Or drop `--owner` from help until wired.

- **D-90** (Low, 2026-08-07, reporter: agentide 0.4.0 release session) — `ci-cd-agentide` + `release-agentide` skills claim release-please attributes commits to packages by conventional-commit scope ("a `fix(agentide):` commit touching `packages/dashboard-core/src/` will NOT bump `dashboard-core` — only `agentide`"). The repo's actual config (`.github/release-please-config.json`, `release-type: node`, no `node-workspace` plugin) attributes commits by **changed file paths**; the scope only formats the changelog line (`**agentide:**`). Observed 2026-08-07: `e880560 feat(agentide):` (touched `packages/gateway-core/src/factory.ts` mkdir) bumped gateway-core 0.7.0; `1a6bfca feat(agentide):` (touched `packages/adapter-websocket/`) bumped adapter-websocket 0.6.0; `85727ca fix(release):` (touched agentide/gateway-core/dashboard-core package.jsons) bumped agentide + gateway-core patches in the original PR #57.
  - Doc claim: `.agents/skills/ci-cd-agentide/SKILL.md` "Cut a release" step 2 + `.agents/skills/release-agentide/SKILL.md` step 3 "CRITICAL: release-please only counts commits whose scope matches a package path".
  - Code reality: `.github/release-please-config.json` (15 packages, flat string manifest); PR #57 bump set: agentide 0.4.0, gateway-core 0.7.0, adapter-websocket 0.6.0; gateway-core changelog lists the `**agentide:**` commit under Features.
  - Why matters: an agent following the skill misreads correct bumps as wrong (or distrusts the Release PR). Corollary: any feat commit that touches sibling package files inflates those packages to a MINOR — cross-package edits in a feat must be reviewed before merge.
  - Owner: cross-pack audit (skills).
  - To fix: doc — corrected both skills 2026-08-07 (attribution by changed paths; scope = changelog formatting only); added pre-dispatch repo-vs-npm drift check, keyring/sandbox auth note, and Release-PR update race note.
  - Verified by: PR #57 changelog sections; `git show e880560/1a6bfca/85727ca --stat`.

- **D-51** (Low, 2026-08-06, reporter: dashboard-core drift review 2026-08-06-121223) — Scenario 3 wording in PRD-TRD says "prepends the record" but the implementation (`packages/dashboard-core/src/assets/wire.js:101-106` → `invoke4(true)`) re-issues `session.list` / `plugin.list` / `capability.list` / `system.health` and replaces the snapshot arrays wholesale. User-visible result is identical (new row appears at the top because `session.list` is creation-ordered), but the implementation path is a full refetch, not an incremental prepend. Acceptable: refetch is the canonical live path for v1, simpler than per-event diffs, and the `dashboard.view.*` cap contract makes incremental updates unnecessary at the wrapper boundary.
  - Doc claim: PRD-TRD §Scenario 3 "prepends the record" (and AC-3.1 "row appears in Sessions within one second").
  - Code reality: `wire.js` `handleEvent` calls `invoke4(true)` for any `session.*`/`plugin.*`/`capability.*` topic; `invoke4` is a serial re-invoke that replaces `state.sessions` / `state.plugins` / `state.capabilities` / `state.health`.
  - Why matters: future agents looking for an incremental insert path will not find one; the PRD's wording implies a row-insert strategy that doesn't exist. The refetch model is correct — just stronger than the PRD text.
  - Owner: dashboard-core.
  - To fix: doc — update PRD-TRD §Scenario 3 wording from "prepends the record" to "the new record appears in the Sessions panel within one second (via snapshot refetch on the matching event topic)". No code change.
  - Related: PRD-TRD Scenario 3; wire.js:101-106; PR #48.

- **D-68** (Low, 2026-08-03, reporter: agentide start pack) — `packages/agentide/src/cli.ts` is 373 lines, over the AGENTS.md rule 9 cap of 350. Pre-existing: was ~410 before this pack; `runStart` extraction to `packages/agentide/src/start.ts` brought it down. Still 23 over because the file holds 6 subcommand handlers + HELP + arg parser + signal-setup helpers. To fix (next pack): extract `installGlobalErrorHandlers` (30 lines) + `runInit` (28 lines) to `error-handlers.ts` and `init.ts` — both small, mechanical moves. Doc note only, no behavior change.
- **D-69** (Medium, 2026-08-03, reporter: agentide npm-publish preparation) — agentide@0.0.1 ready to publish but the `pnpm publish` flow has friction: 11 separate publishes required (1 agentide + 1 agentide-cjs + 7 internal packages + 2 leaves); each prompts for a 2FA OTP. Order matters (deepest deps first): `errors`, `origin`, `capability-registry`, `session-manager`, `backend-runtime`, `plugin-manager`, `gateway-core`, `adapter-websocket`, `adapter-mcp`, `agentide`, `agentide-cjs`. Each package now has a `scripts/prepare-publish.sh` + `prepublishOnly` hook that flattens workspace refs to `^X.Y.Z` semver, since `npm publish` can't resolve `workspace:*`. To make this one-shot: a `scripts/publish-all.sh` script that iterates packages in dependency order, captures the OTP once (if npm supports it for the token auth path), and rolls back on first failure. Or: use `@npmcli/publish` programmatically with cached auth.

- **D-47** (Medium, 2026-08-03, reporter: dashboard-core D1 grilling) — No log-reading capability exists; the Logs view has no snapshot source.
  - Doc claim: backlog BI[13] names `logs` as a v1 dashboard view (`docs/features/dashboard-core/GRILL-dashboard-core.txt:10-11`); §14 lists Logs as a core Dashboard feature (`docs/architecture/Agentide.md:841`).
  - Code reality: no read cap — only `gateway.configuration` leaks the audit path (`packages/gateway-core/src/factory.ts:387-392`); no CLI `logs` command (`packages/agentide/src/cli.ts:96-109`); the only sources are the append-only JSON-lines `audit.log` (`packages/agentide/src/factory.ts:43`, `AuditWriter` audit.ts:28-45) and its live mirror `gateway.invocation` (`packages/gateway-core/src/handle-invocation.ts:351,376,405`).
  - Why matters: Logs view would need to read the file directly (breaks the thin-wrapper lock) or aggregate the event mirror live (no snapshot of history before page load).
  - Owner: gateway-core (+ CLI surface in agentide).
  - To fix: code — add a log-read seam (cap + `logs` CLI command) before the Logs view ships, or rule the view out of scope.
  - Related: D1 ticket (view-scope), D-46.

- **D-48** (Medium, 2026-08-03, reporter: dashboard-core D1 grilling) — No error-listing capability exists; the Errors view has no snapshot source.
  - Doc claim: §14 lists Errors as a core Dashboard feature (`docs/architecture/Agentide.md:842`); GRILL BI[13] read-tier list (`GRILL-dashboard-core.txt:14-16`).
  - Code reality: no error-listing cap; errors surface only as event payloads — `gateway.invocation` status `error`/`denied` (`handle-invocation.ts:362-377, 389-405`), `event.handler_failed`, `plugin.handler.error`, `plugin.handler.loaded{ok:false}`, `sdk.invoke.failed`; 18 `GATEWAY_*` codes defined (`packages/errors/src/index.ts:36-55`).
  - Why matters: Errors view could aggregate the live event mirror, but has no snapshot of errors that occurred before the page loaded — half the acceptance bar missing.
  - Owner: gateway-core.
  - To fix: code — add an error-listing seam (query over audit/event history) before the Errors view ships, or rule the view out of scope.
  - Related: D1 ticket (view-scope), D-47 (same data class).

- **D-49** (Medium, 2026-08-03, reporter: dashboard-core D1 grilling) — Browser Instances view has zero shipped backing: no cap, no events, no registry enumeration.
  - Doc claim: §14 lists Browser Instances as a core Dashboard feature (`docs/architecture/Agentide.md:836`).
  - Code reality: browser-runtime's 13 caps are all per-tab actions — `browser.query` is a DOM-selector query on ONE tab, not an instance listing (`packages/browser-runtime/src/handlers.ts:229-234`); sessions live in a private `Map` with no enumeration API (`packages/browser-runtime/src/index.ts:51-62`); browser-runtime publishes ZERO events (only subscribes to session.* lifecycle, `packages/browser-runtime/src/lifecycle.ts:39-54`); caps registered with `permissions: []` so any caller needs wildcard `["*"]` scope (`packages/plugin-manager/src/lifecycle-helpers.ts:80-100`).
  - Why matters: the view needs a new read cap + lifecycle events (or sdk.connection.* heuristics) — a real browser-runtime change, not a thin wrapper.
  - Owner: browser-runtime.
  - To fix: code — add instance enumeration cap + lifecycle events before the view ships, or rule the view out of scope.
  - Related: D1 ticket (view-scope); BI[12] browser-runtime (shipped).

- **D-59** (Accepted drift, 2026-08-03, reporter: cli-adapter sub-agent review) — Post-impl sim `docs/features/cli-adapter/simulate.sh` drives the real `platform` binary against `examples/mock_wire.rs`, not the websocket-adapter (`@platform/gateway-core` + `@platform/adapter-websocket`). PRD Simulation Contract says "a live gateway + websocket adapter"; the websocket adapter is BI[24] (blocked, not yet shipped).
  - Doc reality: PRD line 110 "against a live gateway + websocket adapter".
  - Code reality: only `examples/mock_wire.rs` implements the locked W4 wire today; the post-impl sim wires that script up as the binary's `ws://127.0.0.1:7300/ws` peer. Once BI[24] lands, `simulate.sh` switches to `--url ws://127.0.0.1:7100/ws` with the real gateway token and the same contract commands assert unchanged.
  - Why matters: divergence is intentional and PRD-quoted. The script is the contract assertion layer; switching the backend is a one-flag change with the same command matrix.
  - Resolution: `simulate.sh` header documents the backend and the BI[24] swap path; `sim-state.json` records `"backend": "mock_wire (locked W4 wire; real adapter lands with BI[24])"`. No sim rewrite on BI[24] merge — only the URL + token.
  - Verified by: `bash docs/features/cli-adapter/simulate.sh` — 11/11 scenarios PASS, exit 0 (capabilities table, sessions json, invoke pretty, invoke denied, bad token, missing token file, no-config non-tty, wss tls fail, status --watch, sessions --watch --json, config 0644 warn).

- **D-60** (Accepted drift, 2026-08-03, reporter: cli-adapter sub-agent review) — The post-impl sim's "wss tls fail" scenario is a TCP probe assertion, not a true TLS handshake against an untrusted cert. The binary runs `wss://127.0.0.1:7300/ws` against the plain-WS mock (port 7300 accepts only the plain upgrade path), so the rustls handshake never starts — the connection breaks on `unexpected end of file` mid-handshake and the binary surfaces `IO error: unexpected end of file` mapped to exit 3 via `classify_connect_error`'s TCP probe.
  - Doc reality: PRD line 120 says "wss:// with untrusted cert → exit 3"; the locked contract is "TLS-layer failure on `wss://` → exit 3" (PRD S5 / Scenario 8).
  - Code reality: the sim reaches the TLS-layer exit code via a degenerate handshake (the mock never speaks TLS), not a proper cert rejection. Real-world exit 3 paths fire when (a) rustls config errors (`Error::Tls`) or (b) the rustls handshake returns `Error::Io` while the raw TCP probe succeeds.
  - Why matters: divergence is intentional. The sim exercises the *exit-code mapping* path the PRD locks; a true untrusted-cert sim needs a TLS-speaking mock peer (out of scope for `examples/mock_wire.rs`, which is a plain W4 wire stub). Once BI[24] lands, the gateway serves HTTPS on 7443 with a self-signed cert and the same `wss://` URL exercises the real cert-rejection path.
  - Resolution: `simulate.sh` runs the TLS exit-code path; the test seam is `classify_connect_error` (`crates/cli-adapter/src/client.rs:99-114`), which the 13 client unit tests cover directly (mock-only; no real cert needed). When BI[24] ships, swap the URL and the assertion stays correct.
  - Verified by: `bash docs/features/cli-adapter/simulate.sh` exit code 3 for `wss tls fail`; `cargo test -p cli-adapter` 13/13 client tests green.

- **D-61** (Accepted drift, 2026-08-03, reporter: cli-adapter sub-agent review) — The post-impl sim's NDJSON output uses one `event` frame per line as the PRD S7 lock requires; the `publishedAt` value is a fixed `1700000000000_u64` from the mock and is NOT monotonically increasing per call (the mock emits two events with the same timestamp). PRD S7 only locks the frame shape, not the timestamp ordering.
  - Doc reality: PRD S7 — "prints `{type:"event",...}` frames as NDJSON (one per line) until Ctrl-C".
  - Code reality: mock's `subscribe` handler sends `ev-1` and `ev-2` with identical `publishedAt = 1700000000000`; real adapters will issue distinct timestamps. The sim's pass criterion is `grep -c '"type":"event"' >= 2`, not timestamp equality.
  - Why matters: divergence is intentional. The mock's timestamps are placeholder for test stability (deterministic NDJSON bytes per run); real adapters timestamp per `Date.now()` or RFC 3339.
  - Resolution: mock behavior documented at `crates/cli-adapter/examples/mock_wire.rs:83-98`; once BI[24] lands, real events arrive with monotonically increasing timestamps and the same `grep` assertion still passes.
  - Verified by: `bash docs/features/cli-adapter/simulate.sh` — both watch scenarios (`status --watch`, `sessions --watch --json`) report 2+ events each, exit 5 on SIGINT.

- **D-85** (Low, 2026-08-06, reporter: cli-consumer-ux drift review 2026-08-06) — PRD-TRD-cli-consumer-ux.md Scenario 5 step 6 says "Exits 0" but code exits 5 (Interrupted) on clean SIGINT. Wording bug in the new PRD; no operator impact. The code follows the parent GRILL (agentide-cli-consumer Q1/S7) lock that watch-on-SIGINT exits 5. Consumer.ts:371 calls `settle(resultOut(..., ExitCode.Interrupted))` where `ExitCode.Interrupted = 5`. Unit test consumer-ux.test.ts:216 asserts exit 5 and passes.
  - Doc reality: PRD-TRD Scenario 5 step 6: `Exits 0`.
  - Code reality: `ExitCode.Interrupted = 5` on SIGINT (matches parent lock).
  - Why matters: documentation drift only. New readers following the PRD will expect exit 0.
  - Resolution: accepted drift. One-line edit to PRD-TRD would close it (next doc pass). The behavior matches the parent pack; the new PRD's wording was an oversight.
  - Verified by: .reports/2026-08-06-drift-cli-consumer-ux.md GAP-C1.

- **D-86** (Low, 2026-08-06, reporter: cli-consumer-ux drift review 2026-08-06) — IMPL Phase 1 plan promised 4 unit tests including IPv6 host; the actual url-default.test.ts covers no-port / already-port / path+query / malformed — IPv6 case (e.g. `ws://[::1]/ws`) is not exercised. Both exercise the WHATWG parser in useful ways; IPv6 is a real edge case for dual-stack hosts.
  - Doc reality: IMPL Phase 1 line 16 lists "IPv6 host" as the 4th test case.
  - Code reality: url-default.test.ts has `ws://localhost/api?x=1` (path + query) as the 4th case.
  - Why matters: WHATWG URL parser handles IPv6 hosts correctly out-of-the-box (`new URL("ws://[::1]/ws")` parses), but no test pins that. A future refactor that swaps the parser for a regex could regress IPv6 silently.
  - Resolution: accepted drift. Append a 5th test case (`ws://[::1]:7300/ws` with port stays; `ws://[::1]/ws` defaults to 7300) in a future CLI-quality-of-life pack.
  - Verified by: .reports/2026-08-06-drift-cli-consumer-ux.md (Execution Gaps, Phase 1).

- **D-87** (Low, 2026-08-06, reporter: cli-consumer-ux drift review 2026-08-06) — IMPL Phase 5 plan said "non-clean exits (close before SIGINT) skip the destroy to avoid spamming errors"; the shipped code always tries and swallows the error into `warnings` (session-mint.ts:56-68). Operator-visible effect: an extra `warning: session.destroy failed (not connected)` line on stderr in the disconnect case. Functional leak behavior matches the plan (session leaks until idle timeout, same as "skip").
  - Doc reality: IMPL Phase 5 L68: "non-clean exits skip the destroy".
  - Code reality: `withAutoSession` finally always calls `session.destroy`; non-clean exits push the error into `warnings` and continue.
  - Why matters: cosmetic — one extra warning line on disconnect. No operator impact beyond noise.
  - Resolution: accepted drift. Could be tightened later by passing a `skipDestroy` flag from the watch's `client.onClose` handler, but the current behavior is correct and self-documenting.
  - Verified by: .reports/2026-08-06-drift-cli-consumer-ux.md (Execution Gaps, Phase 5).

- **D-88** (Low, 2026-08-06, reporter: cli-consumer-ux drift review 2026-08-06) — `simulate.sh` does not exercise PRD Scenarios 2 (`--session` batch workflow) or 6 (no-URL pre-flight). Both are covered by unit tests (`consumer-ux.test.ts:168-187` for batch; `consumer.test.ts` for no-URL).
  - Doc reality: PRD-TRD Scenarios 2 and 6.
  - Code reality: covered in unit tests; not in `simulate.sh`.
  - Why matters: minor sim coverage gap. The batch-workflow path is the one case where the operator owns the session lifecycle, and a future regression there would be a high-impact bug that no end-to-end sim would catch.
  - Resolution: accepted drift. Append a sim section for Scenario 2 in the next CLI-quality-of-life pack (alongside D-78/D-81/D-83/D-84). Scenario 6 is pre-existing behavior not touched by this pack and can be left to the same pack.
  - Verified by: .reports/2026-08-06-drift-cli-consumer-ux.md (Simulation Gaps).

- **D-89** (Low, 2026-08-06, reporter: cli-consumer-ux drift review 2026-08-06) — `consumer.ts` is now 407 lines, over AGENTS.md rule 9 cap of 350. Pack added ~30 lines (auto-mint branch, wrong-door catch, two imports). Drift D-68 already tracks `cli.ts` (634 lines) — `consumer.ts` joins it. Future pack should extract `runWatch`/`runWatchInner` to `watch.ts` (~120 lines).
  - Doc reality: AGENTS.md rule 9: code files under 350 lines.
  - Code reality: `packages/agentide/src/consumer.ts` = 407 lines.
  - Why matters: the file is still readable but is approaching the threshold. A future refactor should split it before more lines accumulate.
  - Resolution: accepted drift. Defer to a future "consumer.ts split" pack.
  - Verified by: .reports/2026-08-06-drift-cli-consumer-ux.md (Execution Gaps, code-architecture observation).

---

## Resolved

- **D-94** (Low, 2026-08-07, reporter: adapter-core wayfinder charting) — CONTEXT.md glossary claimed "All v1 client doors ride the websocket-adapter wire (W1–W6) … 'the only door'" — but `adapter-mcp` calls `gateway.handleInvocation` directly in-process, not via the WS wire.
  - Doc claim: `docs/CONTEXT.md` line 30 (Adapter row, pre-fix).
  - Code reality: `adapter-mcp/src/translate.ts:213` + `adapter-websocket/src/invoke.ts:37` — both call the canonical invocation in-process.
  - To fix: doc — reword the Adapter row: common door = the canonical Capability Invocation; wire clients (dashboard, CLI consumer) ride the W1–W6 envelope.
  - Verified: reworded 2026-08-07 (CONTEXT.md Adapter row — in-process Adapters call the Gateway directly; the Invocation model is the common door); adapter-core shipped (0.2.1) makes this the operative reality. Commit: docs(CONTEXT): adapter row — common door is the Invocation model (D-94 resolved).

- **D-75** (Resolved 2026-08-05, drop-cjs-siblings pack) — `packages/sdk-browser-cjs` had a broken build chain: its mirrored source imported `@spanexx/backend-runtime`, which had no CJS sibling. Closed by deleting the package entirely — the drop-cjs-siblings pack removed all four `*-cjs` trees (`sdk-node-cjs`, `event-bus-cjs`, `sdk-browser-cjs`, `agentide-cjs`) in favor of a single ESM surface with a `require` condition (Node >= 22.12 `require(esm)`). The build chain no longer exists to be broken.
  - Verified by: `no-cjs-residue.test.ts` CID:drop-cjs-residue-001 (no `-cjs` workspace trees exist); commit `feat(release): drop CJS siblings entirely (Phase 2/5)`.

- **D-76** (Resolved 2026-08-05, drop-cjs-siblings pack) — `packages/agentide-cjs` had a broken build chain: timed source imported 6 ESM-only packages with no CJS siblings. Same resolution as D-75 — package deleted; no CJS CLI sibling exists anymore. Node >= 22.12 can `require(esm)` the ESM `@spanexx/agentide` directly, so the separate CJS CLI is unnecessary.
  - Verified by: `no-cjs-residue.test.ts` CID:drop-cjs-residue-001; commit `feat(release): drop CJS siblings entirely (Phase 2/5)`.

- **D-77** (Resolved 2026-08-05, drop-cjs-siblings pack) — `packages/agentide/scripts/mirror-cjs-versions.mjs` (the CJS mirror version script) was deleted with the CJS siblings. The mirror step was removed from `.github/workflows/release.yml`; there are no CJS versions to mirror anymore.
  - Verified by: `no-cjs-residue.test.ts` CID:drop-cjs-residue-002 (mirror-cjs-versions.mjs is gone) + CID:drop-cjs-residue-003 (release.yml has no `-cjs` filters); commit `feat(release): drop CJS siblings entirely (Phase 2/5)`.

- **D-70** (Resolved 2026-08-05, reporter: agentide-client-credentials Phase 8 review) — Client-action audit coverage was partial. Both halves fixed in this commit.
  - (a) CLI-path audit: `packages/agentide/src/cli.ts` `runClient` now opens an `AuditWriter` to the same `<dataDir>/audit.log` the gateway writes, and emits a row per state-changing subcommand: `client.create` / `client.grant` / `client.revoke` / `client.rotate` / `client.redeem` (denied on null). Row shape matches `AuditRecord` (`schemaVersion: 1, ts, tenantId, caller, capability:{name,version:"1"}, owner:"operator-cli", status:"ok"|"denied", durationMs:0`). `client list` stays read-only per PRD "every state-changing client action" wording.
  - (b) token_mint audit: `packages/gateway-core/src/factory.ts` `oauthTokenHandler` closure now passes `auditEmit: (row) => { void audit.append({...}); }` into `handleTokenRequest`. Row uses capability `oauth.token.exchange`, owner `gateway-core`. The 401-paths inside `handleClientCredentialsGrant` still skip the row (they didn't mint) — verified by reading the closure.
  - Verified by: `packages/agentide/scripts/simulate-client-credentials.mjs` C1 + C2 + C7 scenarios — `audit.log` now contains ≥1 `oauth.token.exchange` row after the C1 happy path; revocations emit `client.revoke`; failures emit `denied`. Pre-fix, C7 would have failed with `expected >=1 oauth.token.exchange row, g
- **D-78** (Resolved 2026-08-06, cli-quality-of-life pack, commit e880560) — agentide init on a fresh data dir no longer fails with raw ENOENT. The CLI is now self-sufficient.
  - Doc claim: agentide init should bootstrap the directory.
  - Code reality: packages/agentide/src/cli.ts runInit calls opts.fs.mkdir(dataDir, recursive: true) before createPlatform. The FileSystem interface in gateway-core/src/types.ts now has an OPTIONAL mkdir method; both nodeFileSystem and the bundled CLIs defaultFs implement it. In-memory fakes skip it. Idempotent on existing dirs.
  - Why matters: first-run UX is fixed. Operators can run init on a fresh path without mkdir -p first.
  - Verified by: cli-init.test.ts 3/3 (fresh, idempotent, nested-recursive). simulate.sh Scenario 1 + 1b: init exit 0 + dir + gateway-secret on disk.


- **D-81** (Resolved 2026-08-06, cli-quality-of-life pack, commit e880560) — agentide status from any cwd now recovers the gateways data-dir.
  - Doc claim: agentide status [--data-dir <path>] implies a usable default.
  - Code reality: lifecycle.ts writePidFile now writes JSON {pid,dataDir,startedAt}. readPidFile returns null | PidFileInfo | {pid} (legacy plain-number fallback). start.ts runDetachedStart passes dataDir + ISO timestamp. cli.ts runStatus reads the pid file and overrides the cwd-relative default with info.dataDir.
  - Why matters: status works from any cwd. The pid file is the canonical artifact.
  - Verified by: lifecycle-pidfile.test.ts 5/5 (write+read JSON, legacy, malformed, missing, idempotent remove). simulate.sh Scenario 2: cd / && agentide status returns the right counts.


- **D-83** (Resolved 2026-08-06, cli-quality-of-life pack, commit e880560) — agentide stop unifies on rc 0 in both "nothing running" branches.
  - Doc reality: start.ts runStop (CID:start-009) had inconsistent exit codes — pid file missing → rc 1; pid present + pid dead → rc 0.
  - Code reality: start.ts:259 now returns rc 0 in the missing-pid-file branch. The pid-present-but-dead branch already returned rc 0 via result(msgs outcome) (default exitCode 0).
  - Why matters: shell scripts get idempotent stop. agentide stop && next always proceeds.
  - Verified by: cli-stop.test.ts 2/2 (both branches exit 0). simulate.sh Scenario 3: stop idempotent in shell chains.


- **D-84** (Resolved 2026-08-06, cli-quality-of-life pack, commit e880560) — per-subcommand help for agentide client.
  - Doc reality: agentide client --help dumped six subcommands in one row without flag details; client grant legitimately needs --tenant/--name (not --client-id/--scope like the rest).
  - Code reality: new clientHelp(sub?) function in cli.ts emits either the six-row summary or the per-subcommand flag block. runClient short-circuits on no-subcommand or --help. The top-level runCli --help gate no longer fires when a subcommand is present.
  - Why matters: first-time guess work for the grant subcommand is gone.
  - Verified by: cli-client-help.test.ts 4/4 (no subcommand, grant --help, create --help, redeem --help). simulate.sh Scenario 4: all five assertions pass.

ot 0`.

- **D-71** (Resolved 2026-08-05, reporter: agentide-client-credentials Phase 6-7 review) — IMPL prose for the SDK OAuth shape drifted from shipped code in two places; both resolved by documenting code reality.

- **D-71** (Resolved 2026-08-05, reporter: agentide-client-credentials Phase 6-7 review) — IMPL prose for the SDK OAuth shape drifted from shipped code in two places; both resolved by documenting code reality.
  - Doc claim: IMPL-agentide-client-credentials.md Phase 6 describes a flat async `createSdk({url, oauthUrl, clientId, clientSecret, ...})` with a test file `client.test.ts`; Phase 7 prose says `handleCallback` "creates a registration code" (reg-code flow).
  - Code reality: shipped `createSdk(config)` is the nested sync `SdkConfig {gateway:{url,token}, app, manifest, handlers}` factory from Phase 1-5 with `clientId`/`clientSecret`/`oauthUrl` added as flat optional fields (`packages/sdk-node/src/types.ts` SdkConfig, CID:sdk-002); tests live in `refresher.test.ts` (name collision with the Phase 3 `client.test.ts` WsClient suite — resolved by renaming, header documents it); `handleCallback` mints a JWT directly (`packages/gateway-core/src/oauth-token-handler.ts`, CID:oidc-002) — reg-code redeem is a separate `grant_type=registration_code` path.
  - Verified by: 989/989 vitest tests, build/lint/typecheck/check-banned-types clean after Phases 6-7 commits `9a9b739` + `4334c84`; code matches PRD-TRD S2/S3/S6 scenario locks (client_credentials POST body, refresh-before-expiry, one-shot code redeem). IMPL remains a build plan, superseded where it disagrees with shipped code; refresher.test.ts header + this entry are the citation trail.


- **D-74** (Resolved 2026-08-05, reporter: agentide-client-credentials drift review) — Post-impl sim listed C4 (`--no-tls`) in its header but never exercised it: `main()` ran C1 → C2 → C3 → C5 → C6 → C7, so the D-73 TLS fix had no end-to-end regression coverage.
  - Fix: added the C4 scenario to `packages/agentide/scripts/simulate-client-credentials.mjs` — (a) plain-HTTP (`X-Forwarded-Proto: http`) `/oauth/token` against the default `requireTls: true` platform asserts **426 `tls_required`**; (b) a second platform booted with `createPlatform({ requireTls: false, adapterMcpPort: 0 })` (exactly what `start.ts` produces from `--no-tls`) asserts the same plain-HTTP request returns **200** with `access_token`. C4 reuses C1's client to stay within the `clientService` create rate limit (5/hour, `client-service.ts:199-213`).
  - Verified by: sim run — 7/7 PASS, incl. `C4 --no-tls: 426 over plain HTTP, 200 when requireTls=false — plain-http 426 → requireTls=false plain-http 200 (port …)`.


- **D-65** (Low, 2026-08-03, reporter: agentide-cli-consumer drift review) — PRD-TRD-agentide-cli-consumer.md Scenario 4 wire frame lock (`input?` optional) was ambiguous about whether the CLI should omit the field entirely or send `input: {}`. The CLI omits when empty (DRIFT: client.ts); the gateway treats omission and explicit-empty equivalently. Resolved by adding an explicit sentence to Scenario 4: "*`input?` and `sessionId?` are optional — the CLI omits a field from the wire entirely when not supplied (rather than sending `null` or `{}`); the gateway treats both 'field omitted' and 'field: undefined' as the same value (defaults applied at dispatch).*" Doc-only fix in `docs/features/agentide-cli-consumer/PRD-TRD-agentide-cli-consumer.md` Scenario 4. No code change.
- **D-66** (Low, 2026-08-03, reporter: agentide-cli-consumer drift review) — Invoke frames from `createWsClient` omitted the `mode` field, while PRD S4 Scenario 4 locks `mode:"call"|"stream"` in the wire frame. Server normalized the missing field to `call`, so v1 behavior was unchanged, but the wire contract drifted from the spec. Fix: `packages/adapter-websocket/src/client.ts` now emits `mode: "call"` explicitly on every invoke frame. Confirmed by 168/168 passing tests on `@platform/agentide` + `@platform/adapter-websocket` after the fix.
- **D-67** (Low, 2026-08-03, reporter: agentide-cli-consumer drift review) — Unknown top-level command exited 1 (`cli.ts:153` and the catch-all `cli.ts:157`) instead of the S5 lock's "usage → 2". Fix: changed both to `exitCode: 2` to match S5. Live-verified: `agentide nonsense-command` now exits 2 with the help text on stderr.

- **D-63** (Low, 2026-08-03, reporter: npm-publish session) — `@platform/*` → `@spanexx/*` sweep rename across all 14 remaining workspace packages.

- **D-63** (Low, 2026-08-03, reporter: npm-publish session) — `@platform/*` → `@spanexx/*` sweep rename across all 14 remaining workspace packages. Triggered by `pnpm run gateway` failing because 13 internal packages still declared `@platform/*` workspace refs that pnpm couldn't resolve after the original 3 packages were renamed. Resolution: rename `name` field in 13 `package.json` files (the 14th was `@platform/__tests__` which stays as-is — it's an internal cross-test pkg, not publishable), rewrite 40 workspace `dependency`/`devDependency` refs across all packages, rewrite 121 source-file imports (78 in `.ts` plus 43 in dynamic-import/dts/mts patterns). Build + install clean after sweep. Same `pnpm run gateway` now succeeds without bypassing pnpm. Renamed in-repo only — no new npm publishes (the 14 renamed packages stay workspace-internal until they're individually ready for distribution). Future: when any of these packages goes to npm, they'll publish under `@spanexx/<name>` to match the existing three (event-bus, sdk-node, sdk-browser) and their CJS siblings (event-bus-cjs, sdk-node-cjs, sdk-browser-cjs).

- **D-62** (Resolved 2026-08-03, reporter: cli-adapter e2e handoff recon) — Commit `421a56d` claims "gateway-core has no WS server in this repo" (commit body, "Honest disclosure" paragraph). This is incorrect. `@platform/adapter-websocket` (at `agentide/packages/adapter-websocket/`) IS the canonical W4 WebSocket server — `createWebSocketAdapter(gateway, eventBus, config)` is the public factory, defaults port 7300, and is wired into `createPlatform()` in `packages/agentide/src/factory.ts`. `mock_wire.rs` was a Phase-5 stopgap written before the adapter landed; the v1.x cli-adapter PRD already mandates the binary ride "websocket-adapter W1–W6 on port 7300" — adapter-websocket is that service.
  - Doc claim: `git log -1 --format=%B 421a56d` last paragraph — "mock_wire is not a true gateway; gateway-core has no WS server in this repo (PR #20 disclosure). These tests prove cli-adapter drives the W4 wire end-to-end; true gateway integration needs a WS server wrapper for the gateway dispatch service."
  - Code reality: `pnpm vitest run packages/adapter-websocket` 42/42 PASS; `packages/agentide/src/factory.ts:1-80` confirms `createPlatform()` auto-creates `createWebSocketAdapter` on port 7300 by default; `crates/cli-adapter/Cargo.toml` already declares no WS server dep because the binary is a client, not a server. The "PR #20 disclosure" referenced was true at the time of that PR (adapter-websocket not yet shipped) and was correct then, but the cli-adapter commit is dated 2026-08-03 — adapter-websocket shipped 2026-08-03 per commit log (`websocket-adapter — SHIPPED (BI[24])`).
  - Why matters: the commit message paints the test layer as a "best we can do" stopgap when the real production path was already available on the same day. Future readers of the commit will deprioritize the e2e layer (or try to build a "WS server wrapper for the gateway dispatch service" — which already exists, named `createWebSocketAdapter`). The right action is to swap `mock_wire` for the real adapter in the e2e layer, not to add a new wrapper.
  - Resolution: replaced `crates/cli-adapter/examples/mock_wire.rs` + `crates/cli-adapter/tests/e2e.rs` (the simulated peer + its 9 e2e tests) with a vitest cross-language test at `packages/__tests__/cli-adapter-integration.test.ts` (8 scenarios, 200 lines) that spawns the real `target/debug/platform` binary against a real `createWebSocketAdapter` (port 0 → free port, token minted via `issueToken`). `vitest.config.ts` include pattern extended to pick up the new `packages/__tests__/`. IMPL Phase 4/5/6/7 updated to drop the `mock_wire` paragraph, point cross-language smoke at the new file, mark Phase 7 SHIPPED, and note D-62 closeout. **D-59/D-60/D-61 are NOT resolved by this commit** — they describe the `docs/features/cli-adapter/simulate.sh` post-impl sim, which still drives the `mock_wire` example. Companion work (separate commit): update `simulate.sh` to boot `createWebSocketAdapter` + `createPlatform` and call the binary against `ws://127.0.0.1:0/ws` with a freshly minted token — that swap resolves D-59/D-60/D-61 together.
  - Verified by: `pnpm vitest run packages/__tests__/cli-adapter-integration.test.ts` 8/8 PASS; `cargo test` 51/51 PASS (was 60/60 — 9 e2e tests removed, replaced by 8 vitest scenarios); full `pnpm vitest run` 714/714 PASS; `pnpm typecheck`/`lint`/`build`/`precommit-rust.sh`/`check-banned-types.sh` all clean.

- **D-44** (Resolved 2026-08-03, websocket-adapter W1 sub-Q 1 re-open) — v1 WS adapter was locked as push-only (`future.md` recorded pull as a future demand). Re-opened this session with a concrete reason: `dashboard-core` BI[13] is a v1 consumer that needs `capability.list` / `plugin.list` / `session.list` / `system.health` / `gateway.metrics` over a single socket. Pull is now v1; WS adapter adds a `invoke*` message family to the existing `{type: ...}` envelope (W1 sub-Q 4 unchanged — JSON-RPC mirror rejected). Universal, not scoped (user wording "no i dont want scopped"). Cross-ticket ripple: W4 (wire schema) adds 5 `invoke*` variants + correlationId; W6 (backpressure) covers per-connection outbound queueing for both `event` and `invoke.partial`; W5 (fan-out) routes per-call partial-progress topics. Downstream docs updated: `docs/wayfinder/websocket-adapter/future.md` (rewritten — pull is no longer future, only kernel-level streaming seam + `invoke.batch` + subprotocol versioning + MCP-shape compat remain), `docs/wayfinder/websocket-adapter/map.md` (decision log: W1 sub-Q 1 REOPEN entry + W1 closed revision), `docs/CONTEXT.md` (Decision Log: W1 sub-Q 1 REOPEN + W1 closed revision). `dashboard-core/GRILL-dashboard-core.txt` Q2 (data-plane exit) now has a defined answer candidate: expose aggregated views via WS adapter's `invoke` messages. `Feature_Backlog.md` BI[13] is unaffected (the row's "polls platform-capabilities" stays accurate; the WS adapter becomes the transport between the dashboard data plane and the platform's read-tier caps, not a separate read tier).
  - Verified by: code re-read of `packages/event-bus/src/index.ts:242-246` (queueing already covered for `event`; `invoke.partial` rides the same outbound queue); review of all four updated docs files; sub-ticket propagation (W2 sub-Q 1 in-progress, WS adapter envelope handling pulls the new shape).

- **D-53** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — `invoke.result` key mismatch: the CLI read `v["result"]`; the locked W4 wire and shipped adapter emit `output`.
  - Doc claim: wire schema `invoke.result{correlationId, output}` (`docs/wayfinder/websocket-adapter/tickets/wire-message-schema.md:123`).
  - Code reality: client parsed `v["result"]` (never present) — every invoke would render `{}`; shipped adapter confirms `output: response.output` (`agentide/packages/adapter-websocket/src/invoke.ts:64`).
  - Why matters: all invokes broken against a real gateway — the CLI never worked against the adapter.
  - Owner: cli-adapter.
  - To fix: code — read `v["output"]` (done; also fixed the mock and the integration test).
  - Verified by: `scenario_auth_ok_result` green; e2e `invoke demo.echo` returns the payload (`tests/client.rs`, `examples/mock_wire.rs`).

- **D-54** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — close 1008 during auth mapped to exit 2; PRD S5 locks exit 4.
  - Doc claim: "4 = `auth.error` before `auth.ok` (close 1008…)" (PRD S5; GRILL Q4).
  - Code reality: `auth()` mapped any Close frame to `ClientError::Closed` → exit 2.
  - Why matters: exit-code contract violated exactly on the reject path; scripts keying on 4 would misread.
  - Owner: cli-adapter.
  - To fix: code — map close 1008 in `auth()` to `ClientError::Auth` (done).
  - Verified by: `scenario_close_during_auth` asserts `ExitCode::Auth` + `ClientError::Auth{code:"policy"}`.

- **D-55** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — wss:// connect refused/DNS mapped to exit 3; PRD S5 locks 3 = TLS-layer only.
  - Doc claim: "3 = TLS/upgrade (ONLY wss:// TLS handshake failures)"; refused/DNS/HTTP-upgrade → 2 (PRD S5).
  - Code reality: `connect()` mapped ANY error on wss:// to `ClientError::Tls`.
  - Why matters: unreachable host misreported as TLS failure — wrong layer, wrong fix path for users.
  - Owner: cli-adapter.
  - To fix: code — tungstenite 0.30 + rustls handshake lazily (TLS failures surface as `Error::Io`), so classify by TCP reachability probe (`classify_connect_error`, CID:client-005). Done.
  - Verified by: `scenario_wss_tls_failure` (exit 3) + `scenario_wss_connect_refused_is_preflight` (exit 2) both green; e2e refused → exit 2.

- **D-56** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — `--url`, `--token`, `--help` flags missing; flags could not precede the subcommand.
  - Doc claim: binary surface lists `--url <ws://host/ws>`, `--token <jwt|path:/...>`, `--help` (PRD S1/S6 API Contracts); Simulation Contract runs `platform --token token.bad sessions`.
  - Code reality: `CliOverrides{gateway_url: None, token: None}` hardcoded; only 6 flags parsed; first arg assumed subcommand.
  - Why matters: two of the ten documented flags dead; the PRD's own demo commands exited 2 with usage.
  - Owner: cli-adapter.
  - To fix: code — parse `--url`/`--token` into `CliOverrides`, `--help` → stdout + exit 0, subcommand found in flag-parse remainder (done).
  - Verified by: unit tests (`parse_flags_any_order_with_values`, `print_usage_lists_full_flag_surface`); e2e `platform --token tok --url ws://… status` → exit 0; `--help` → exit 0.

- **D-57** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — `invoke <cap>` rendered tables/kv by capability name; PRD S3 locks pretty JSON for invoke.
  - Doc claim: "`invoke <cap>` → pretty JSON; aliases → tables/kv" (PRD S3).
  - Code reality: `view_for(capability)` mapped `gateway.status`/`system.health` to kv even via `platform invoke`.
  - Why matters: `platform invoke gateway.status` and `platform status` would render identically — the entry-path contract (the CLI's core differentiator) was dead.
  - Owner: cli-adapter.
  - To fix: code — view chosen by entry path (`Entry::Alias` vs `Entry::Invoke`), done.
  - Verified by: `view_for_uses_entry_path_not_capability_name` green; e2e `invoke gateway.status` → pretty JSON vs `status` → kv.

- **D-58** (Resolved 2026-08-03, reporter: cli-adapter fresh-eyes audit) — sessions table column `created` vs real session-manager payload key `createdAt`.
  - Doc claim: sessions table column `created` (PRD S3).
  - Code reality: shipped session-manager emits `createdAt` (epoch ms); the table rendered "-" for every row.
  - Why matters: column silently empty against a real gateway.
  - Owner: cli-adapter (contract note).
  - To fix: code — renderer falls back `createdAt` → `created` (`normalize_session_row`); PRD column name kept (snake_case display contract), payload vocabulary unchanged.
  - Verified by: `sessions_table_falls_back_to_created_at` green; e2e sessions table shows epoch values.

- **D-40** (Resolved 2026-08-02, sdk-browser follow-up fix) — sdk-browser's `sdk.capability.register` wire frame is name-only and fails registry validation, so the SDK's gateway-side registration can never succeed; server closes the connection ("register-failed"). Fixed by mirroring the sdk-node frame: `sendRegister` now sends `{ type, name, description, version, permissions, tier }` — description = cap name (the DOM has no description model), version/tier from the CapRegistry view (defaults "1.0.0"/"act"), permissions "" (server splits to []) (`packages/sdk-browser/src/index.ts` sendRegister). Gateway validation (`packages/capability-registry/src/validate.ts`) now accepts the frame; the register-failed close path is no longer reachable from sdk-browser.
  - Verified by: `vitest run packages/sdk-browser` (register-frame assertions updated to the full shape) + end-to-end backend-runtime register tests + full monorepo run (635/635).
- **D-43** (Resolved 2026-08-02, sdk-browser + backend-runtime follow-up fix) — backend-runtime replaces the first connection on duplicate appId: two tabs of the same app evict each other at the gateway. Fixed by keying connections by tabId (drift D-43): sdk-browser sends an optional `tabId` in the `sdk.auth` frame (`SdkOptions.tabId`, auto-generated per JS context otherwise) (`packages/sdk-browser/src/client.ts` onopen, `packages/sdk-browser/src/index.ts` autoTabSeq); the registry keys connections `appId:tabId` when tabId is present, `appId` otherwise (`packages/backend-runtime/src/registry.ts` accept); server extracts `msg["tabId"]` in the auth path, uses the connection key for `capsByConnection`, per-key owners (`backend-sdk-<key>`), `rejectAllPending`, and close/stop cleanup (`packages/backend-runtime/src/server.ts`); dispatch parses the owner suffix as the connection key (`packages/backend-runtime/src/dispatch.ts`). Same appId + different tabId now coexists (2 connections, no eviction); same key still replaces (reconnect semantics preserved). Events carry `tabId` (null for sdk-node).
  - Verified by: registry/server/dispatch tests updated and passing (two-tabs-coexist test, same-key-replaces test, tabId in closed payloads) + full monorepo run (635/635).
- **DR-BR-11** (Resolved 2026-08-02, browser-runtime drift review) — `packages/browser-runtime/src/driver.ts` was 464 lines, over the AGENTS.md §9 / project_memory 350-line rule. IMPL §Risk Notes had flagged the risk but the file grew anyway. Split: `address.ts` (`resolveLocator` + in-page `computeAddressesForSelector`, F8), `tier.ts` (verb tables + `tierFromName`), `cdp.ts` (`cdpKillBrowser` Q4 test/ops seam). driver.ts now 345 lines, under the cap. Behavior preserved: 31/31 tests pass (`vitest run packages/browser-runtime`); manifest test now imports `tierFromName` from `../tier.js`.
  - Verified by: `wc -l packages/browser-runtime/src/*.ts` + full vitest rerun + manual re-read of `query`, `click`, `type`, `scroll`, `readCaps`, `kill` in driver.ts.
- **DR-BR-10** (Resolved 2026-08-02, browser-runtime drift review) — PRD-TRD Scenario 4 example still showed the pid-anchored ancestor+selector form (`[data-pid="202"] .add-cart`) but the shipped code + tests emit the self-anchored form (`button[data-pid="202"]`) when the matched element itself carries a data-* attr (BR-2 sim-side fix; doc-side never caught up). Updated Scenario 4 + the Scenario 4 sim block to spell out all three address forms (self, ancestor+selector, nth-of-type) so the doc matches the test contract (`runtime.test.ts:358-360`).
  - Verified by: doc edit at `docs/features/browser-runtime/PRD-TRD-browser-runtime.md:60-64` + `131`.
- **D-41** (Resolved 2026-08-02, browser-runtime drift review) — Handler error code + retryable now ride the envelope: plugin-manager preserves `originalErrorCode` + `retryable` in PLUGIN_HANDLER_ERROR details (`packages/plugin-manager/src/index.ts:229-243`), gateway-core passes them into GATEWAY_HANDLER_ERROR details (`packages/gateway-core/src/dispatch.ts:194-207`). Verified by tests `dispatch.test.ts:122-152` + `handler-loading.test.ts:154-187`; commit `5ee1cab`. Doc claim in capability-contracts corrected this session.
  - Verified by: drift review sub-agent (`.reports/2026-08-02-1536-drift-browser-runtime.md`) + code re-read.
- **D-42** (Resolved 2026-08-02, browser-runtime drift review) — Docs corrected (GRILL, map.md, CONTEXT.md) to the real event names; lifecycle.ts subscribes `session.created` (no-op), `session.suspended`/`session.resumed` (no-ops), `session.destroyed` (close), `session.cleanup_resources` (purge). Test suite covers the wiring (31/31).
  - Verified by: drift review sub-agent + code re-read this session.
- **BR-1** (Resolved 2026-08-02, browser-runtime post-impl drift review) — `driver.close()` closed the context but never the browser → chromium process leaked per session (PRD S8 "process exits" unimplemented). Fixed: `close()` now calls `refs_.browser.close()` (try/catch) after context.close(); relaunch-after-close test still green (31/31).
  - Verified by: code edit + full test rerun.
- **BR-2** (Resolved 2026-08-02, browser-runtime post-impl drift review) — F8 data-less elements emitted the plain duplicate selector (not reusable; capability-contracts.md promised nth-of-type). Fixed: `query()` fallback now emits `tag:nth-of-type(n)` computed among same-tag siblings.
  - Verified by: code edit + full test rerun.
- **BR-4** (Resolved 2026-08-02, browser-runtime post-impl drift review) — sim S6 screenshot scenario ran inline mode on the big news page (would error). Fixed: S6 navigates to shop.example before the inline screenshot, news.example before resource mode.
  - Verified by: sim verify script PASS after fix.
- **BR-5** (Resolved 2026-08-02, browser-runtime post-impl drift review) — sim S7 crash step checked for a thrown error, but `crashSimulate` returns `{ crashed: true, code: 'BROWSER_CRASHED' }`. Fixed: scenario now expects the returned object.
  - Verified by: sim verify script PASS after fix.
- **BR-6** (Resolved 2026-08-02, browser-runtime post-impl drift review) — sim `typeText` never threw AMBIGUOUS on multi-match, unlike real `resolveLocator` (driver.ts). Fixed: typeText throws `BROWSER_SELECTOR_AMBIGUOUS` when >1 match without instance; S8 now types `instance 1`.
  - Verified by: sim verify script PASS after fix.
- **BR-7** (Resolved 2026-08-02, browser-runtime post-impl drift review) — IMPL Phase 4 verify bullet promised "never-appearing caps → capsSettled:false", contradicting empty-page-settles-true (snapshot.ts:57-60). Fixed: bullet now says continuously-mutating page → capsSettled:false after timeout; empty page settles immediately true.
  - Verified by: doc edit.
- **BR-8** (Resolved 2026-08-02, browser-runtime post-impl drift review) — lifecycle comment listed `session.created` but no subscription existed. Fixed: explicit no-op subscription added (session is lazy per T5).
  - Verified by: code edit + full test rerun.
- **BR-9** (Resolved 2026-08-02, browser-runtime post-impl drift review) — IMPL/PRD dep lists promised `@platform/*` workspace deps; shipped package.json carries none (self-contained: playwright-core + @playwright/browser-chromium only). Fixed: IMPL Dependency Analysis now records shipped reality as authoritative.
  - Verified by: doc edit.
- **BR-3** (Accepted drift, 2026-08-02, browser-runtime post-impl drift review) — post-impl sim `simulate.html` is a hand-mirror HTML stub of the shipped semantics, not the real package driver. Accepted direction per pre-impl contract (matches D-38 sdk-browser precedent where the pre-impl sim is archived and the post-impl sim is standalone); browser-runtime's real driver is a Node package that can't be driven from a browser page.
  - Resolution: documented; pre-impl sim archived to `docs/features/browser-runtime/archive/simulate-pre.html`.
  - Verified by: drift review sub-agent + sim verify script.
- **D-37** (Accepted drift, 2026-08-02, sdk-browser drift review) — GRILL T3 Q3 locks a best-effort wire send `{ type: "sdk.disconnect", reason: "pagehide" }` BEFORE `close(1000, "pagehide")`. The implementation sends the close frame only; no wire message.
  - Doc claim: "Try to send `{ type: "sdk.disconnect", reason: "pagehide" }` via `WebSocket.send(...)`" (`docs/features/sdk-browser/GRILL-sdk-browser.txt:344-346`)
  - Code reality: `onPageHide` → `client.disconnect("pagehide")` → `ws.close(1000, reason)` only (`packages/sdk-browser/src/lifecycle.ts:38-44`, `client.ts:113-121`)
  - Why matters: without a wire message the gateway can't unregister the cap until TCP timeout; but nothing server-side consumes `sdk.disconnect` (backend-runtime has no handler; sdk-node sends none), and PRD-TRD Scenario 9 wording matches the code — the close frame is the effective signal.
  - Resolution: GRILL T3 Q3 amended 2026-08-02 with an additive note (verbatim answer preserved) citing this drift ID.
  - Verified by: drift review sub-agent (`.reports/20260802-0659-drift-sdk-browser.md`), re-read of `lifecycle.ts:38-44`, post-impl sim scenario 7 (pagehide persisted) + test suite 61/61.
- **D-38** (Accepted drift, 2026-08-02, sdk-browser drift review) — Post-impl sim at `packages/agentide/scripts/simulate-sdk-browser.mjs` is a standalone Node ESM script driving real `@platform/sdk-browser` dist (not browser HTML like the pre-impl `simulate-pre.html`).
  - Code reality: `onPageHide` → `client.disconnect("pagehide")` → `ws.close(1000, reason)` only (`packages/sdk-browser/src/lifecycle.ts:38-44`, `client.ts:113-121`)
  - Why matters: without a wire message the gateway can't unregister the cap until TCP timeout; but nothing server-side consumes `sdk.disconnect` (backend-runtime has no handler; sdk-node sends none), and PRD-TRD Scenario 9 wording matches the code — the close frame is the effective signal.
  - Resolution: GRILL T3 Q3 amended 2026-08-02 with an additive note (verbatim answer preserved) citing this drift ID.
  - Verified by: drift review sub-agent (`.reports/20260802-0659-drift-sdk-browser.md`), re-read of `lifecycle.ts:38-44`, post-impl sim scenario 7 (pagehide persisted) + test suite 61/61.
- **D-38** (Accepted drift, 2026-08-02, sdk-browser drift review) — Post-impl sim at `packages/agentide/scripts/simulate-sdk-browser.mjs` is a standalone Node ESM script driving real `@platform/sdk-browser` dist (not browser HTML like the pre-impl `simulate-pre.html`).
  - Doc reality: IMPL Phase 6 anticipated "sibling precedent D-33/D-34 = Node `.mjs` script in `agentide/scripts/`"; pre-impl sim is a static HTML page.
  - Why matters: a browser HTML sim can't import the built package and drive a real WebSocket gateway in Node; the Node script exercises the real production path (JSDOM + ws). Mirrors D-33/D-34 exactly.
  - Resolution: post-impl sim at `packages/agentide/scripts/simulate-sdk-browser.mjs`; pre-impl sim archived to `docs/features/sdk-browser/archive/simulate-pre.html`.
  - Verified by: post-impl sim 10/10 scenarios PASS (4 consecutive runs), IMPL Phase 6 note.
- **D-39** (Accepted drift, 2026-08-02, sdk-browser drift review) — two naming nits, both fixed opportunistically during reconcile:
  - (a) test name "leaves the capability unregistered in state" asserted `registered: true` — renamed to "leaves the capability registered in state" (`packages/sdk-browser/src/__tests__/index.test.ts:297`).
  - (b) `events.ts` comment listed `"drop"` as a possible disconnected reason; no code path emits it (network drops go through `scheduleReconnect` without `onDisconnected`) — comment corrected to the four real reasons (`packages/sdk-browser/src/events.ts:24`).
  - Verified by: test suite 61/61 pass after both edits.

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
- **D-29** (Resolved 2026-07-29, gateway-plugin-dispatch grill) — Original D-29 entry DEFERRED BI[8a] pending design decision; the GRILL session 2026-07-30 reached a decision (`GRILL-gateway-plugin-dispatch.txt`), D-29 superseded by Phases 1–5 implementation commits.
- **D-30** (Accepted drift, 2026-07-30, gateway-plugin-dispatch post-impl sim) — PRD-TRD Scenario 3 (disabled plugin) says "throws `GATEWAY_HANDLER_NOT_FOUND`". Implementation: kernel pre-check (`packages/gateway-core/src/dispatch.ts:94-100`) fires `GATEWAY_PLUGIN_DISABLED` *before* the PM dispatch path. PM-side fallback (if pre-check were skipped) would still be `HANDLER_NOT_FOUND`.
  - Doc reality: code returns a *more specific* error code than the PRD scenario text required. Functionally correct (both signal "this plugin is not callable"); PLUGIN_DISABLED is the better surface code for operators.
  - Why matters: divergence is intentional. Surfacing PLUGIN_DISABLED at the kernel pre-check gives operators a clearer signal than the generic HANDLER_NOT_FOUND. The PRD scenario text was stale relative to the approved Option B matrix.
  - Resolution: PRD-TRD Scenario 3 text updated to read "throws `GATEWAY_PLUGIN_DISABLED` (kernel pre-check fires before PM dispatch; PM-side fallback is `GATEWAY_HANDLER_NOT_FOUND` if pre-check is removed)". Tests + post-impl sim verify PLUGIN_DISABLED as the actual surface code.
  - Verified by: drift-bi8a-report.md, `packages/agentide/src/__tests__/gateway-plugin-dispatch.test.ts:222-234`, post-impl sim Scenario 3.
- **D-31** (Accepted drift, 2026-07-30, gateway-plugin-dispatch post-impl sim) — PRD-TRD Scenario 5 (handler throws) text says "throws `GATEWAY_INTERNAL_ERROR`". The PRD's own §API Contracts error-codes list and the IMPL Option B matrix both say `GATEWAY_HANDLER_ERROR`. Code + tests + post-impl sim assert HANDLER_ERROR.
  - Doc reality: drift is *within the PRD itself* — scenario text contradicts the API contracts list. Approved Option B picked HANDLER_ERROR (mapped from PM's `PLUGIN_HANDLER_ERROR`). Tests + impl are aligned with Option B.
  - Why matters: divergence is intentional. HANDLER_ERROR is more specific than INTERNAL_ERROR and gives operators a clearer signal. The PRD scenario text was stale.
  - Resolution: PRD-TRD Scenario 5 text updated to read "throws `GATEWAY_HANDLER_ERROR { pluginId, capabilityName, originalError }`. The audit log records `plugin.handler.error`".
  - Verified by: drift-bi8a-report.md, `packages/agentide/src/__tests__/gateway-plugin-dispatch.test.ts:262-274`, post-impl sim Scenario 5.
- **D-32** (Accepted drift, 2026-07-30, gateway-plugin-dispatch post-impl sim) — PRD-TRD Scenario 7 (uninstall) says "returns `GATEWAY_CAPABILITY_NOT_FOUND`". Code path: uninstall removes both the registry record AND the handler map. The dispatch pre-check reads `pluginManager.list()` for the install record — gone after uninstall, so `PLUGIN_NOT_INSTALLED` would fire from the pre-check. But the registry lookup in `handle-invocation.ts:resolveCapability` runs first and returns `CAPABILITY_NOT_FOUND` (capability gone from the registry).
  - Doc reality: PRD says CAPABILITY_NOT_FOUND; the test accepts EITHER `GATEWAY_(CAPABILITY|HANDLER)_NOT_FOUND` via regex. The actual code path always returns CAPABILITY_NOT_FOUND because the registry check fires before the handler map check, but the IMPL accepts either depending on which path fires first.
  - Why matters: divergence is intentional. PRD wording was sharpened but the IMPL is correct in allowing either (both signal "this cap is not callable").
  - Resolution: PRD-TRD Scenario 7 text updated to read "either `GATEWAY_CAPABILITY_NOT_FOUND` (registry lookup first) or `GATEWAY_HANDLER_NOT_FOUND` (handler map lookup first), depending on which path fires first in `handleInvocation`'s resolution sequence".
  - Verified by: drift-bi8a-report.md, `packages/agentide/src/__tests__/gateway-plugin-dispatch.test.ts:318-331`, post-impl sim Scenario 7.
- **D-34** (Accepted drift, 2026-08-01, mcp-adapter post-impl sim) — Post-impl sim at `packages/agentide/scripts/simulate-mcp-adapter.mjs` is a standalone Node ESM script (not browser HTML like `simulate-pre.html`). Drives real `@platform/agentide` + `@platform/adapter-mcp` + `@platform/gateway-core` against raw `fetch` POSTs to `/mcp`. Mirrors the D-33 pattern from `gateway-plugin-dispatch`.
  - Doc reality: pre-impl sim is a static HTML page with hardcoded PASS/FAIL markers; post-impl sim is an executable script that verifies behavior against real code.
  - Why matters: a browser sim can't drive `createPlatform()` (Node `fs/promises`, dynamic `import()`, port-binding) or hit the MCP adapter's `/mcp` endpoint (browser CORS). The post-impl sim has to be a Node script to exercise the real production path.
  - Resolution: pre-impl sim archived at `docs/features/mcp-adapter/archive/simulate-pre.html`; post-impl sim at `packages/agentide/scripts/simulate-mcp-adapter.mjs`. Sim covers 8 of the 10 PRD scenarios end-to-end (1, 3, 4, 5, 6, 7, 8, 8b); scenarios 2 (business-cap dispatch into a real SDK) and the timeout path are covered exhaustively by `packages/adapter-mcp/src/__tests__/scenarios.test.ts` (39 tests, all passing) because they require a custom `BackendRuntime` that `createPlatform()` does not currently accept.
  - Verified by: post-impl sim run on 2026-08-01 — 8/8 scenarios PASS.
- **D-35** (Accepted drift, 2026-08-01, mcp-adapter) — PRD-TRD Scenario 8 says missing bearer returns `-32001 GATEWAY_AUTH_FAILED`. The kernel's actual behavior is `GATEWAY_INVALID_REQUEST` when the token is empty/missing (auth.ts). The adapter maps `INVALID_REQUEST -> -32001` with wire message `"GATEWAY_AUTH_FAILED"`, matching the PRD.
  - Doc reality: PRD asserts `GATEWAY_AUTH_FAILED`; kernel emits `GATEWAY_INVALID_REQUEST`; adapter translates on the wire. The "real" message lives in the kernel's auth.ts, not the adapter.
  - Why matters: divergence is intentional. Operators reading PRD Scenario 8 see the wire-facing code+message that the adapter contract is bound to; the kernel's internal code is an implementation detail.
  - Resolution: Plan §4 Decision 4 documents the mapping (`-32001` for `AUTH_FAILED` and `INVALID_REQUEST` and `TOKEN_INVALID` and `TOKEN_EXPIRED`); scenario 8 + 8b in the post-impl sim and the adapter-mcp scenario test both assert `-32001 / GATEWAY_AUTH_FAILED`. Adapter also throws a custom `WireError` (not `McpError`) to keep the wire message verbatim — the SDK's `McpError` prefixes messages with `"MCP error <code>: "`, which would break the PRD's exact-message assertion.
  - Verified by: `packages/adapter-mcp/src/__tests__/scenarios.test.ts` scenarios 8 + 8b, post-impl sim Scenarios 8 + 8b.
- **D-36** (Accepted drift, 2026-08-01, mcp-adapter) — `createPlatform()`'s `runInit` / `runStatus` / `runTenant` / `runToken` / `runCapability` / `runPlugin` all now pass `adapterMcp: false`. The plan's "Decision 7 / Q6 default" is overridden for the CLI: each CLI invocation spins a short-lived platform, so binding 7100 per command would waste a port and risk `EADDRINUSE` races.
  - Doc reality: GRILL Q6 says the MCP adapter auto-registers "by default"; the CLI explicitly opts out.
  - Why matters: divergence is intentional. Daemons and boot scripts use the default `true` (so `agentide start` or a custom operator's boot script gets the adapter wired for free); CLI subcommands opt out (they don't need the adapter — they only exit).
  - Resolution: per-subcommand `adapterMcp: false` opt-out documented at `packages/agentide/src/cli.ts` with an inline comment citing Plan Decision 7. `packages/agentide/src/__tests__/mcp-adapter.test.ts:196-200` covers the opt-out path explicitly.
  - Verified by: full test suite (536/536 pass), `mcp-adapter.test.ts` Scenario `CID:agentide-mcp-test-004`, `pnpm test` green.
- **D-33** (Accepted drift, 2026-07-30, gateway-plugin-dispatch sim) — Post-impl sim at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs` is a standalone Node ESM script (not browser HTML like `simulate-pre.html`). Drives real `@platform/agentide` + `@platform/plugin-manager` + `@platform/gateway-core` packages; uses a real `.mjs` handler fixture in `/tmp`.
  - Doc reality: pre-impl sim is a static HTML page with hardcoded PASS/FAIL markers; post-impl sim is an executable script that verifies behavior against real code.
  - Why matters: a browser sim can't drive the agentide factory's `createPlatform()` (Node `fs/promises`, dynamic `import()`, plugin-manager's cleanup-confirm timer). The post-impl sim had to be a Node script to exercise the real production path.
  - Resolution: pre-impl sim remains at `docs/features/gateway-plugin-dispatch/simulate-pre.html` (archive); post-impl sim at `packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs`. Both are referenced from `IMPL-gateway-plugin-dispatch.md:122-123`.
  - Verified by: post-impl sim run on 2026-07-30 — 8/8 scenarios PASS in 0.6s.
- **D-1 → D-28** (Resolved 2026-07-29 by session-manager doc reconciliation) — session-manager docs were reconciled with code across 5 points of disagreement:
  - **`touch()` visibility (TRD + IMPL):** Code has `touch(sessionId)` at `packages/session-manager/src/index.ts:132-138` and in the `SessionManager` interface at `types.ts:137`. FLOW already cited `touch()` behaviorally (`FLOW-session-manager.md:41`). TRD §2.3 was missing the API contract; added a full entry (params, response, errors, side effects) at `TRD-session-manager.md:276-290`. TRD high-level architecture diagram updated to list `touch()` (`TRD-session-manager.md:72`). IMPL Phase 0 §SessionManager interface updated to include `touch()` (`IMPL-session-manager.md:52`).
  - **`touch()` on non-active session (IMPL):** IMPL said "no-op" (`IMPL-session-manager.md:147` original). Code throws `SessionNotActiveError` (`index.ts:134`; test at `session-manager.test.ts:114`). IMPL corrected to: "`touch()` on a non-active session (suspended or archived) throws `SessionNotActiveError`".
  - **`attachResource` permits suspended (TRD + IMPL):** TRD §2.3 was silent on suspended. IMPL Phase 3 said "validates session is active" (`IMPL-session-manager.md:206` original). Code at `resources.ts:35` checks `status === "archived"` only — permits active AND suspended (test at `session-manager.test.ts:141-148`). TRD §2.3 `attachResource` updated: "Permitted when session status is `active` OR `suspended` — resources attached while suspended survive resume without re-attachment." IMPL Phase 3 updated: "validates session is active or suspended (rejects archived)".
  - **Minimum timeout value (IMPL):** IMPL Phase 1 said `timeout >= 1000` (`IMPL-session-manager.md:79` original). Code enforces `< 1` rejection at `index.ts:109-110`; tests use 1ms and 10ms (`session-manager.test.ts:107, 145`). IMPL corrected to `timeout >= 1`.
  - **No code changes required** — all behavior was already correct; the work was doc reconciliation. Full test suite: 394/394 pass; typecheck clean.

- **D-45** (Resolved 2026-08-06, session-list pack) — `session.list` returned `[]` unconditionally; the Sessions snapshot (dashboard D1 + `agentide sessions`) was dead. Fixed: `SessionManager.list()` added (`packages/session-manager/src/types.ts` interface + `index.ts` CID:index-002 — returns all records in insertion order, archive-TTL eviction store-side) and `session.list` wired to it (`packages/gateway-core/src/factory.ts`, v1-stub NOTE removed). v1 lists sessions across all callers — tenant scoping is a v2 concern (SessionRecord has no tenantId).
  - Verified by: session-manager `list()` tests (empty → created records → archived until archive TTL), gateway-core handle-invocation test (session.create → session.list shows active → session.destroy → shows archived), live `agentide sessions` against the 0.2.2 gateway.
- **D-65** (Resolved 2026-08-06, capabilities-alias fix, PR #29 da10df0) — `capabilities` CLI alias printed an empty table against a real gateway: `capability.list` (BI[7]) defensively returns `[]` for empty `input.scope`, and the alias sent no input. Fixed: alias now sends `{scope:["*"]}` (operator full-catalog view) via a new optional `AliasDef.input`; factory.ts comment corrected (it claimed omitting scope shows everything).
  - Verified by: consumer.test.ts regression test (invoke carries scope ['*']), live `agentide capabilities` against a 40-cap gateway.
- **D-72** (Resolved 2026-08-06, session-list pack) — active revocation was fixed in code 2026-08-05 (handle-invocation.ts post-verifyToken block, `cli_` callerId → `findClientById` → reject when revoked; factory threads `clientSvc` into the ctx) but the drift entry was never closed and the invocation path had zero test coverage. Pinned end-to-end: client.create → token works → client.revoke → same token denied with `AUTH_FAILED`/`client_revoked`. Also fixed the test fs fake that appended instead of overwriting — it corrupted `clients.json` and silently masked revocation lookups (store.load() swallows parse errors → `[]`).
  - Verified by: handle-invocation.test.ts "denies invocation with a revoked client token (D-72)" + code at handle-invocation.ts (4a).
- **D-73** (Resolved 2026-08-06, session-list pack) — the `--no-tls` CLI surface landed with the S8 fix (`start.ts` CID:start-011 → `requireTls: !noTls`, stderr warning) but the drift entry was never closed.
  - Verified by: `packages/agentide/src/start.ts:132-161` + oauth-token-handler tests.
- **D-50** (Resolved 2026-08-06, drift-log reconciliation) — the `expectedOrigins` mint side shipped 2026-08-03 as the expected-origins feature pack (`docs/features/expected-origins/` — GRILL + PRD-TRD + IMPL + PLAN) but the drift entry was never closed. Verified: `issueToken`/`auth.token.issue` accept + mint the claim (factory.ts:250-251, 360-373), CLI `token issue` has `--origin`/`--origins` (cli.ts:103, 357-359), enforcement at adapter-websocket W2 Q4 + backend-runtime (D-54 closed in the BI[24] row).
  - Verified by: expected-origins pack docs + code lines above; live browser auth path exercised in the sdk-browser sim.
- **D-46** (Resolved 2026-08-06, metrics pack) — `gateway.metrics` returned placeholder zeros. Fixed with a real per-gateway MetricsCounter (`packages/gateway-core/src/metrics.ts` CID:metrics-001/002): incremented at the canonical handleInvocation exit paths (auditOk → ok, auditError → error, exitWithError → denied with rateLimit/auth sub-buckets classified from the error code). Shape unchanged from the placeholder (interface forever). Wired through factory (BuildHandlersCtx + handleInvocation ctx, additive optional `metrics` on HandleInvocationCtx).
  - Verified by: 4 new handle-invocation tests (ok/denied/authFailures/rateLimitDenials — exact counts incl. the snapshot-excludes-itself semantics); gateway-core 182/182 green.


- **D-101** (Low, 2026-08-07, reporter: adapter-rest drift review) — IMPL §"Test Strategy" lists six test files (`parse.test.ts`, `router.test.ts`, `status-map.test.ts`, `invoke.test.ts`, `capabilities.test.ts`, `server.test.ts`); only four shipped. The "parse" and "router" coverage was folded into existing files (body-parser assertions on invalid JSON / missing capability in `invoke.test.ts`; router 404 assertions on `GET /invoke`, `POST /unknown`, `GET /capabilities/{name}` in `server.test.ts`). Functionally covered; docs over-promised. Fixed in IMPL cleanup commit.
- **D-102** (Low, 2026-08-07, reporter: adapter-rest drift review) — IMPL §"Phase Plan" lists 6 phases; all marked ✅ Done — matches reality (verified by drift review walking each phase).
- **D-103** (Low, 2026-08-07, reporter: adapter-rest drift review) — `simulate.sh` asserted HTTP status + body JSON shape but not `content-type: application/json`. PRD §"Simulation Contract" requires all three. Production code satisfies the contract (server.test.ts asserts it). Fixed in cleanup commit: helpers now capture + assert content-type alongside status and body shape.
- **D-104** (Low, 2026-08-07, reporter: adapter-rest drift review) — PRD-TRD §"Behavioral Spec" Scenario 1 body text `{"capabilities": [...]}` is illustrative; canonical wire shape is `{output: <kernel output>}` per IMPL §"API Contracts". Same drift for Scenario 2 (`{"products": [...]}`) and Scenario 8 (`{"capabilities": [...]}`). Fixed in cleanup commit: added a "Note on body shapes" footnote at the top of §"Behavioral Spec" pointing readers to the canonical wire envelope.
- **D-105** (Low, 2026-08-07, reporter: adapter-rest drift review) — `server.ts:66-67` built `errors = restErrorConverter` then `void errors;` — dead binding (the handlers default to the same singleton via `errors: ErrorConverter = restErrorConverter`). Cosmetic. Fixed in cleanup commit: removed the dead binding; the comment now explains why no top-level binding is needed.
- **D-106** (Low, 2026-08-07, reporter: adapter-rest drift review) — `simulate-pre.html` pre-impl demo covered only 8/10 PRD scenarios (missing 429 rate-limit and 500 runtime failure). Post-impl caught up (S9 + S10 in `simulate.sh`). Worth archiving pre-impl per the A7 / adapter-core precedent (`docs/features/adapter-core/.archive/simulate-pre.sh`). Also: the GET /capabilities/{name} demo in the pre-impl showed the v1.1-intended shape (the broken describe return); post-impl correctly hides the route (D-100 deferral). Not a contradiction — pre-impl was rehearsal of the v1.1 contract. Not blocking ship.
- **D-107** (Low, 2026-08-07, reporter: adapter-rest drift review, runtime hygiene) — Stale `simulate-server.mjs` from a previous run held port 7400 during this review. The sim honors the `SIM_PORT` env var (`simulate.sh:16`) so re-running on a free port works cleanly (verified at `SIM_PORT=7402`). Not a code defect — operator hygiene. Fix: kill stale helpers before re-running, or always pass `SIM_PORT` in CI.
