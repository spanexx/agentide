# W1 — Adapter scope vs MCP: same `tools/call` shape, plus subscriptions?

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (locked 2026-08-03; sub-Qs 1–4 all resolved)
**Blocks:** W2 (auth handshake), W3 (subscription model)

## Question

What does the WebSocket adapter do that `adapter-mcp` doesn't already do — and
what does it *not* duplicate?

The shape question matters because if the WebSocket adapter re-implements MCP's
`tools/call` shape, then `translate.ts` is mostly a copy; if it diverges (e.g. to
support streaming partial results, or a `tools/batch` array, or a different error
envelope), then we're committing to a parallel surface.

## What I know

- `adapter-mcp` exposes `tools/list` + `tools/call` (JSON-RPC 2.0). `callTool` in
  `packages/adapter-mcp/src/translate.ts` returns a single `CallToolResult` per call
  (`IMPL-mcp-adapter.md` Phase 2).
- The kernel `Gateway.handleInvocation()` is the canonical entry for both adapters —
  it returns a single value. Streaming is not a kernel concept today.
- `event-bus.publish(...)` is the only server-push primitive in the codebase today.
  `subscribe(topic, handler)` returns a `Subscription` handle. Topics are dot-namespaced
  strings (`browser.page.loaded`, `sdk.invoke.completed`, `session.destroyed`,
  etc.). Prefix wildcards exist (`packages/event-bus/src/match.ts`).
- The WebSocket adapter's *unique* value is push. Pull (i.e., `tools/call` over
  WebSocket) is redundant with MCP and the user can simply choose MCP. So we should
  decide whether pull-on-WS is even supported in v1.

## Sub-questions

1. **Pull parity:** does the WS adapter support `tools/call` requests at all, or is it
   push-only (subscribe + emit)? If pull is supported, does it mirror MCP's JSON-RPC
   shape exactly, or do we use a simpler envelope?
2. **Streaming partial results:** if a capability handler wants to stream progress, is
   the WS adapter the place to add that capability, or do we leave it for a future
   `invoke.stream` ticket? (`handleInvocation` is single-shot today; would need a
   kernel seam change to support streaming.)
3. **Topic subscription:** is `subscribe` a top-level message (e.g. `{type:"subscribe",
   topics:["browser.*"]}`), or is it inferred from the initial handshake (`subscribe
   in auth frame`), or is it a separate REST endpoint the client hits before opening
   the WS?
4. **Compatibility with MCP clients:** if a user wants to switch from MCP to WS,
   should the WS adapter accept the same JSON-RPC envelope so existing clients work
   unchanged? (My instinct: no — MCP clients are tool-shaped; WS clients are
   stream-shaped. Forcing one onto the other corrupts both.)

## Resolution must record

- whether v1 supports pull (`tools/call`) over WS, and what shape;
- the answer to the streaming question (in scope or future ticket);
- the subscription shape (top-level message, handshake, or pre-handshake);
- any decisions about MCP-shape compatibility (yes/no, partial, or N/A).

## Progress

**2026-08-03 — Claimed + pre-grill review (this session).** Re-read
`packages/adapter-mcp/src/{index,types,translate,error-map}.ts` and
`docs/features/mcp-adapter/IMPL-mcp-adapter.md` to ground what MCP already covers.
The MCP adapter is request/response only: `tools/list` + `tools/call`, no push
channel, no streaming, no client-side subscriptions. `callTool` returns a single
`CallToolResult` per call. `event-bus.subscribe(...)` exists as a kernel primitive
but no current adapter exposes it to clients. So W1's question is *real* —
nothing in MCP's shape gives us push, and adding it to MCP would corrupt MCP.
The natural answer is: WS adapter is push-first; pull parity is a separate call.

Starting grilling below.

## Locked so far

**2026-08-03 — Sub-Q 1 locked: push-only in v1; pull demanded for a future run.**

The WebSocket adapter is **push-only in v1** — no `tools/call` pull over WS, no
JSON-RPC envelope on the socket. MCP remains the standing pull door (its 38 tests
and working factory cover that surface; duplicating it on WS buys nothing).

