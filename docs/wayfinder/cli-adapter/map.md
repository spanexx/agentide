# cli-adapter — Wayfinder map

> **Map title:** cli-adapter — finding the way to a shipped `@platform/cli-adapter`
> (BI[23], Tier 3 entry points, **Rust binary**).
>
> **Status:** charting COMPLETE 2026-08-03 — all five tickets (Q1–Q5) closed;
> the full v1 shape is locked. Next step: feature-pipeline delivery run
> (GRILL → PRD-TRD → IMPL → implement → post-impl sim), per the T7
> (sdk-browser) / websocket-adapter precedent. The adapter (BI[24]) must ship
> first — `depts: [5, 24]`, the WS adapter is the only door.
> Live tracker: this map + the closed tickets under `tickets/`.

## Destination

`@platform/cli-adapter` shipped: a **single Rust static binary** (`platform`),
sitting at the terminal, talking to a **running self-hosted Gateway over the
websocket adapter** (BI[24], the only door — locked dashboard Q2/Q3 and
websocket-adapter map W1–W6). The binary translates typed Rust CLI commands
into the locked adapter wire envelope (`auth`/`invoke`/`invoke.result`/`invoke.error`/
`subscribe`/`event` per adapter W4) and prints the result. Read AND write
operations in v1 — the CLI is the admin's tool, and the capability layer
already authz-gates writes (no client-side guard rail needed).

`delivery: feature-pipeline` — this is a full pack (new crate, new contract tests,
new CI toolchain), not a small change, once the route is clear.

## Notes

- **Domain:** AI agent platform, self-hosted terminal client. Agentide §8
  Adapters: "translate protocols only, hold no state of their own." Terminology
  (Terminology.md:357-364) confirms.
- **Why Rust:** philosophy alignment — "Everything is Replaceable" +
  "Interfaces Are Forever." The kernel stays TS (boring). The adapter is a pure
  protocol translator at the edge. A static Rust binary is the right tool for a
  terminal client (no Node runtime, single file deploy). Sets precedent for
  BI[22] `platform-sdk-rust` — same wire, same serde structs, share a crate
  later (out of scope here).
- **Why not over MCP/REST:** the websocket adapter is the only door per
  dashboard Q2 lock and websocket-adapter map. A second client door on the same
  machine would be a backdoor — the lock is "one socket for both pull and push."
  The CLI is a *subscriber* of the WS adapter's pull (`invoke`); it can also
  `subscribe` for live output without inventing a new transport.
- **Why the existing `agentide` operator CLI is not this:** the operator CLI
  in `packages/agentide/src/cli.ts` (`agentide init|status|tenant|token|capability|plugin`)
  spins up the platform locally and tears it down per invocation. It is the
  bootstrap tool, not a client. The cli-adapter is a *client* of a running
  gateway — same role as the dashboard, different transport.
