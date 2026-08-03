# W6 — Backpressure / slow-consumer policy

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (2026-08-03 — all five sub-questions locked autonomously under user delegation; see "Sub-Qs 1–5 locked" below)
**Blocked by:** W1 (scope) — closed; W3 (subscription model) — closed
**Blocks:** W4 (wire message schema) — resolved

## Question

When a subscribed client cannot keep up with the rate of events the server is
sending, what does the server do? Three plausible policies:

- **Buffer up to a limit, then drop.** Client falls behind; events are dropped
  silently or with a "dropped" marker; client can resync via `state.*` calls.
- **Buffer up to a limit, then close.** Treat slow consumption as a fatal
  connection error; close with a code like `1008` (policy violation) or `1013`
  (try again later).
- **Block the producer.** Pause `event-bus` fan-out until the consumer catches
  up. (Almost certainly wrong — blocks the entire platform for one slow client.)

The WebSocket protocol has TCP backpressure under the hood (kernel send buffer
fills, write() blocks), but Node's `ws` library abstracts this — we need a
deliberate policy, not a "trust TCP" accident.

## What I know

- `ws` library exposes a `drain` event and lets you check `socket.bufferedAmount`.
  Above some threshold (commonly 1 MiB), the consumer is "behind."
- `event-bus.subscribe(...)` handlers run synchronously in the publisher's
  call frame — blocking a handler blocks the publisher. So a naive "block
  the producer" model is out.
- Backend-runtime has a per-connection `capsByConnection` map but no backpressure
  logic (its work is request-shaped, not stream-shaped). No prior pattern to
  copy from in-tree.
- W5 closed: per-connection outbound queue REQUIRED — bus handlers must never
  await `socket.send()` (bus dispatch awaits `Promise.allSettled` at
  `packages/event-bus/src/index.ts:242-246`; blocking the handler blocks the
  publisher). W6's whole-connection policy is exactly that queue's overflow
  policy.
- W1 REOPEN closed: pull (`invoke`) is v1 and universal — a client that dropped
  events has a resync path already locked: re-`invoke` the snapshot cap
  (`session.list`, `capability.list`, …). This is the decisive fact: dropping
  is recoverable, so closing a slow consumer is a big hammer for a transient
  condition.

## Sub-questions

1. **Threshold:** what buffer size counts as "behind"? Suspected: 1 MiB per
   connection (matches common defaults), configurable.
2. **Drop or close:** on threshold breach, do we drop events silently, drop with
   a `dropped` counter in the next event, or close the socket with a close code?
3. **Drop strategy:** if dropping, FIFO drop (oldest first) or rate-based drop
   (sample 1 of every N)?
4. **Recovery signal:** if we close, what close code (`1008` / `1013` / custom)?
   If we drop, does the client get a periodic `{type:"stats", dropped:N}` so it
   can resync?
5. **Per-topic vs whole-connection:** is the policy per-topic (one slow topic
   doesn't kill the connection) or whole-connection (one slow buffer kills it)?
   Per-topic is fairer but more code.

## Resolution must record

- the threshold and whether it's configurable;
- drop vs close, and the exact close code if close;
- drop strategy (FIFO / rate / sample) and the recovery signal;
- per-topic vs whole-connection scope.

## Progress

**2026-08-03 — Claimed + closed in one pass (autonomous under user
delegation).** W1 and W3 both closed → W6 unblocked. All five sub-questions
locked below.

## Sub-Qs 1–5 (locked)

User granted full decision authority 2026-08-03 (same delegation as W3);
all decisions checked against PHILOSOPHY.md + shipped code + the W1/W3/W5
locks before locking.

1. **Threshold: 1 MiB per connection, configurable.** Config knob
   `maxBufferedBytes` (default `1_048_576`), factory option. Matches the
   ticket's suspicion and common `ws` defaults; sizing sanity: a
   `browser.screenshot` payload (~341 KiB base64) fits multiple frames —
   1 MiB is ~3 such frames, plenty of headroom for the v1 dashboard's
   lifecycle-event traffic. Configurable because the dashboard's future
   views (screenshot-heavy) may want more (delay-complexity: ship the knob,
   tune when a need shows up).

2. **DROP, not close.** On threshold breach the adapter drops from the
   per-connection outbound queue (never blocks the bus — W5 lock).
   Rationale, in order of weight:
   - W1 REOPEN locked universal `invoke` pull — the dashboard can resync
     with one `invoke {session.list}` after a drop. Closing a slow
     consumer turns a transient condition into a full reconnect +
     re-auth + re-subscribe cycle for something a pull fixes in one frame.
   - "Drop, don't punish" (W2 sub-Q 2 philosophy): closing with 1008/1013
     labels a slow consumer a policy violator (1008) or punishes it for a
     server-side condition (1013) — neither is true.
   - Close codes are a poor recovery signal: after close, the client must
     reconnect to learn anything. A stats frame keeps the socket alive and
     the resync path open.
   - Block-the-producer is out (ticket already rules it out; W5 makes it
     impossible: handlers run in the publisher's call frame).

3. **Drop strategy: FIFO (drop oldest, keep newest).** Events are lifecycle
   facts; for a live dashboard view the NEWEST state is what matters — a
   dropped `session.created` is irrelevant if the client re-pulls the
   snapshot and sees the session exists. Rate-based sampling (drop 1 of N)
   keeps stale events and drops fresh ones — wrong for snapshot+live views
   (dashboard GRILL Q5). FIFO is also the cheapest: one shift() at the
   queue head.

4. **Recovery signal: periodic `{type:"stats", dropped:N}` control frame,
   rate-limited (~1/s, knob `statsIntervalMs` default 1000).** NOT
   per-event tagging (client can't count reliably across frames anyway),
   NOT a close code (sub-Q 2). The stats frame is the observability
   seam: the client sees `dropped > 0` and knows to re-pull its
   snapshots. Counter is cumulative per connection (monotonic; client
   diffs). Rate limit exists so the recovery signal itself can't
   contribute to the overflow (observability-mandatory without
   self-defeating feedback).

5. **Scope: WHOLE-connection in v1.** One queue per connection (W5 lock),
   one threshold, one counter. Per-topic queues would multiply the
   bookkeeping (N queues, N thresholds, N counters, per-topic stats
   frames) for zero demonstrated v1 need — the dashboard's topics are few
   and slow. "Simple today. Scalable tomorrow." (PHILOSOPHY): per-topic
   isolation is a v2 refinement if a consumer ever mixes a firehose topic
   with a critical topic on one socket; record in future.md.

Cross-ticket notes for W4 (wire schema):
- New frame: `{type:"stats", dropped:N}` (control frame, same envelope
  family).
- `invoke.partial` (W1 REOPEN streaming) rides the same per-connection
  queue — a slow consumer mid-stream drops partials under the same FIFO
  policy; the stream is resync-able by re-`invoke mode:"stream"` (the
  stream contract restarts cleanly).

Source: user delegation 2026-08-03; W1 REOPEN (universal pull = resync
path); W3 sub-Q 5 (lifecycle); W5 resolution (queue architecture, bus
non-blocking); PHILOSOPHY.md (delay-complexity, observability-mandatory,
drop-don't-punish precedent).