# A10 — Research: how mature systems model "one request → many results over time"

**Ticket:** [A10](../tickets/A10-research-streaming-patterns.md) (research, feeds [A4 — response strategy seam](../tickets/A4-response-strategy-seam.md))
**Date:** 2026-08-07
**Status:** delivered for A4 grilling

## What this survey is for

The Agentide kernel is single-shot: `gateway.handleInvocation` returns one
`CanonicalResponse`. Today each Adapter decides how to present that one result:

- **WebSocket** synthesizes `invoke.partial` + `invoke.end` frames around the single
  result (`adapter-websocket/src/invoke.ts:56`) and supports long-lived
  `subscribe`/`event`.
- **MCP** returns one `CallToolResult` (a timeout becomes an `isError` result).

A4 must design one shared seam (in the new `@spanexx/adapter-core`) that expresses all
three shapes — single reply, stream packaging, subscription — and stays additive when
the kernel gains real streaming (browser-runtime era).

This document surveys how five mature systems draw that boundary. Per target:
mechanism, strengths, weaknesses *for the Agentide case*, and one takeaway. A single
recommendation paragraph for the A4 grilling sits at the end.

---

## 1. MCP — streamable HTTP / SSE (tool-call framing)

### Mechanism

The Model Context Protocol (spec 2025-06-18) uses JSON-RPC 2.0 message envelopes over a
transport. The older transport (2024-11-05) split channels: client POSTs to
`/messages`, server pushes over a `GET /sse` stream. The current **streamable HTTP**
transport unifies this: one POST endpoint; the server answers either a single JSON body
(one JSON-RPC response) or a `text/event-stream` stream; the client *may* open a GET SSE
stream for server-initiated messages. Sessions are carried by an `MCP-Session-Id`
header; `ping` keeps the channel alive.

Crucially, streaming in MCP is mostly a *transport* feature. A tool call's semantic
result is still **one** `CallToolResult` containing a `content` array (text / image /
resource parts). "Many results over time" is expressed through side channels, not
result chunks:

- **Progress notifications** — the server emits `notifications/progress` with a
  `progressToken` the client supplied in the request's `_meta`. Progress is a
  side-note; the final `CallToolResult` still arrives once.