Pull over WS is **demanded, not deferred-optional**, for a future run — recorded in
`future.md` in this wayfinder directory (triggers: WS-only deployment without MCP;
clients needing pull + push on a single socket). The pull shape (JSON-RPC mirror vs
WS-native envelope) is explicitly NOT locked there and must be grilled in that run.

Trade-off accepted: v1 clients wanting both open two sockets (MCP for pull, WS for
push). Extra TCP handshake per agent — negligible.

Source: W1 ticket sub-Q 1; user lock "ok for now the websocket should be push only
but create a future.md in the websocket adapter that demands for pull also in a
future run"; `docs/wayfinder/websocket-adapter/future.md`.

**2026-08-03 — Sub-Q 2 locked: streaming in v1 (Reading A — adapter-level).**

The WS adapter **streams capability-handler progress to subscribed clients in v1** —
but the streaming lives in the adapter, not the kernel. `Gateway.handleInvocation()`
stays single-shot per gateway-core Q11 lock. The adapter translates: when a subscribed
client invokes a capability (see sub-Q 1 future-pull contract) with `mode: "stream"`,
the adapter packages the kernel's single result into partial frames as the handler
emits progress events (e.g. via `event-bus.publish` under a per-call topic). For
`mode: "call"` it returns one frame. MCP stays single-shot — its callers use the
existing sync contract and never see streaming.

