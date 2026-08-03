# cli-adapter — Future Work

Notes for future sessions that pick up the cli-adapter map.

## In-scope (the destination's natural extensions — not yet implemented)

- **`platform install <plugin-id>` alias** — `plugin.install` is a write, needs
  careful UX (confirmation prompt, progress events, rollback hint). Add as an
  alias when the use case is well-understood. Pre-req: confirm-or-default flow
  decision (separate ticket).
- **`platform watch <topic-pattern>` standalone command** — today `--watch` is
  a flag on the five aliases. A standalone `watch` command (subscribe without
  a preceding snapshot) is a natural extension. Pre-req: Q4 locked (done —
  2026-08-03).
- **Multi-tenant config profiles** — one config file may carry several named
  profiles (`default`, `staging`, `prod`); `platform --profile staging …`
  switches. Useful when an operator runs against several gateways. Pre-req:
  Q3 file-format decision (TOML nested tables already support this; v1
  schema ignores unknown keys, so `[profiles]` tables can be added without
  breaking v1 binaries).
- **Shell completions** — `platform completions bash|zsh|fish|powershell` —
  derived from the alias table. Trivial to add once the parser is stable.
- **Distribution** — `cargo install platform-cli`, Homebrew tap, raw binary
  download, Docker image with the binary. All out of scope for v1 but worth
  noting so the first release isn't an afterthought.

- **Default gateway URL** — Q3 locked NO hardcoded default URL in v1 (the
  adapter's port wasn't locked at chart time). Revisit when the adapter
  ships with a locked default port; a `127.0.0.1:<port>/ws` default would
  remove the most common config need. (Q3 resolution §7.)
- **Watch reconnect** — Q4 locked no auto-reconnect in v1 (drop → exit 2;
  short-lived admin command). If operators report pain re-running watch,
  add backoff reconnect mirroring the dashboard's 1→30s ±20% jitter
  pattern. (Q4 resolution §5.)
- **GitHub Actions CI** — Q5 locked no CI workflow in v1 (repo status quo;
  precommit is the gate). A workflow running `precommit-rust.sh` + artifact
  publishing lands with the distribution decision. (Q5 resolution §3.)

## Cross-map coordination notes

- **websocket-adapter (BI[24])** — the WS adapter is the *only* door per
  dashboard Q2 lock and websocket-adapter map. The CLI rides its wire
  envelope verbatim. If the adapter chart reopens a wire-shape question,
  update this map's Q3/Q4 and the adapter ticket in lockstep.
- **dashboard-core (BI[13])** — same wire, browser-side. The dashboard and
  the CLI share the same `invoke` + `subscribe` shapes. Any change to
  `invoke.result`/`invoke.error`/`event` envelope keys (locked adapter W4)
  affects both. CLI tests can use the same fixtures as the dashboard's
  pre-impl sim (read from `data/sim-state.json`).
- **sdk-rust (BI[22], not yet built)** — same wire, opposite role (handler
  registration, not cap invocation). When sdk-rust ships, the two crates
  share serde structs for the envelope — and `crates/` is now the shared
  home (Q5 lock; cli-adapter crate sits there, sdk-rust joins it). Out of
  v1 scope here.
- **adapter-mcp (shipped)** — the MCP adapter is the *other* door for LLM
  agents. The CLI is for humans. They never overlap on the same socket;
  this map never touches MCP wire.
- **Drift D-50** (origin-claim mint side missing) — irrelevant for the
  CLI (no `Origin` header). A CLI token omits `expectedOrigins`
  regardless. No action needed; note for posterity.

## Loose lock reference (for the implementation session)

When `feature-pipeline cli-adapter` runs, it reads these in order:
1. `docs/wayfinder/cli-adapter/map.md` — destination + decisions so far.
2. `tickets/Q1-destination.md` … `Q5-repo-integration.md` — ALL LOCKED
   (2026-08-03, autonomous under user delegation).
4. `docs/wayfinder/websocket-adapter/` — the wire envelope + auth handshake
   the CLI rides (locked).
5. `PHILOSOPHY.md` — "Everything is Replaceable," "Interfaces Are
   Forever," "kernel stays boring."
6. `docs/CONTEXT.md` Decisions Log — confirm no parallel-session lock
   contradicts what's above.

Implementation reuses the websocket-adapter charted wire verbatim — no
re-grilling on adapter-shape questions. Any apparent conflict surfaces as a
drift entry; resolve there, not by re-opening this map.