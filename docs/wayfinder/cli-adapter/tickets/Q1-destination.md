# Q1 — Destination, transport, language, write scope

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (2026-08-03; Q1 locked — destination, transport,
language, write scope, deps)
**Blocks:** Q2 (command surface), Q3 (config UX), Q4 (output + watch) —
all unblocked

## Question

What *is* the cli-adapter — a separate surface from the existing `agentide`
operator CLI — and where does it sit in the platform's adapter hierarchy? Four
sub-questions, each a decision the map waits on:

1. **Transport:** remote client over an existing adapter, or in-process like
   the operator CLI? If remote, over which door (WS adapter is locked as the
   only door)?
2. **Language:** TypeScript (keep the monorepo), Rust (single static binary),
   or another edge language?
3. **Read scope:** read-only explorer (delayed complexity), or include writes
   in v1 (CLI is the admin's tool)?
4. **Backlog deps:** the charted `depts: [5]` pre-dates the "only door" lock —
   does it change to `[5, 24]`?

## What I know

- Backlog BI[23] desc is "CLI for terminal interactions," `depts: [5]`,
  priority p2, status not-started. Source: Agentide → Section 8.
- Agentide §8 lists CLI Adapter under Adapters, paired with MCP / REST / WebSocket.
  Adapters contain no business logic (Terminology.md:357-364). §8 example
  commands: `platform capabilities`, `platform sessions`, `platform browser`,
  `platform plugins`.
- Platform_Capabilities.md §CLI (line 595-609) lists `plugin.install`,
  `plugin.list`, `gateway.status` — admin tooling; "not a customer-facing CLI
  command" in hosted deployments.
- The existing `agentide` operator CLI in `packages/agentide/src/cli.ts`
  (`agentide init|status|tenant|token|capability|plugin`) is per-invocation
  in-process: spins up the platform locally, operates, tears down. Bootstrap
  tool, not a client.
- Dashboard map locked `Q2` (only door = websocket adapter — no HTTP data API)
  and `Q3` (chart now, execute after adapter ships). Dashboard map also locked
  the same wire envelope for any client: "any client (CLI, Node service,
  browser app) can use `invoke` over the same socket as `subscribe` + `event`"
  (`docs/wayfinder/websocket-adapter/tickets/adapter-scope-vs-mcp.md:176`).
- The websocket-adapter's auth ticket explicitly anticipates CLI: "Node
  service clients, CLIs, curl — unaffected" by origin binding
  (`auth-handshake.md:351`). A CLI does not send `Origin`, so origin
  enforcement is irrelevant.
- PHILOSOPHY.md: "Everything is Replaceable" + "Interfaces Are Forever."
  Kernel = boring (TS). Edge = replaceable. Adapters = protocol translators,
  no business logic.
- BI[22] `additional-backend-sdks` lists `platform-sdk-rust` as one of five
  planned languages (shipped sdk-node is the reference). Multi-language edge
  is an accepted platform direction.
- Drift D-50 (origin-claim mint side missing): irrelevant for the CLI — a CLI
  never sends `Origin`, so a CLI token omits `expectedOrigins` regardless. No
  blocker.

## Sub-questions

1. Transport: remote client over websocket adapter, OR in-process tool?
2. Language: Rust static binary, OR TypeScript in the existing monorepo?
3. Write scope: read-only v1, OR include writes in v1?
4. Backlog `depts`: `[5]` only, OR `[5, 24]` (adds websocket-adapter)?

## Resolution must record

Each of the four answers with a `why`, plus any in-scope consequences (backlog
edit, CONTEXT.md Decisions Log entry, drift if any). Resolution comment goes
on this ticket; answers gist on the map's **Decisions so far**; closed.

## Resolution (locked 2026-08-03, autonomous under user delegation)

1. **Transport = remote client over websocket adapter.** The websocket adapter
   is the only door (locked dashboard Q2/Q3 and websocket-adapter map W1–W6).
   A remote CLI client connects inbound, sends `auth` then `invoke` (and
   optionally `subscribe` for `--watch`). Reuses the same wire envelope the
   dashboard will use — no new protocol, no backdoor. The existing `agentide`
   operator CLI (in-process bootstrap) stays separate: different role.

2. **Language = Rust.** Static binary, single file, no Node runtime — right
   tool for a terminal client. Aligns with PHILOSOPHY "Everything is
   Replaceable" + "Interfaces Are Forever": the *wire contract* is the
   interface, the language is replaceable. Kernel stays TS/boring; adapter is
   pure protocol translator at the edge. Sets precedent for BI[22]
   `platform-sdk-rust` (same wire, share a serde crate later — out of v1).

3. **Write scope = reads AND writes in v1.** The CLI is the admin's tool per
   both doc sources (§8 developer + Platform_Capabilities.md admin). The
   capability layer already authz-gates writes — no client-side guard rail
   needed. The dashboard v1 being read-only is a dashboard decision (visible
   snapshots) not a CLI decision (admin actions). Platform_Capabilities.md's
   `plugin.install` example IS a write — supporting only reads would cut the
   spec's own example.

4. **Backlog `depts` = `[5, 24]`** (gateway-core + websocket-adapter).
   websocket-adapter is the only door; cli-adapter cannot ship without it.
   Edited in `scripts/backlog/cli-adapter.js:6` in this resolution.

## Consequences (in this resolution)

- Backlog edit: `scripts/backlog/cli-adapter.js` `depts: [5] → [5, 24]`.
- CONTEXT.md Decisions Log: new entry under today's date.
- `feature_backlog_data.js` BI[23] desc amended to reflect the locked
  destination.
- Drift: none new (origin-binding irrelevant for CLI).
- Future roadmap notes appended to `future.md` (sdk-rust crate sharing, etc.).

`delivery: feature-pipeline` — full pack, not small-change. Tagged on the map's
**Destination** section, not on this ticket (per skill convention).