Why adapter-side, not kernel-side: kernel streaming is a much bigger change (touches
Q11, requires a new seam in `handleInvocation`, breaks MCP's existing request/response
contract). Adapter-side gets the operator-visible benefit ("live progress on the
dashboard") without the kernel churn.

Source: W1 ticket sub-Q 2; user lock "no!! this part we do in v1, not future" + "ok
for now A"; `future.md` updated to record kernel-level streaming seam as the future
promotion path if a future run wants platform-native streaming.

Still open: sub-Q 3 (subscription shape), sub-Q 4 (MCP-shape compat).

**2026-08-03 — Sub-Q 3 locked: subscription = top-level message on the socket.**

Subscription is a **top-level message** on the WS — `{type: "subscribe", topics: [...]}` /
`{type: "unsubscribe", topics: [...]}`. Not inferred from the auth handshake (would
prevent dynamic add/drop after open). Not a pre-handshake REST endpoint (extra
round-trip per subscribe, two protocols to coordinate).

Dynamic over the life of one socket: open → auth → subscribe `["session.*",
"capability.*"]` → add `["session.evt-123.*"]` later → drop `["session.*"]` later.
Subscriptions are topic-set operations, not connection-level config. The wire schema
(W4) needs a `type` discriminator — already implied by the message-shape
recommendation.

Source: W1 ticket sub-Q 3; user lock "agreed top-level message".

Still open: sub-Q 4 (MCP-shape compat).

**2026-08-03 — Sub-Q 4 locked: WS envelope deliberately differs from MCP.**

WS adapter uses its **own envelope** with a `type` discriminator (`subscribe`,
`unsubscribe`, `event`, `auth`, `auth.ok`, `error`, `pong`, ...). It does **not**
mirror MCP's JSON-RPC shape — MCP clients speak request/response; WS clients speak
subscribe + event-stream; forcing one envelope onto the other corrupts both products.

Different clients, different doors. An LLM agent uses MCP for capability invocations
(its job). A dashboard uses WS for live events (its job). Same platform, two doors,
two envelopes. An MCP client cannot "just" repoint at the WS port — correct, because
they are different products.

This locks the W4 wire-message schema ticket: it does NOT carry JSON-RPC. It carries
a flat `{type, ...}` message shape keyed by `type`.

Source: W1 ticket sub-Q 4; user lock "agreed **different envelopes**".

---

**W1 — Re-opened 2026-08-03 (same session).**

Sub-Q 1 flipped: v1 is **no longer push-only**. Reason: `dashboard-core` BI[13]
is a concrete v1 consumer that needs `capability.list` / `plugin.list` /
`session.list` / `system.health` / `gateway.metrics` over a single socket. The
"pull in future" defer was based on "no demonstrated need". The dashboard IS
that need.

**Sub-Q 1 RE-locked (2026-08-03): WS adapter supports pull in v1, with a
WS-native envelope.**

Wire messages:
- request: `{type: "invoke", correlationId, name, input, sessionId?, mode: "call" | "stream"}`
- reply (single): `{type: "invoke.result", correlationId, output}`
- reply (error): `{type: "invoke.error", correlationId, code, message, details?}`
- reply (stream end): `{type: "invoke.end", correlationId}` for `mode: "stream"`
- partial: `{type: "invoke.partial", correlationId, output}` for `mode: "stream"`
  (per W1 sub-Q 2 adapter-level streaming — adapter packages partial progress
  events into these frames without kernel change)

Env: WS-native only. NOT JSON-RPC (W1 sub-Q 4 un-changed: WS envelope differs
from MCP by design). Every WS adapter message is a member of the
`{type: ...}` discriminator family. `invoke` / `invoke.result` / `invoke.error`
/ `invoke.partial` / `invoke.end` join the existing `subscribe` /
`unsubscribe` / `event` / `auth` / `auth.ok` / `error` / `pong` set.

Scope: pull is **available to every WS adapter v1 client**. No scoped opt-in.
Dashboard is the driver, but any client (CLI, Node service, browser app) can
use `invoke` over the same socket as `subscribe` + `event`. No scoped URL
patterns, no per-connection feature flags.

MCP remains the canonical pull door for LLM agents (those clients want
JSON-RPC; non-LLM clients don't). The WS adapter's pull is for non-LLM
clients that want one socket for both. Different doors, different audiences.

Concurrency: client-side opaque `correlationId` (string the client generates,
the server echoes verbatim on every reply frame). Multiple invokes in flight
on one socket — replies may arrive in any order, sorted by correlationId.
Socket-level ordering: frames do NOT have to interleave in any specific order;
the client demuxes by correlationId.

Session: `sessionId` carried in the invoke request (per CONTEXT.md canonical
packet — required for non-session-management caps, optional for read-only
discovery). Sessions are managed via `session.create` / `session.destroy`
invoices, same as MCP.

Streaming: `mode: "stream"` invokes deliver `invoke.partial` frames as
progress events fire on the per-call topic, then `invoke.end` on completion
or `invoke.error` on failure. `mode: "call"` delivers exactly one
`invoke.result` or `invoke.error`. Same contract as W1 sub-Q 2; pull-in-v1
just makes the contract reachable.

Why this is the right shape (rather than JSON-RPC mirror or scoped opt-in):
- W1 sub-Q 4 already locked "WS envelope ≠ JSON-RPC". The envelope is
  already `{type: ...}` keyed. Adding `invoke` to the discriminator is one
  schema row.
- A dashboard that opens one socket and uses it for everything (auth,
  subscribe, event, invoke) is dramatically simpler than the alternative
  ("dashboard opens WS for events, opens MCP for invocations" — two
  sockets, two auth flows, two auth tokens, two audit trails).
- Scoped opt-in (pull-enabled only for some connection paths) means two
  server code paths, two sets of tests, two attack surfaces. The single
  shape is the cheaper design even if today's only consumer is dashboard.

User lock: "no i dont want scopped" — confirming pull is universal, not
screened-by-URL. Web-searched before this lock: the W1 sub-Q 1 future
references in `future.md`, `map.md` decision log, and `CONTEXT.md` decision
log are now updated to reflect this re-open.

Future `.md` is rewritten: the only future-shape item is the
kernel-level streaming seam (promotion path if a future run wants
platform-native streaming) and the `invoke.batch` (multi-invoke-in-one-message)
demand. Pull-in-v1 is no longer a future.

**Risk flags for the re-open:**
- Streaming `mode: "stream"` + invoke in v1 means W4 (wire schema) MUST lock
  the five `invoke*` envelope variants and the correlationId contract (no
  surprise, W4 was going to lock the envelope anyway).
- Adapter-level streaming along with pull means the adapter has to handle
  per-connection outbound queueing (cross-cuts W6 backpressure ticket).
- Server-side fan-out (W5) becomes dual-purpose: fan-out event-bus
  subscriptions AND per-call partial-progress topics. The W5 resolution
  still applies (per-connection outbound queue, `validatePattern`, etc.);
  the only delta is that the adapter may publish its own per-call topics
  during an invoke.