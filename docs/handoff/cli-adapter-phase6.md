# Handoff — cli-adapter Phase 6 closeout

**Date:** 2026-08-03 · **Branch:** `feature/cli-adapter` (worktree `.worktrees/cli-adapter/`)
**HEAD:** `3aebf00` (after `71b5c8b` Phase 6 watch, `1783e01`/`c30b899` audits, `348deb8` Phase 5)

## State: DONE except Phase 7 (blocked)

- Phases 1–6 SHIPPED. 51/51 tests green, precommit hooks green (npm typecheck/lint/build + `precommit-rust.sh`).
- Post-impl sim `docs/features/cli-adapter/simulate.sh` — 11/11 PRD Simulation Contract scenarios PASS against the locked W4 mock. Writes `docs/features/cli-adapter/sim-state.json`.
- Sub-agent review (feature-pipeline-review) done; 3 accepted drifts logged: **D-59** (mock vs BI[24] adapter — backend swap is `--url`/`--token` only), **D-60** (TLS exit-3 path via TCP probe until real cert), **D-61** (mock `publishedAt` placeholders). All in `docs/drift.md`.
- Reconcile done: `simulate-pre.html` → `docs/features/cli-adapter/archive/`; `simulate.sh` is canonical.

## Environment

- **Worktree:** `/home/spanexx/Shared/Learn/Agent-Bridge-SDK/.worktrees/cli-adapter/` — git root = worktree; cargo from `crates/cli-adapter/`.
- **Main checkout** `agentide/` is owned by a parallel ws-adapter session — NEVER touch.
- **Binary:** `crates/cli-adapter/target/debug/platform`; **mock:** `crates/cli-adapter/target/debug/examples/mock_wire` on `ws://127.0.0.1:7300/ws` — currently RUNNING (restart: `cargo build --example mock_wire && pkill -x mock_wire; nohup ./target/debug/examples/mock_wire > /tmp/mock_wire.log 2>&1 &`).
- **Precommit:** `bash scripts/precommit-rust.sh` from worktree root; commit hook auto-runs npm precommit + rust checks.
- Pinned deps: tungstenite 0.30.0 (rustls-tls-webpki-roots), rustls `=0.23.43` (ring), serde/serde_json, dirs 6, rpassword 7.5.4, toml 1.1.4, ctrlc 3.5.2 (`termination` — SIGTERM → flag → exit 5).

## Key wire/exit facts (locked W4)

- C→S `auth` / `invoke{correlationId,name,input?,sessionId?,mode:"call"}` / `subscribe` / `unsubscribe`; S→C `auth.ok`, `auth.error`→close 1008, `subscribe.ok{topics}`, `subscribe.error`, `event{topic,id,publishedAt,payload}`, `invoke.result{correlationId,output}` (KEY IS `output`), `invoke.error{correlationId,code,message}`, `stats{dropped}`, `error{code,message}`.
- Exit codes: 0 result · 1 invoke.error · 2 pre-flight (usage/config/connect/subscribe.error/watch-drop/`--watch` on invoke) · 3 TLS-layer only · 4 auth.error/close 1008 · 5 interrupted.
- Watch topics: sessions→`session.*`, plugins→`plugin.*`, capabilities→`capability.*`, status/health→`gateway.*` (NOT `system.*`); `--topic` overrides; `--watch --json` = pure JSON stream; stats dropped>0 → one stderr warn; no reconnect v1.

## Source shape (AGENTS.md rule 9 — all <350 lines)

- `src/main.rs` 349 (main-001..004), `src/client.rs` 349 (client-001..007), `src/watch.rs` 163 (watch-001..004), `config.rs` 242, `output.rs` 193, `usage.rs` 50, `errors.rs` 40.
- Tests: `tests/main.rs`-style 6 unit in main.rs + `tests/client.rs` 13 + `tests/config.rs` 14 + `tests/output.rs` 11 + `tests/watch.rs` 7 + shared `tests/common/mod.rs` scripted MockServer.
- MockServer gotchas: `spawn_with_tail` drains only when tail non-empty (else join() deadlocks); tests MUST `drop(client)` before `server.join()` when tail non-empty. Stop-counter polled BEFORE each read (to read N events, closure returns true on poll N+1).

## e2e gotchas (documented for Phase 7)

- Mock sends `subscribe.ok` FIRST then events — client gates on the ack and discards pre-ok frames.
- SIGTERM/EINTR: `read_raw_frame` treats `WouldBlock|TimedOut|Interrupted` as transient Ok(None) so the stop flag wins → exit 5.
- Sim watch scenarios need `kill -INT` after ~1–2s (a 1s race earlier gave 143 — signal before flag install).

## Backlog / next work

- **Phase 7 (integration + wiring)** blocked on **BI[24] websocket-adapter** ("the only door"). When it ships: point `simulate.sh` at the real gateway (`--url ws://127.0.0.1:7100/ws` + real token), rerun — contract commands unchanged. Then finish IMPL Phase 7 verify boxes (precommit chain + full demo vs live adapter).
- **Backlog update not yet committed** for Phase 6 SHIPPED (worktree has no `scripts/backlog/` — that lives in the main checkout; do it from the main repo workflow, it's out of scope here).
- `docs/features/cli-adapter/IMPL-cli-adapter.md` Status: "Phases 1-6 SHIPPED · Phase 7 BLOCKED on BI[24]".

## Left running

- `mock_wire` pid ~1251496 on 7300 (log `/tmp/mock_wire.log`). Harmless to kill.
- No stray `platform` processes.
