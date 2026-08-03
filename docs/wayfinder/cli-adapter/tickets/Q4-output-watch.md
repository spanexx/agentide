# Q4 — Output formatting, exit codes, `--watch`

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (2026-08-03, autonomous under user delegation —
TTY-aware output, exit codes 0–5, watch on aliases only, no stream in v1)
**Blocks:** nothing — last batch of CLI-shape decisions (closed with Q5)

## Question

Three small UX decisions left for the Rust CLI:

1. **Output formatting:** how does the binary print results?
2. **Exit codes:** what code does the process return on each outcome?
3. **`--watch`:** how does a user subscribe to live events on the same
   connection?

## What I know

- The wire envelope returns `{type:"invoke.result", correlationId, output}`
  or `{type:"invoke.error", correlationId, error: {code, message}}` (locked
  W4). The CLI's job: render `output`, surface `error`, exit.
- GATEWAY_* error codes are a fixed set (`packages/errors/src/index.ts:36-55`,
  18 codes). `auth.error` carries a string code too (`origin mismatch`,
  `auth failed`, etc.).
- Shell scripts branch on exit codes. Distinct codes per error category are
  common practice (`gh`, `aws`, `kubectl`).
- The WS adapter supports `subscribe{topics} → event{name, payload, ...}`
  on the same socket as `invoke` (locked W3).
- `topics` are string patterns matched by event-bus. Existing topics:
  `session.*`, `plugin.*`, `capability.*`, `gateway.*`, `system.*`,
  `sdk.*` (per dashboard D3 lock and sdk-node).

## Sub-questions

1. **Default output:** structured key:value dump, table for known lists,
   raw JSON if `--json`? Or JSON pretty-print default + `--human` flag?
2. **Per-subcommand formatting:** do `sessions`, `plugins`, `capabilities`,
   `health` get a curated table format, while `invoke <anything-else>`
   gets a generic dump?