- **Log notifications** — `notifications/message` for unstructured server chatter.
- Community extensions for genuinely streamed tool *output* (e.g. "streamable tool
  calls") exist but are not in the current spec.

### Strengths for Agentide

- Shows a clean split: **the result is one object; everything else is a side-channel
  notification**. MCP kept its tool-call contract stable while adding transport
  streaming — the same additive posture A4 wants for the kernel.
- The `progressToken` pattern is a template for "progress without changing the result
  shape" if Adapters ever need it.
- Streamable HTTP's "single response OR streamed response from one endpoint" is the
  same either/or the seam must express.

### Weaknesses for Agentide

- MCP has no native "N result chunks for one call" — `CallToolResult` is a closed
  shape. An Agentide stream mapped to MCP must *merge* chunks into one content array
  (that is adapter-side packaging, exactly today's MCP behavior).
- Its progress model is advisory; there is no ordering guarantee between progress and
  the final result, and no terminal concept beyond the result itself.

### Takeaway

MCP's answer to "many results" is **notifications beside the result**, not chunks
instead of it. The seam should treat a stream as *N result chunks + a terminal* and let
the MCP Adapter merge chunks into one `CallToolResult` — the Adapter stays the only
place that knows the protocol's closed shapes.

---

## 2. LSP — request / notification / event over one channel

### Mechanism

The Language Server Protocol (3.17) is JSON-RPC 2.0 over one channel (stdio, socket,
or WebSocket). Three message kinds share the channel:

- **Request** — `{ id, method, params }`, expects a matching `Response` (`result` or
  `error`) with the same `id`.
- **Notification** — `{ method, params }`, no `id`, no response expected, fire and
  forget.
- **Response** — correlated to a request by `id`.

Server-pushed information rides notifications: `textDocument/publishDiagnostics` (lint
results streamed as they appear), `window/logMessage`, `window/showMessage`. Progress
for long work uses `$/progress` with a `workDoneToken` (client asks via
`window/workDoneProgress/create`), and large results can arrive in partials via a
`partialResultToken`. Method namespaces encode ownership: `textDocument/*`,
`workspace/*`, `window/*`, and `$/*` for protocol-internal messages. The channel is
bidirectional — the server can also send *requests* to the client
(`client/registerCapability`, `workspace/applyEdit`).

### Strengths for Agentide

- **The request/notification/response triad is the whole model.** Agentide's W1–W6
  frames already map onto it: `invoke` → request, `invoke.result`/`invoke.error` →
  response, `event` → notification, `stats` → notification. LSP proves one channel can
  carry all three without confusion as long as correlation (the `id`) is strict.
- Protocol-internal namespaces (`$/progress`) show how to add cross-cutting frames
  without colliding with user-facing ones — a precedent if the seam ever needs
  protocol-level frames beside capability results.
- Notifications as the event mechanism validates WS's existing `event` frame: no id,
  no reply, one-way push.

### Weaknesses for Agentide

- LSP has **no streamed response to a single request** either — partial results are
  optional progressive hints; the final full response still arrives. Semantic streaming
  is not an LSP primitive.
- Its progress machinery (`workDoneToken`/`partialResultToken` handshake) is heavy —
  worth copying only as an idea, not as a shape.

### Takeaway

LSP's lesson is **discipline, not machinery**: one channel, three message kinds, strict
`id` correlation, notifications for events. Agentide's seam needs nothing more than
that to express single reply (one response), stream packaging (one id, N partials, one
end), and subscription (subscribe request → event notifications).

---

## 3. gRPC — server-streaming vs unary

### Mechanism

gRPC defines four RPC kinds in the `.proto` contract itself: **unary** (one request,
one response), **server-streaming** (one request, N responses), client-streaming, and
bidi-streaming. The streaming mode is part of the method signature — a caller knows
from the interface whether a call is unary or streaming, not from runtime behavior.

A server-streaming call: the client sends one message; the server sends any number of
messages; the call terminates with a **status** (OK or error code) delivered once at
the end (in HTTP/2 trailers). Errors are terminal — a mid-stream failure ends the
stream; there is no "error + more data". Generated client APIs surface the stream as an
async iterable / observer object with `data` / `end` / `error` events. Timeouts and
deadlines apply to the whole call. HTTP/2 flow control gives real backpressure, and
concurrent calls are multiplexed over one connection.

### Strengths for Agentide

- **Unary is a stream of exactly one message.** gRPC does not need separate machinery
  for the two shapes — the single-reply case is the streaming case with one element.
  This is the cleanest existing proof that one seam can express both, and that a future
  streaming kernel needs no new interface: a single-shot result is "emit once, then
  end".
- The **terminal is part of the contract**: every stream ends in success or error, and
  error is delivered exactly once. That maps directly to the seam needing an explicit
  `end(result)` / `end(error)` and to Gateway's `GatewayErrorPayload` being a terminal,
  not a chunk.
- Declaring the mode on the method (not at runtime) is a strong precedent for
  "the seam declares single / stream / subscribe per invocation".

### Weaknesses for Agentide

- gRPC's ordering/backpressure guarantees come from HTTP/2 — Agentide's WebSocket
  Adapter must provide its own (it already does: `queue.ts`, `fanout.ts`, the 1 MiB
  FIFO, `stats` frames). The seam cannot promise gRPC-grade flow control on a WS wire.
- Streaming-mode-in-signature is rigid: a method is *declared* streaming. Agentide's
  seam needs the softer version — one interface that *may* emit 1..N chunks — because
  the kernel's future behavior is unknown today.

### Takeaway

gRPC is the strongest evidence for the seam's core shape: **a call returns a producer
of messages with a single terminal**, and single-reply is the stream of length one.
That makes the kernel's eventual streaming purely additive — today the pipeline emits
one chunk and ends; later it emits more.

---

## 4. JSON-RPC 2.0 — batch and notification conventions

### Mechanism

JSON-RPC 2.0 (2010, stable) defines the envelope: `{ "jsonrpc": "2.0", "id", "method",
"params" }` for requests, `{ "jsonrpc": "2.0", "id", "result" | "error" }` for
responses, where the response `id` must equal the request's. Two conventions matter
here:

- **Notifications** — a request *without* an `id`. The server must not reply. This is
  the canonical "fire and forget" — events and logs ride this shape.
- **Batch** — an array of requests in one message. The server replies with an array of
  responses (which may come back in any order, correlated by `id`). A batch of only
  notifications gets no reply at all.
- **Errors** — fixed object (`code`, `message`, `data`), reserved codes
  `-32700..-32099` (parse error, invalid request, method not found, invalid params,
  internal error), `-32000..-32099` free for implementation use.

### Strengths for Agentide

- **Correlation by `id` is the only glue streaming needs.** A streamed call can reuse
  one `id` for all its chunks (WS already does this with `invoke.partial` carrying the
  invoke's id) — JSON-RPC says nothing against it because streaming is out of its
  scope; nothing in the spec *breaks* the pattern.
- Notification semantics justify `event` frames needing no ack — a subscribe client
  never replies per event.
- The reserved error-code range is the natural home for shared Gateway error codes
  (`GATEWAY_*`) if adapters ever need to map errors onto a JSON-RPC-ish envelope.
- Batch is a proven answer for "many small calls over one round trip" — worth keeping
  in mind for the REST proof Adapter (A9), less for WS where frames are cheap.

### Weaknesses for Agentide

- JSON-RPC has **no streaming primitive** — one request, one response (or error), and
  nothing else. Every streamed protocol built on it (MCP, LSP partials) layers
  streaming on top with ids, tokens, or extra methods.
- Batch ordering is explicitly undefined — fine for independent calls, wrong for chunk
  sequences; streams must never be modeled as batches.

### Takeaway

JSON-RPC 2.0 is the **correlation layer**, not the streaming layer. The seam should
borrow its two rules — every chunk of a call shares one `id`; events are notifications
with no reply — and supply its own streaming semantics on top.

---

## 5. Non-IPC example — HTTP SSE and WebSocket push (the subscription side)

### Mechanism

**Server-Sent Events (SSE)**: a single long-lived HTTP response in `text/event-stream`
format. The server pushes `event: <type>` + `data: <json>` blocks, optionally with
`id:` lines and `retry:` hints. The client auto-reconnects and resumes by sending
`Last-Event-ID`. One-way only — commands go over a separate request channel (exactly
the old MCP split).

**WebSocket push**: a bidirectional, message-framed channel (RFC 6455) with
subprotocol negotiation and ping/pong keepalive. Subscription patterns over it: a
`subscribe` request, then typed event messages, then an `unsubscribe`/close — often
with snapshot-then-delta (first message is the full state, later messages are diffs),
and with resume tokens or sequence numbers to recover missed events after a reconnect.

### Strengths for Agentide

- **SSE's `Last-Event-ID` resume is the gold standard for "don't lose events while
  disconnected".** Agentide's subscription story (W3/W6) has no resume semantics today;
  this is the concrete mechanism to steal if subscriptions ever need replay.
- Snapshot-then-delta is exactly the pattern the dashboard already approximates
  (refetch snapshots on event topics — D-51) and is a clean model for `subscribe` on
  Agentide: first frame = current state, later frames = changes.
- WS push validates the existing envelope: typed `event` frames, no per-event ack,
  app-level ordering — the WS Adapter's fanout already does this.

### Weaknesses for Agentide

- SSE is one-way and text-only; not a fit as the primary Agentide door (WS already is
  bidirectional and framed) — it matters here as the *resume/replay* model.
- WS gives no built-in resume or replay; missed-event recovery is app-level (sequence
  numbers, cursors). Agentide's `stats` frames and 1 MiB FIFO handle backpressure but
  not replay.

### Takeaway

For the subscription side, the seam only needs to *carry* pushes (an `event` capability
on the channel); replay/resume stays an Adapter/wire concern for now. If it is ever
built, `Last-Event-ID`-style cursors are the mechanism to copy.

---

## Synthesis — what all five agree on

| Question | Answer the survey supports |
|---|---|
| One call → many results? | Yes, but **N chunks + one terminal** — never an open-ended response. gRPC (terminal status), LSP (final response still arrives), MCP (one `CallToolResult`) |
| Single reply vs stream? | Same thing: **stream of length one**. gRPC's unary = server-streaming with one message |
| Correlation? | One **`id`** for the whole call (JSON-RPC); chunks and terminal share it |
| Events / subscription? | **Notifications** — no id, no reply (LSP, JSON-RPC); WS push already does this |
| Progress without changing result shape? | **Side-channel** (MCP progress token, LSP `$/progress`) — optional, later |
| Errors? | **Terminal, delivered once** (gRPC status, JSON-RPC error object) |
| Replay after disconnect? | Adapter/wire concern, not the seam's (SSE `Last-Event-ID` is the model if ever built) |

---

## Recommendation for the A4 grilling

Model the seam as a **response channel with a terminal**, handed to the shared
pipeline per invocation and declared with a mode: `single | stream | subscribe`. The
channel exposes three primitives — `emit(chunk)` for protocol-neutral result chunks,
`end(result | error)` as the single terminal event, and `event(topic, payload)` for
subscription pushes — and every chunk of one call carries the call's `id` so Adapters
can map chunks onto their own frames (WS wraps chunks in `invoke.partial` and closes
with `invoke.end`; MCP merges chunks into one `CallToolResult` content array; a future
REST door picks JSON array or SSE). This shape is the survey's consensus: gRPC proves
unary is just a one-message stream, so `single` is `stream` that ends after one `emit`
and the seam is unchanged the day the kernel streams for real — additive by
construction, not by retrofit; JSON-RPC/LSP provide the correlation and
notification-as-event discipline the WS wire already follows. Stream packaging
(protocol-neutral chunks) is shared; frame synthesis, backpressure (1 MiB FIFO, `stats`
frames), topic authorization, and subscription replay stay Adapter-local for v1 — the
channel only supplies the push mechanism, so the WS `subscribe`/`fanout` path threads
through unchanged and MCP keeps its closed `CallToolResult` contract. Progress
side-channels (MCP `progressToken`, LSP `$/progress`) are left as a documented seam
extension, not built now.
