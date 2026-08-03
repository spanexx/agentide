# IMPL: CLI Adapter (`platform`)

**Slug:** cli-adapter
**Status:** Draft
**Date:** 2026-08-03
**PRD-TRD:** [PRD-TRD-cli-adapter.md](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/cli-adapter/PRD-TRD-cli-adapter.md)
**GRILL:** [GRILL-cli-adapter.txt](file:///home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide/docs/features/cli-adapter/GRILL-cli-adapter.txt)

## Phase Plan

**Before Phase 1:** opensrc ALREADY DONE — all 7 crates fetched and verified (licenses,
versions, call patterns recorded in Dependency Analysis below). Rust toolchain: stable,
edition 2021.

### Phase 1: Crate scaffold + precommit chain

**Build:**
- `agentide/crates/cli-adapter/` — `cargo init --name cli-adapter`; `Cargo.toml` with the 7
  pinned deps (Dependency Analysis) + `[[bin]] name = "platform"` (Q5 — package name
  `cli-adapter`, binary name `platform`).
- Module skeleton: `src/main.rs` (arg parse + dispatch), `config.rs`, `client.rs`,
  `output.rs`, `watch.rs`, `errors.rs` (empty stubs, PRD-TRD §Architecture Notes).
- `agentide/scripts/precommit-rust.sh` (Q5) — `cargo fmt --check` + `cargo clippy
  --all-targets -- -D warnings` + `cargo test`; if no cargo installed → skip with one
  warning line, exit 0.
  Chained after `npm run build` in root precommit.

**Verify:**
- [x] `scripts/precommit-rust.sh` runs clean from repo root AND skips gracefully without cargo.
- [x] `cargo build` produces `platform` binary; `--version` prints 0.1.0.
- [x] `cargo test` green (empty suite passes).

**Blocked by:** nothing

### Phase 2: Config resolution (PRD S1, S6)

**Build:**
- `src/config.rs` — `resolve()` walks flag > env (`PLATFORM_GATEWAY_URL`,
  `PLATFORM_TOKEN`) > TOML (`dirs::config_dir()/platform/config.toml`, override via
  `--config <path>`) > prompt (TTY-only, `rpassword::prompt_password`). Unknown TOML keys
  ignored (`#[serde(default)]`, no deny_unknown_fields). `path:` indirection on token from
  ANY source; missing file → exit 2. Perms warning for config file OR `path:` file when
  perms looser than 0600 — once per run (PRD S6). No hardcoded default URL; missing
  URL+token with no TTY → exit 2.

**Verify:**
- [x] Unit tests: precedence order (each source wins over lower), env absent, config
      absent, `--config` override path, `path:` file read + missing-file exit 2, unknown
      key ignored, perms warning fires once (0600 vs 0644).
- [x] TTY detection via `std::io::IsTerminal` on stdin (`config.rs` `resolve_real` gates
      the interactive prompt on it; unit-tested via the `tty` seam).

**Blocked by:** Phase 1

### Phase 3: Client — connect/auth/invoke (PRD S4, S5, S8)

**Build:**
- `src/client.rs` — `tungstenite::connect(url)`; TLS via rustls feature; TLS-layer
  failure on wss:// → exit 3, transport (refused/DNS) and HTTP-upgrade failure → exit 2
  (tungstenite 0.30 + rustls handshake lazily, so errors are classified by a TCP
  reachability probe — see `classify_connect_error`, CID:client-005). Send
  `{type:"auth", token}`; await `auth.ok` (else `auth.error` frame OR close 1008
  → exit 4). `invoke` frame `{type:"invoke", correlationId, name, input?, sessionId?,
  mode:"call"}`; map `invoke.result` (`output` key per locked W4 wire) → exit 0,
  `invoke.error` → print code+message verbatim, exit 1. Close 1009/1011 (before or
  after auth), `error` frame, unreachable → exit 2. `correlationId`: per-run counter —
  one in-flight invoke at a time, no `uuid` crate (delay-complexity).
- `src/errors.rs` — `ExitCode` enum 0–5 + layer mapping.

**Verify:**
- [x] Integration tests (scripted MockServer over real TCP+WS): auth.ok path,
      auth.error → exit 4, invoke.result → 0, invoke.error passthrough → 1,
      close 1009 → 2, close 1011 during invoke → 2, `error` frame → 2,
      connect refused → 2, close during auth (1008) → exit 4 (PRD S5 — the
      close IS the rejection when the `auth.error` frame is skipped),
      no-upgrade → 2, wss TLS handshake failure → exit 3 AND wss connect
      refused → exit 2 (transport ≠ TLS, rustls ring provider pinned +
      `install_default`).
- [x] `cargo clippy -- -D warnings` clean.

**Blocked by:** Phase 2

### Phase 4: Output shaping (PRD S3)

**Build:**
- `src/output.rs` — TTY-aware: alias tables (capabilities = name/version/tier, sessions =
  id/status/created, plugins = id/version/status), status/health key:value, invoke pretty
  JSON; piped stdout or `--json` → compact JSON. `std::io::IsTerminal` on stdout.

**Verify:**
- [x] Unit tests: each table shape (capabilities name/version/tier, sessions
      id/status/created, plugins id/version/status), status/health key:value,
      invoke pretty vs compact, `--json` (force non-TTY) path, missing fields
      render dash, string cells unquoted, `createdAt` fallback for the
      sessions `created` column (real session-manager vocabulary).
- [x] Manual: `platform capabilities | cat` renders compact (piped); TTY renders
      table (name/version/tier), status/health key:value, invoke pretty JSON
      (re-verified 2026-08-03 against `examples/mock_wire.rs`).

**Blocked by:** Phase 3 (output consumed in client)

### Phase 5: Dispatch + aliases (PRD S2, S4)

**Build:**
- `src/main.rs` — alias map (`capabilities`→`capability.list`, `sessions`→`session.list`,
  `plugins`→`plugin.list`, `status`→`gateway.status`, `health`→`system.health`);
  `invoke <cap> [--args '<json>'] [--session <id>]`; full flag surface `--url`
  /`--token`/`--config`/`--args`/`--session`/`--json`/`--watch`/`--topic`/`--help`
  /`--version` (flags may precede the subcommand; `--help` → stdout + exit 0);
  unknown subcommand / missing subcommand → usage error exit 2. Output view is
  chosen by ENTRY PATH (PRD S3): aliases → tables/kv, `invoke <cap>` → pretty JSON.

**Verify:**
- [x] Unit tests: alias mapping table, flag parsing (any order, value flags do not
      swallow the next flag, `--url`/`--token` parsed), `--args` passed through
      verbatim (serde_json parse, no client-side quote stripping — a literal quote
      pair is DATA, never stripped; unparseable → None), view selection by entry
      path (`invoke gateway.status` → JSON; aliases → tables/kv), usage text covers
      the full PRD flag surface.
- [x] Manual smoke against scripted mock (`examples/mock_wire.rs`, re-verified
      2026-08-03): capabilities table on TTY + compact piped, sessions `--json`
      compact, status/health key:value, `invoke` with `--args` round-trips input
      verbatim, deny → `error: CODE — msg` exit 1, unknown subcommand → usage exit
      2, connect refused → exit 2, `--token path:` missing file → exit 2,
      `--help` → exit 0.

**Blocked by:** Phase 4

### Phase 6: Watch (PRD S7)

**Build:**
- `src/watch.rs` — one connection: snapshot `invoke` (mode:"call") → `subscribe` default
  topic (sessions→`session.*`, plugins→`plugin.*`, capabilities→`capability.*`,
  status/health→`gateway.*`; `--topic` overrides) → NDJSON `event` frames until Ctrl-C
  (`ctrlc::set_handler` sets flag; SIGTERM → exit 5 via ctrlc `termination` feature,
  per Q4 lock) → exit 5. `stats.dropped > 0` → one stderr warning.
  `subscribe.error` → exit 2 (PRD S5). No reconnect v1 (drop → exit 2). Watch only on
  the 5 aliases.

**Verify:**
- [x] Unit tests (mock server): snapshot then events, `--topic` override, stats warning,
      `subscribe.error` → exit 2, Ctrl-C/SIGTERM flag → exit 5. (7 tests in
      `tests/watch.rs` green; SIGTERM EINTR treated as transient so the flag path
      wins — `client.rs` `read_raw_frame`.)
- [x] `platform sessions --watch --json` = pure JSON stream (compact snapshot + NDJSON).
      (Verified vs `examples/mock_wire`: snapshot + `ev-1`/`ev-2` events, `--topic`
      override echoed on the wire, SIGTERM → exit 5, `invoke --watch` → exit 2.)

**Blocked by:** Phase 5

### Phase 7: Integration + wiring

**Build:**
- Root `package.json` precommit: `npm run build && bash scripts/precommit-rust.sh`.
- End-to-end smoke against a real gateway + websocket adapter when BI[24] ships (see
  Risk Notes); until then the post-impl sim drives the binary against the locked W4 wire.

**Verify:**
- [ ] `npm run precommit` runs both TS and Rust checks.
- [ ] Full demo script (PRD Simulation Contract) passes against live adapter.

**Blocked by:** websocket-adapter delivery (BI[24]) — the only door

## Phase Dependencies

```
P1 scaffold → P2 config → P3 client → P4 output → P5 dispatch → P6 watch → P7 integration
                       ↗ (P3 feeds P4/P5/P6; P2 feeds P3)
P7 additionally blocked by: BI[24] websocket-adapter ship (wire is locked, adapter not yet)
```

## Test Strategy

- Unit tests per module in `crates/cli-adapter/src/<module>/tests` (or inline `#[cfg(test)]`),
  run via `cargo test`. Network paths use a local echo/mock WS server (tungstenite server
  feature is dev-only) or a hand-rolled TCP listener speaking the locked W4 frames.
- CLI-level tests: `assert_cmd`-style via `std::process::Command` on the built binary
  (exit codes, stdout/stderr shapes). Dev-dep only, defer to IMPL Phase 1 decision if
  `assert_cmd` adds weight — plain `Command` suffices v1.
- Post-impl sim: drives the REAL binary per PRD Simulation Contract (needs live adapter).

## Dependency Analysis (opensrc)

All 7 fetched via opensrc (2026-08-03), licenses verified from crate manifests:

- **tungstenite 0.30.0** — MIT OR Apache-2.0; active (snapview). Sync WS client
  (`connect()` → `(WebSocket, Response)`, 3 retries; `read()`/`send()`/`close(Option<CloseFrame>)`;
  `Message::Text(Utf8Bytes)`). TLS: `rustls-tls-webpki-roots` feature (pinned roots, no OS
  dependency — static-binary friendly). Alternatives: `ws` (async), `tokio-tungstenite`
  (async — delay-complexity, rejected). Why: only maintained sync client; matches
  "no async runtime in v1".
- **serde 1.0.229** — MIT OR Apache-2.0; active (serde-rs). Derive for frames + config.
- **serde_json 1.0.151** — MIT OR Apache-2.0; active. Frame parse/print.
- **dirs 6.0.0** — MIT OR Apache-2.0; active (soc). `config_dir()` for
  `<OS-config-dir>/platform/config.toml`.
- **rpassword 7.5.4** — Apache-2.0; active (conradkleinespel). `prompt_password()` —
  no-echo token prompt (TTY only).
- **toml 1.1.4** — MIT OR Apache-2.0; active (toml-rs). Config read; unknown keys ignored
  via default struct (no deny_unknown_fields).
- **ctrlc 3.5.2** — MIT/Apache-2.0; active. `set_handler(|| …)` — SIGINT flag for watch.

No license conflicts (all MIT/Apache dual or Apache-2.0). No unsafe-critical crates added
beyond tungstenite's rustls stack (standard).

## Rollout

- Ships when BI[24] (websocket-adapter) is delivered — the CLI rides its wire; until then
  the crate builds/tests against unit mocks and the post-impl sim stands in for the wire.
- `scripts/precommit-rust.sh` is added to the root precommit at Phase 7 (wired early but
  skip-safe without cargo so the TS repo never blocks).
- No flips, no migration — new binary, new crate, additive.

## Risk Notes

- **Parallel session:** websocket-adapter IMPL is in flight in a sibling session — DO NOT
  touch `docs/features/websocket-adapter/` or `docs/wayfinder/websocket-adapter/`. Re-check
  wire constants (port 7300, frame shapes) from its PRD-TRD before Phase 7 smoke.
- **TLS:** rustls webpki-roots keeps static builds hermetic; if musl target is used,
  `dirs` needs `XDG_CONFIG_HOME` note for containers (test in smoke).
- **`path:` perms warning is a PRD-level refinement beyond Q3** (audit issue #4) — confirm
  during Phase 2 implementation; keep warn-only.
- **tungstenite `Message::Text` wraps `Utf8Bytes`** — `.as_str()` before JSON parse;
  binary frames (ping/pong) handled by the lib automatically.
- **Watch + stdout:** NDJSON events must flush per line (`writeln!` + `flush`) — scripts
  tail the stream.
