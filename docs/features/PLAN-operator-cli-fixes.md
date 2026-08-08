# PLAN — Permanent Fixes for Operator CLI + SDK Reconnect (2026-08-08)

Status: IMPLEMENTED + VERIFIED (2026-08-08; clean-slate + live gateway-restart E2E)
Companion drift entries: D-115 (start data dir), D-116 (SDK reconnect).
Context: clean-slate verification pass — one local binary + one data dir makes
init/start/token-issue/REST all green. The three issues below are what broke
that flow for a real operator using the released CLI.

---

## Issue 1 — `agentide status` cannot reach the gateway without a manual `--url`

### What the operator experiences
- `agentide status` (no flags) never reaches the gateway without `--url`.
- Even `--url ws://127.0.0.1:7300` fails with **HTTP 400**; the correct URL is
  `ws://127.0.0.1:7300/ws` (undocumented, discovered by trial and error).

### Root causes (all confirmed in code)
1. `saveConfig` (packages/agentide/src/config.ts:236, CID:config-003) only
   persists `{ token }`. There is no `gateway_url` support at all, so after
   `init` + `token issue` the config file holds a token but no URL.
2. `resolveConfig` (config.ts:184-204) requires a URL from flag > env > config
   file; **no default** (GRILL Q3 lock — "no default URL in v1", narrowed to
   "no default host"). Without a config-file URL, every consumer command needs
   `--url` by hand.
3. `applyPortDefault` (src/url-default.ts:16) inserts `:7300` when the port is
   missing but **never appends `/ws`**. The WS adapter only serves `path:
   "/ws"` (packages/adapter-websocket/src/server.ts:62), so a bare
   `ws://host:7300` gets an HTTP 400 on upgrade.
4. `start` knows the real bound URLs (start.ts:255 banner) but never writes
   them anywhere the CLI can read back.

### The permanent fix (one chain, no manual URL anywhere)
- **F1a — `saveConfig` learns `gateway_url`**: extend `entries` to
  `{ token?, gatewayUrl? }`; same line-based merge as the token (CID:config-003
  pattern). Rename the exported shape to `ConfigEntries`.
- **F1b — `start` persists the URL it actually bound**: in `runStart`, after a
  successful bind (start.ts:245-256), call
  `saveConfig({ gatewayUrl: "ws://127.0.0.1:7300/ws" })` with the ws adapter's
  real port. Operator runs `agentide start` on this machine → the CLI consumer
  now resolves the URL from the config file with zero flags.
  - Only when the ws adapter is enabled (adapterWsEnabled). Skip when `--no-ws`.
  - Overwrites a stale `gateway_url` (e.g. from a previous gateway on another
    port) — start is authoritative for "the gateway I am running right now".
- **F1c — `applyPortDefault` appends `/ws` when the path is empty or `/`**:
  `ws://host:7300` → `ws://host:7300/ws`. The banner/help text then matches
  reality. Non-default paths are kept verbatim (future-proofing).
  - Check the SDK-door wrong-door detection still fires (consumer.ts:200
    WsDoorMismatchError): the SDK door ignores unknown paths, so appending
    `/ws` cannot silently change that path's outcome — verify in tests.
- **F1d — help text**: `agentide status --help` (and the Q2 GRILL quote in
  url-default.ts comment) should document the `:7300/ws` form.

### Verification
- Unit: saveConfig round-trips `gateway_url`; applyPortDefault maps
  `ws://h:7300` → `ws://h:7300/ws` and leaves `ws://h:7300/custom` alone.
- E2E on clean slate: `init` → `start --all-doors` → `token issue` → bare
  `agentide status` returns uptime without any `--url`.

---

## Issue 2 — `init` never saves the bootstrap token to the global config

### What the operator experiences
- `agentide init` prints a bootstrap token to the terminal (30s auto-clear,
  `printTokenWithClear`) but writes **nothing** to `~/.config/platform/config.toml`.
- The token is lost if the terminal scrolls away; `agentide status` then fails
  with exit 2 "token required" until a manual `token issue` re-saves.

### Root cause
- `runInit` (packages/agentide/src/cli.ts:305-342) mints the bootstrap token
  and prints it, but never calls `saveConfig`. D-112's "mint once, never
  retype" only applies to `token issue` (cli.ts:464) — `init` is the first mint
  an operator ever runs and it is the one that forgets.

