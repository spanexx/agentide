# IMPL: agentide CLI consumer commands

**Slug:** agentide-cli-consumer
**Status:** Draft (after PRD-TRD approved)
**Date:** 2026-08-03

8 phases, one per PRD-TRD scenario. strict TDD. gate: each phase's tests green + post-impl sim 1:1 against the 12 sim commands in the PRD-TRD.

## Phase 0 — preflight (no code)

- read `docs/features/cli-adapter/PRD-TRD-cli-adapter.md` (the source we're porting from)
- read `docs/features/websocket-adapter/PRD-TRD-websocket-adapter.md` (wire contract)
- read `packages/agentide/src/cli.ts` + `dist/bin.js` (current shape)
- read `packages/agentide/dist/cli.js` (compiled output — check what the bin entry actually does today)
- run preflight sim: `node packages/agentide/dist/bin.js --help` — confirm current behavior before changes
- run all 861 tests — confirm green baseline
- write the IMPL doc (this file)
- outcome: green baseline + plan committed before any code changes

## Phase 1 — scenario 6 (token hygiene) — lowest risk, foundational

**Why first:** token hygiene is independent of the WS client. gets the perms-warning helper + `path:` indirection working without touching any other code.

**Tests:**
- `config.test.ts`:
  - `path:/absent` → exit 2 with `error: token file not found: /absent`
  - `path:/file/with/0644/perms` → one stderr warning `<file> is group/world-readable — consider chmod 600`
  - config file 0600 → no warning
  - config file 0644 → one warning per run
  - flag token takes precedence over env, env over config file

**Outcome:** `config.ts` module with `resolveConfig(argv)` returning `ResolvedConfig`. wired into `bin.js` so the resolution happens BEFORE the bin entry writes stdout/stderr.

## Phase 2 — scenario 1 (config precedence)

**Tests:**
- `config.test.ts` (extend):
  - flag > env > config > prompt: 5 cases
  - `--url` + `--token` only → both from flag
  - env only → both from env
  - config file only → both from file
  - missing URL, non-TTY → exit 2 with `error: gateway URL required (--url, PLATFORM_GATEWAY_URL, or config file)`
  - missing token, non-TTY → exit 2 same shape
  - missing URL+token, TTY → prompt for token only; URL never prompted (Q3 lock)
  - `--config <path>` overrides default path
  - unknown keys in config.toml → ignored, no error

**Outcome:** full precedence tree working. config precedence used by both in-process and remote commands.

## Phase 3 — scenario 5 (exit codes)

**Tests:**
- `exit-codes.test.ts`:
  - `0` from successful invoke.result
  - `1` from invoke.error (any GATEWAY_* code, passed through verbatim)
  - `2` from each pre-flight failure path: usage, config missing, token unparseable, connection refused, close 1009, close 1011, subscribe.error, error frame
  - `3` from TLS/upgrade failure
  - `4` from auth.error before auth.ok (close 1008, all W2 codes except origin mismatch)
  - `5` from SIGINT/SIGTERM during a watch run

**Outcome:** `exit-codes.ts` module with the `ExitCode` enum + `mapErrorToExitCode(err)` function. `bin.js` writes the right exit code based on `result.exitCode`.

## Phase 4 — scenario 3 (output shaping)

**Tests:**
- `output.test.ts`:
  - TTY + alias command → table output (assert: column headers, row data)
  - TTY + status → key:value
  - TTY + invoke → pretty JSON (2-space indented)
  - non-TTY (pipe) → compact one-line JSON
  - `--json` flag → compact JSON regardless of TTY
  - tables respect TTY width (truncate or wrap gracefully)
  - empty result set → empty table (no error)

**Outcome:** `output.ts` module with `renderTable(columns, rows, opts)`, `renderKeyValue(obj, opts)`, `renderJson(value, opts)`. wired into all alias + invoke handlers.

## Phase 5 — scenario 8 (failure surfaces)

**Tests:**
- `consumer.test.ts`:
  - unreachable gateway → `error: connect ECONNREFUSED 127.0.0.1:7300` + exit 2
  - close 1009 → `error: frame too large` + exit 2
  - close 1011 → `error: heartbeat timeout` + exit 2
  - subscribe.error frame → `error: <code>` + exit 2
  - error frame during invoke → exit 2
  - TLS handshake failure → `error: TLS handshake failed` + exit 3
  - generic GATEWAY_INTERNAL_ERROR → `error: GATEWAY_INTERNAL_ERROR — <message>` + exit 1

**Outcome:** all error paths produce `error: <plain-English>` to stderr + correct exit code. tested against a mock WS server that emits each error type.

## Phase 6 — scenarios 2 + 4 (alias + invoke) — needs WS client

**Step 6a — extend `@spanexx/adapter-websocket` with a client factory:**
- add `packages/adapter-websocket/src/client.ts` — small WS client using `ws`
- export `createWsClient({ url, token, clock? })` returning `{ invoke, subscribe, onEvent, close, state }`
- re-export wire types from `protocol.ts` (already public)
- test in `packages/adapter-websocket/src/__tests__/client.test.ts` — same harness as server tests
- verify: existing 30 server tests still pass

**Step 6b — wire alias + invoke into consumer.ts:**
- `agentide sessions` → WS invoke `session.list`
- `agentide health` → WS invoke `system.health`
- `agentide capabilities` → WS invoke `capability.list`
- `agentide plugins` → WS invoke `plugin.list`
- `agentide status` → WS invoke `gateway.status`
- `agentide invoke <cap> [--args '<json>'] [--session <id>]` → WS invoke the named cap
- `--args '<json>'` parsing: JSON.parse with friendly error on malformed → exit 2
- input omitted → `{}` (empty object)
- `--session` → `sessionId` on the wire frame

**Tests:** `consumer.test.ts` with a mock WS server (reuses harness from step 6a)
- alias → invokes expected cap, response formatted per output rules
- `agentide invoke product.list` → WS frame `{type:"invoke", name:"product.list", input:{}, mode:"call"}`
- `--args '{...}'` parsed and forwarded as `input`
- `--session <id>` added as `sessionId`
- invoke.result → output rendered + exit 0
- invoke.error → error rendered + exit 1
- error code passes through verbatim (no third vocabulary)

**Outcome:** `consumer.ts` module with full alias + invoke support. the WS client lives in `adapter-websocket` so other consumers (dashboards, tests) can reuse it.

## Phase 7 — scenario 7 (watch)

**Tests:** `consumer.test.ts` (extend):
- `agentide watch sessions`:
  1. snapshot via WS invoke `session.list` → printed once
  2. WS subscribe `["session.*"]`
  3. on each event frame → print `{type:"event", topic, ...}` as one NDJSON line
  4. SIGINT during run → exit 5
- `--watch --json` → pure JSON stream (snapshot + events, all compact one-line)
- `--watch --topic session.created` → override default topic
- `stats` frame with `dropped > 0` → one stderr warning
- default topic per alias: `sessions`→`session.*`, `plugins`→`plugin.*`, `capabilities`→`capability.*`, `status`/`health`→`gateway.*`
- invalid alias → error + exit 2

**Outcome:** watch mode working end-to-end. reconnect is explicitly out of scope (Q1 lock — "no reconnect in v1").

## Phase 8 — post-impl sim + drift + delete rust crate

**Post-impl sim:**
- write `packages/agentide/scripts/simulate-cli-consumer.mjs` (mirror of the cli-adapter sim structure)
- run the 12 sim commands from the PRD-TRD against a live `pnpm run gateway` + the new `agentide` binary
- assert exit codes, output shapes, wire frames, NDJSON events
- INTERACTIVE mode (`-i`) for debugging

**Drift:**
- run drift review via `drift` skill (sub-agent review of fresh eyes)
- log any open drift items

**Cleanup:**
- mark BI[23] cli-adapter row in `docs/Feature_Backlog.md` as DELETED (add BI[28] agentide-cli-consumer row above it)
- delete `crates/cli-adapter/` (entire rust crate)
- delete `crates/cli-adapter/README.md` (no longer needed)
- update `docs/drift.md` if needed

**Final verification:**
- `pnpm vitest run` → all 861 + new tests green
- `pnpm build` → clean
- `pnpm lint` → clean
- `bash scripts/check-banned-types.sh` → clean
- post-impl sim → all 12 commands pass
- commit

## risk register

1. **WS client timing.** the `ws` library is event-based, not promise-based. `invoke()` needs correlation-id tracking to map async responses to promises. get this wrong and responses get crossed. mitigation: use a single concurrent invoke map keyed by correlationId, like sdk-node does.
2. **watch mode Ctrl-C handling.** SIGINT during a sync read() can leave the WS in a weird state. mitigation: register signal handlers BEFORE the read loop, set a flag, close cleanly on next iteration.
3. **`path:` token file path traversal.** a malicious config could set `path:/etc/passwd`. mitigation: resolve to absolute path, refuse relative paths from config file (but allow from flag/env), warn on files outside user's home.
4. **TOML parsing.** TOML allows comments and multi-line strings but no exec. safe. but unknown keys need explicit handling — `node:` has no built-in TOML. mitigation: add `@iarna/toml` dep (~12kb).
5. **cross-platform TTY detection.** `process.stdout.isTTY` works on unix. windows needs different handling. mitigation: check `node:tty` `isatty(process.stdout.fd)` for cross-platform.

## what we DO NOT build (deferred)

- shell completions → `future.md`
- profile switching → `future.md`
- watch reconnect → `future.md`
- `--stream` invoke mode → `future.md`
- `agentide config set` → `future.md`
- per-platform TTY colors (chalk etc.) → `future.md`

## success criteria

- all 8 scenarios green (one per phase, scenario tests are the phase gate)
- 861 + new tests all green
- post-impl sim 12/12 commands pass
- `crates/cli-adapter/` deleted
- BI[23] marked DELETED in backlog, BI[28] added in its place
- commit lands clean

## References

- `PRD-TRD-agentide-cli-consumer.md` (this pack)
- `GRILL-agentide-cli-consumer.txt` (this pack)
- `docs/features/cli-adapter/IMPL-cli-adapter.md` — the IMPL we're replacing (in rust)
- `docs/features/cli-adapter/PRD-TRD-cli-adapter.md` — the PRD we're porting from
- `packages/agentide/src/cli.ts` — current operator CLI (becomes the seed for consumer additions)
- `packages/adapter-websocket/src/server.ts` — WS server (we add a client sibling)
- `packages/adapter-websocket/src/protocol.ts` — wire types (shared)
- `packages/sdk-node/src/client.ts` — reference for a TS WS client pattern