- **Sister packages (treat as reference, not source-of-truth):**
  - `@platform/adapter-mcp` (shipped) — port 7100, JSON-RPC 2.0, request/response.
    cli-adapter uses the WS adapter wire instead.
  - `@platform/sdk-node` (shipped) — WebSocket *client outbound*, connects to the
    backend-runtime port. Different role (registers handlers, doesn't call caps),
    but the auth handshake (`{type:"auth", token}` first frame) is the same shape
    the WS adapter expects.
  - `@platform/dashboard` (charted, not shipped) — same wire, browser-side.
    The WS adapter chart explicitly names "any client (CLI, Node service, browser
    app) can use `invoke` over the same socket" (`docs/wayfinder/websocket-adapter/
    tickets/adapter-scope-vs-mcp.md:176`). CLI was anticipated.
- **What the docs already say:**
  - Agentide §8 "CLI Adapter": `platform capabilities` / `platform sessions` /
    `platform browser` / `platform plugins` (curated examples, *not* a frozen list).
  - Platform_Capabilities.md §CLI: `plugin.install` / `plugin.list` /
    `gateway.status` ("not a customer-facing CLI command" in hosted deployments).
  - Both are READ+WRITE candidates in v1 — `plugin.install` is a write.
  - Backlog BI[23] desc is "CLI for terminal interactions" — thin.
  - Backlog BI[23] `depts: [5]` (gateway-core only) — **pre-dates the WS-adapter
    "only door" lock.** Updated in the Q1 resolution below to `[5, 24]`.
- **Out of scope this map:**
  - BI[22] `additional-backend-sdks` (incl. `platform-sdk-rust`) — same wire,
    *handler-registration* role; cli-adapter is a *consumer* of caps. Sharing a
    serde crate between them is future work, not v1.
  - MCP/REST adapters as doors for the CLI — locked out (only door = WS).
  - Interactive REPL / shell mode — single-shot commands + `--watch` flag is
    enough for v1.
  - Multi-tenant config UI / token issuance from the CLI — the user mints a
    token via the existing `agentide token issue` operator CLI (or any other
    means) and feeds it to the CLI adapter; cli-adapter consumes tokens, never
    mints.
- **Standing preferences:** Wayfinder default mode (plan, don't do). Self-hosted
  Gateway assumed for v1. Mirror websocket-adapter's standing preferences
  (no subprotocol versioning in v1; URL-versioned later). No second transport
  mechanism. Authentication: bearer JWT only (mirrors adapter-mcp).
- **Assumed already shipped:** gateway-core, capability-registry, event-bus,
  session-manager, plugin-manager, platform-capabilities, permission-tiering,
  adapter-mcp, websocket-adapter, sdk-node, backend-runtime. Map invalidates if
  any of these reopens a settled question that affects the choice below.
- **Truthfulness:** if a ticket resolution contradicts another open ticket or a
  decision already settled, update the map AND the affected tickets, not just
  the answer. Drift logs go in `docs/drift.md` per project standard.
- **Standing grill rule:** every locked Q appends to `docs/CONTEXT.md` Decisions
  Log + posts a progress comment on the ticket.

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom
the link for the detail the ticket holds -->

- [Q1 — Destination + transport + language + write scope](tickets/Q1-destination.md) —
  remote CLI binary client over the websocket adapter (only door, locked dashboard
  Q2/Q3); Rust static binary (philosophy "Everything is Replaceable" +
  "Interfaces Are Forever" — wire contract = the interface, language = replaceable);
  v1 includes reads AND writes (CLI is the admin's tool, capability layer
  authz-gates — no client-side guard rail); backlog `depts` updated `[5] → [5, 24]`.
- [Q2 — Command surface](tickets/Q2-command-surface.md) — one generic
  `platform invoke <capability> [--args ...] [--session <id>]` as the underlying
  shape; ergonomic subcommands `capabilities|sessions|plugins|status|health` as
  aliases for the common admin calls; no frozen list (capability layer = the
  surface). Wire key is `name` per adapter W4 (the `<capability>` positional
  maps onto it).
- [Q3 — Config/connection UX](tickets/Q3-config-ux.md) — precedence
  flag > env > config > prompt (TTY-only); TOML at `<OS-config-dir>/platform/
  config.toml` (`dirs` crate) with `gateway_url` + `token` only (unknown keys
  ignored — forward-compat); `path:/...` token indirection in ANY source;
  `0600` perms warn (not fail); NO hardcoded default URL in v1 (adapter port
  not locked yet — avoids racing the adapter's decision).
- [Q4 — Output/exit codes/watch](tickets/Q4-output-watch.md) — TTY-aware
  defaults: human tables for the 5 aliases, pretty JSON for `invoke`, compact
  JSON when piped, `--json` forces compact; exit codes 0–5 (0 result, 1 any
  `invoke.error`, 2 pre-flight/connection, 3 TLS, 4 `auth.error`, 5
  interrupted); `--watch` on the 5 aliases only (snapshot invoke + subscribe
  same socket, NDJSON events, default topic per alias, `--topic` override,
  dropped>0 warning per W6); NO reconnect in v1; `--stream` OUT of v1.
- [Q5 — Repo integration](tickets/Q5-repo-integration.md) — crate at
  `agentide/crates/cli-adapter/` (new top-level `crates/` dir, pnpm-safe);
  `scripts/precommit-rust.sh` (fmt+clippy+test, skip-with-warn if cargo
  missing) chained into `precommit` after build; no CI workflow in v1.

## Not yet specified

<!-- in-scope fog you can't ticket yet — graduates as the frontier advances -->

None — the v1 frontier is fully specified (Q1–Q5 closed). Items that were
listed here (connection/config UX → Q3, output/exit codes/watch → Q4,
CI/precommit → Q5) are all locked. Distribution (cargo install / Homebrew /
raw binary) remains deliberately out of v1 — tracked in `future.md`.

Future extension notes: default gateway URL once the adapter's port is
locked (Q3 resolution §7); watch reconnect if a real need shows up (Q4
resolution §5); GitHub Actions CI with the distribution decision (Q5
resolution §3). All three live in `future.md`.

## Out of scope

<!-- work consciously ruled out of this effort -->

- CLI as the door for in-process platform management (the existing
  `packages/agentide/src/cli.ts` operator CLI covers that, not in scope here).
- CLI token minting — the binary *consumes* tokens; minting stays in the
  existing operator CLI.
- BI[22] `platform-sdk-rust` — backend SDK (handler registration), different
  role. Same wire, different shape; serde struct sharing is future work.
- MCP/REST adapters as alternative CLI doors — locked out by the "only door"
  rule. A second door would be a backdoor.

## Tickets

All ticket files live under `tickets/`. Open tickets are not listed here —
they are open child issues, found by query. Closed tickets get appended to
**Decisions so far** above.