### The permanent fix
- **F2a — `init` saves the bootstrap token**: in `runInit`, after minting,
  call `saveConfig({ token: bootstrapToken })` (same call `token issue` uses).
  The printed token stays (with auto-clear) for offline/other-machine use.
- **F2b — order guarantee**: F1b (`start` saves gateway_url) runs after F2a, so
  the first `init` + `start` pair yields a complete config file. Add a unit
  test asserting the config file after init contains `token = "..."`, and after
  start also contains `gateway_url`.

### Verification
- Unit: runInit leaves `~/.config/platform/config.toml` with a token line,
  mode 0600.
- E2E on clean slate: `rm -rf ~/.config/platform` → `init` → config file exists
  → `status` works with zero flags after `start`.

---

## Issue 3 — D-116: SDK reconnects at TCP level but never re-registers caps

### What the operator experiences
- Gateway restart while an app is connected → app's socket reconnects (TCP
  ESTABLISHED) but business capabilities vanish from the catalog; every
  business invoke fails until the app is restarted by hand. No error surfaces.

### Code path (confirmed)
- On close, `scheduleReconnect` (packages/sdk-node/src/client.ts:244-253)
  re-calls `open()`, which re-sends `sdk.auth` and emits `"open"` immediately
  after sending — **before** the gateway's `sdk.auth.ack` (client.ts:120-128).
- `attachLifecycle` (packages/sdk-node/src/lifecycle.ts:66-76) re-registers on
  `"open"` only when `state.registered.size > 0`.
- Observed in the live test: log froze at 09:24:25.962 (moment the new gateway
  bound 7350); no re-register, no caps. Suspected: re-register racing the fresh
  gateway's handshake/auth — the re-register runs on raw socket open, so if the
  gateway rejects or hasn't armed its per-connection cap registry, the
  registration is lost and never retried (backend-runtime registry.ts
  "replace prior connection for the same key" path).

### The permanent fix
- **F3a — re-register AFTER `sdk.auth.ack`, not on raw `open`**: the client
  already surfaces the ack as a message (`{type:"sdk.auth.ack"}`); lifecycle
  should move the `reRegisterAll` trigger from the `"open"` handler to a
  message handler for `sdk.auth.ack` (with the `registered.size > 0` guard).
  Cap replay then only happens once the gateway has accepted the identity —
  no race window, no silent loss.
  - Keep the `"open"` handler for phase + `publisher.connected()` only.
- **F3b — surface auth rejection**: when the gateway responds with a
  `sdk.auth.error` (or closes the socket immediately after auth), lifecycle
  logs an explicit `lifecycle: auth rejected` error and does NOT clear the
  registered set (so the next reconnect re-plays). Operator-visible in the app
  log; mirrors the refresher flow (refresher.ts).
- **F3c — backend-runtime cross-check**: verify registry.ts replace-connection
  semantics: a reconnecting app with the same appId must not lose its cap
  accumulator on socket replacement. Add a gateway-side test:
  connect SDK → kill gateway → boot new → connect SDK → caps present.
- **F3d — deterministic repro test first**: before fixing, add a test that
  kills the gateway mid-connection, boots a new one, and asserts
  `capability.list` still contains the business caps (currently fails /
  times out — proves the bug in CI form).

### Verification
- Unit (sdk-node): ack-before-re-register ordering — open() then ack then
  re-register; auth rejection does not clear registered.
- Integration: the repro test from F3d goes green.

---

## D-115 (small, same sweep)
- `start` should auto-create the data dir (start.ts:165-178 probes instead of
  mkdir). One-line mkdirSync in runStart before the probe; covered by
  cli-ops-ergonomics tests.

---

## Order of work (suggested)
1. D-115 mkdir (trivial).
2. Issue 1 (F1a-F1d) + Issue 2 (F2a-F2b) — same config.ts surface; one commit
   "feat(cli): persist gateway_url on start, save bootstrap token on init".
3. F3d repro test (red), then F3a-F3c (green) — "fix(sdk-node): re-register
   caps after auth-ack, not on raw socket open".
4. Full clean-slate E2E: init → start → token issue → bare `agentide status` →
   `capability list --scope '*'` → example app connects, 11 caps visible, kill
   gateway, restart, caps re-appear without app restart.

## Open questions for the user
- F1b: should `start` always overwrite the config gateway_url, or only when no
  URL is present yet? (Default proposed: always — start is authoritative.)
- Should `init` print the token at all once it is saved to config, or keep the
  auto-clear print for offline use? (Default proposed: keep the print.)