3. **Exit codes:**
   - 0 = `invoke.result` received
   - 1 = generic `invoke.error`
   - 2 = config / connection error (can't reach gateway, no token, etc.)
   - 3+ = one code per GATEWAY_* category (auth, authz, rate-limit, …)?
   - Confirm the mapping.
4. **`--watch`:** flag on aliases (`platform sessions --watch`,
   `platform plugins --watch`), streams `event` frames to stdout until
   Ctrl-C? Same flag on `invoke <capability>` — start an invoke, then
   stream related events? Or a separate `platform watch <topic-pattern>`
   command?
5. **Output for `--watch`:** NDJSON (one JSON event per line)? Pretty?
   Recommend NDJSON — pipeable into `jq`, `grep`, etc.
6. **Streaming invoke (`mode:"stream"`):** separate flag (`--stream`)?
   Phase 2 — most caps don't support streaming. Out of v1 unless the
   adapter chart requires it; chart locked `mode:"call"` as the v1 default
   with `mode:"stream"` as a follow-up.

## Resolution must record

Default output shape, exit-code mapping (with a table), `--watch` semantics,
and whether `--stream` ships in v1.

## Recommendation up front

1. **Default output = human table for the five aliases** (`sessions`,
   `plugins`, `capabilities`, `status`, `health`) when stdout is a TTY.
   **Generic `invoke` = JSON pretty-print by default.** A global `--json`
   flag forces raw JSON for everything (machine consumers, CI).
2. **Exit codes:**
   | Code | Meaning |
   |------|---------|
   | 0 | `invoke.result` received |
   | 1 | `invoke.error` (any GATEWAY_* code, or `auth.error`) |
   | 2 | Pre-flight failure (config missing, token unparseable, connect refused) |
   | 3 | TLS/upgrade failure |
   | 4 | Auth failure (handshake rejected before `auth.ok`) |
   | 5 | Process interrupted (Ctrl-C, SIGTERM) |
3. **`--watch` lives on the aliases** (`platform sessions --watch`,
   `platform plugins --watch`, `platform capabilities --watch`,
   `platform status --watch`, `platform health --watch`). One event per
   line (NDJSON). Ctrl-C exits 5. Same socket as `invoke` would have
   used (the alias sends one `invoke` for the snapshot, then `subscribe`
   on the matching topic — single connection, no race).
4. **`--stream` = out of v1.** Most caps don't support streaming; the
   adapter chart locked `mode:"call"` as the v1 default. Add when a cap
   needs it.
5. **Default topic per alias:** `sessions` → `session.*`,
   `plugins` → `plugin.*`, `capabilities` → `capability.*`,
   `status`/`health` → `gateway.*`. User override via `--topic
   <pattern>`.

Lock this recommendation, or steer it?

## Resolution (locked 2026-08-03, autonomous under user delegation)

All six sub-questions locked, checked against PHILOSOPHY.md
(delay-complexity, no-third-vocabulary), the W4 envelope (invoke.error code
passthrough, `stats` frame, close codes), and the D3 topic lock (`system.*`
has no producers) before locking.

1. **Output — TTY-aware defaults, `--json` to force machine output:**
   - stdout TTY → aliases print a **human table** (columns per alias:
     `capabilities` = name/version/tier, `sessions` = id/status/created,
     `plugins` = id/version/status, `status`/`health` = key:value pairs);
     generic `invoke` prints **pretty JSON** (2-space indent).
   - stdout NOT a TTY (piped, CI) → **compact JSON** everywhere (one line,
     jq-friendly) — kubectl-style auto-detect, no flags needed.
   - `--json` forces compact JSON even in a TTY (machine consumers, capture
     in scripts). No `--human` flag — TTY is the human default.

2. **Per-subcommand formatting:** the 5 aliases get curated tables; any
   other capability via `invoke` gets the generic JSON dump. Output shape
   is a CLI concern only — the wire envelope (W4) is untouched.

3. **Exit codes (0–5, locked):**
   | Code | Meaning |
   |------|---------|
   | 0 | `invoke.result` received |
   | 1 | `invoke.error` — ANY GATEWAY_* code, code passthrough verbatim (W4) |
   | 2 | Pre-flight / connection failure: config missing, token unparseable, connect refused, DNS, upgrade/close mid-flight (1009/1011), `subscribe.error` during `--watch`, `error` frame |
   | 3 | TLS/upgrade failure (`wss://` handshake, cert errors) |
   | 4 | `auth.error` — handshake rejected before `auth.ok` (close 1008); covers all W2 auth codes (`token expired`, `token invalid`, `token missing`, `tenant suspended` — never `origin mismatch`, CLI sends no Origin) |
   | 5 | Interrupted (Ctrl-C / SIGTERM) — watch mode exits 5 on signal |

   Deliberately NO per-GATEWAY_* exit codes (recommendation's "3+"
   option): the GATEWAY_* code already travels in the `invoke.error` frame
   and the JSON output — a third vocabulary on the exit-code channel is
   delay-complexity. Shell scripts that need the specific code parse
   `--json`. 0–5 is the interface; stable forever.

4. **`--watch` on the 5 aliases only** (not on generic `invoke`): one
   connection — snapshot `invoke` (`mode:"call"`) → print snapshot in the
   alias's normal format → `subscribe` on the default topic → stream
   `event` frames as **NDJSON** (one event per line, envelope verbatim:
   `{topic, id, publishedAt, payload}`) until Ctrl-C → exit 5. `--json` +
   `--watch` = snapshot as compact JSON + events as NDJSON (pure JSON
   stream, jq-pipeable end to end). `--topic <pattern>` overrides the
   default. `stats` frame with `dropped > 0` prints ONE stderr warning
   ("N events dropped — snapshot may be stale") per W6 sub-Q 4.

5. **`--watch` reconnect: NONE in v1.** A dropped socket during watch exits
   2 (connection failure). The dashboard's reconnect backoff exists for a
   long-lived UI; watch is a short-lived admin observation — re-run the
   command. Reconnect lands in future.md if a real need shows up
   (delay-complexity).

6. **`--stream` (invoke mode:"stream"): OUT of v1.** The adapter supports
   it (invoke.partial/invoke.end per W4), but no v1 capability streams;
   the adapter chart locked `mode:"call"` as the v1 default. Add when a
   cap needs it (future.md).

Consequences: CONTEXT.md Decisions Log entry (Q4); GRILL record (Q4); map
Decisions-so-far. No drift — no doc-vs-code divergence created.