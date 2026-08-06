# PRD-TRD: cli-consumer-ux

**Slug:** cli-consumer-ux
**Status:** Draft
**Date:** 2026-08-06
**Parent:** agentide-cli-consumer (revisits Q2 surface, Q3 default URL)

## Why This Exists

The `agentide` CLI shipped in 0.3.1 with the consumer commands (`sessions`, `capabilities`, `invoke`, `watch`) but two operator-facing gaps block first-time use:

1. **D-79 (Critical):** `agentide invoke <business-cap>` unconditionally returns `GATEWAY_SESSION_REQUIRED`. The CLI never auto-creates a session because the parent GRILL locked `--session` as optional, but the code path requires the operator to *also* mint a session and pass the id. There is no top-level command to mint a session, so the operator is stuck.

2. **D-80 (High):** The CLI help says `--url <ws://host/ws>` with no port. The gateway binds two websocket doors — `:7300` (the `adapter-websocket` consumer door the CLI speaks) and `:7350` (the backend-runtime SDK door for `sdk-node`/`sdk-browser`). Help doesn't say which is which. New operators point at the SDK door, the server silently ignores the consumer auth frame, and the CLI waits 15 seconds before giving up with no message.

Both gaps surface in the e2e test report `agentide/docs/testing/2026-08-06-issues.md` and are logged as drifts D-78–D-84 in `agentide/docs/drift.md`. Fixing them unblocks the headline use case the parent pack exists to deliver.

## Behavioral Spec

Each scenario is runnable against the post-impl simulation (Phase 4).

### Scenario 1: invoke with no session — auto-mint-and-destroy

**Given** a running gateway on `:7300` and a valid operator token
**When** the operator runs `agentide invoke product.list --args '{}' --url ws://127.0.0.1:7300/ws --token ...`
**Then** the CLI:
1. Connects to the websocket adapter
2. Auto-mints a session via `session.create`
3. Invokes `product.list` with the new session id
4. Prints the result (exit 0)
5. Destroys the session before the CLI exits

### Scenario 2: invoke with explicit `--session` — batch workflow

**Given** a running gateway on `:7300` and an existing session id `sess-abc`
**When** the operator runs `agentide invoke product.list --args '{}' --session sess-abc --url ...`
**Then** the CLI invokes the cap with the supplied session id and does NOT destroy the session on exit. The operator owns the session lifecycle (Q1 lock).

### Scenario 3: `--url` with no port — default to 7300

**Given** a running gateway on `:7300`
**When** the operator runs `agentide sessions --url ws://127.0.0.1/ws --token ...`
**Then** the CLI parses the URL, sees no port, inserts `:7300`, and connects to `ws://127.0.0.1:7300/ws`. The host is never defaulted.

### Scenario 4: `--url` pointed at the SDK door (7350) — clear error

**Given** a running gateway with both doors bound
**When** the operator runs `agentide sessions --url ws://127.0.0.1:7350/ws --token ...`
**Then** the CLI:
1. Connects to the SDK door (WS upgrade succeeds)
2. Sends the consumer auth frame `{type:"auth", token: ...}`
3. Sets a 3-second timeout on the auth response
4. Detects the SDK door (no `auth.ok` arrives within timeout — the SDK door only accepts `{type:"sdk.auth"}` first and silently ignores other frames)
5. Closes the socket, prints `error: --url points to the SDK door (port 7350); the CLI consumer needs the websocket adapter (port 7300). Override with --url ws://...:7300/ws.`
6. Exits 2 (pre-flight)

### Scenario 5: `agentide watch` — auto-mint, keep alive, destroy on clean exit

**Given** a running gateway on `:7300`
**When** the operator runs `agentide watch sessions --url ws://127.0.0.1:7300/ws --token ...` then Ctrl-C
**Then** the CLI:
1. Auto-mints a session at startup
2. Prints the snapshot invoke result
3. Subscribes to `session.*` (default topic for the alias)
4. Streams NDJSON events until Ctrl-C
5. Sends `session.destroy` on clean exit
6. Exits 5 (SIGINT — same as parent GRILL S7 lock)

If the connection drops before Ctrl-C, the CLI exits non-clean and the session leaks until the session manager's idle timeout. Matches SDK behavior.

### Scenario 6: pre-flight error path stays stable

**Given** no `--url`, no `PLATFORM_GATEWAY_URL`, no config file
**When** the operator runs any remote command
**Then** the CLI prints `error: gateway URL required (--url, PLATFORM_GATEWAY_URL, or config file)` and exits 2. Same as today.

## Simulation Contract

The post-impl sim (`simulate.sh`) must demonstrate every scenario above. The pre-impl sim (`simulate-pre.sh`) covers scenarios 1–5 with fake wire frames; the post-impl sim drives the real CLI against a real gateway on `:7300` and reads back the wire traces.

```bash
# Scenario 1: agentide invoke with auto-mint
agentide invoke product.list --args '{}' --url ws://127.0.0.1:7300/ws --token "$TOK"
# → exit 0, prints result JSON, gateway log shows session.create + invoke + session.destroy

# Scenario 3: default port 7300
agentide sessions --url ws://127.0.0.1/ws --token "$TOK"
# → exit 0, prints session list. Gateway log shows connection to :7300.

# Scenario 4: wrong-door detection
agentide sessions --url ws://127.0.0.1:7350/ws --token "$TOK"
# → exit 2, stderr: error: --url points to the SDK door (port 7350); the CLI consumer needs the websocket adapter (port 7300). Override with --url ws://...:7300/ws.

# Scenario 5: watch lifecycle
agentide watch sessions --url ws://127.0.0.1:7300/ws --token "$TOK" &  # or use timeout
# → snapshot, then NDJSON event stream. SIGINT → exit 0, gateway log shows session.destroy.
```

## Technical Design

### Data Models

No new data models. The pack is a UX layer over existing wire frames:
- `session.create` (existing platform capability) — returns `{id: string}`.
- `session.destroy` (existing platform capability) — takes `{sessionId: string}`.
- `invoke` (existing wire frame) — accepts optional `sessionId`.

### API Contracts

Two new internal functions in `packages/agentide/src/consumer.ts`:

```ts
/**
 * Apply the port default to a URL string. If the URL has no port
 * (per the WHATWG URL parser), inserts `:7300`. The host is never
 * defaulted. Returns the URL unchanged if it already has a port.
 * Throws ConfigError if the URL is malformed.
 */
function applyPortDefault(rawUrl: string): string;

/**
 * Wrap an invoke with an auto-minted session. Opens the supplied client
 * if needed, mints a session via session.create, runs the invoke,
 * destroys the session, returns the invoke result. Used by runInvoke
 * when --session is omitted.
 */
async function withAutoSession<C extends { invoke: ...; close: ... }>(
  client: C,
  fn: (sessionId: string) => Promise<unknown>,
  opts: { timeoutMs?: number }
): Promise<unknown>;
```

New client-side handshake timeout in `packages/adapter-websocket/src/client.ts`:
- `client.open()` accepts a new `authTimeoutMs` option (default 3000).
- When the WS upgrade succeeds but no `auth.ok` frame arrives within the timeout, `client.open()` rejects with `WsDoorMismatchError` (new error class with `code: "GATEWAY_DOOR_MISMATCH"`).
- `runConsumer` catches this and emits the wrong-door stderr message.

`runWatch` (consumer.ts L276-340) is wrapped in a `try/finally` that sends `session.destroy` on clean exit. The existing signal handler at L322 already calls `settle()`; the finally block runs after `settle()` resolves the outer promise.

### Dependencies

| Package | Used for | Notes |
|---------|----------|-------|
| `@spanexx/adapter-websocket` | WS client, handshake | needs new `WsDoorMismatchError` + `authTimeoutMs` option |
| `@spanexx/platform-capabilities` or `gateway-core` | `session.create` / `session.destroy` | already loaded by the WS client |
| `node:url` (WHATWG) | URL parsing | already used in many places; no new dep |

### Architecture Notes

Two changes layered on the existing consumer flow:

1. **URL defaulting** runs in `runConsumer` after `resolveConfig` returns. One-line addition: `url = applyPortDefault(url)`. Pure local function, no schema change.

2. **Session auto-mint** hooks into `runInvoke` and `runWatch`. Invocation path:
   - `runInvoke`: if `--session` is omitted, wrap the body in `withAutoSession`. The wrapper owns the session lifecycle.
   - `runWatch`: always auto-mint (no `--session` flag for watch). The watch loop already wraps in promise settlement; the `finally` block sends `session.destroy`.

3. **Wrong-door detection** lives in the WS client. The client already collects frames after the WS upgrade; the new code adds a timeout race on the first `auth.ok` arrival. The consumer doesn't need to know about doors.

The portal of entry for the new logic is small: one new local function in `consumer.ts`, one new timeout + error class in `adapter-websocket/src/client.ts`, one try/finally in `runWatch`. No public CLI surface changes.

## Non-Goals

- **No reconnect / resync on `watch` disconnect.** Already a non-goal in the parent GRILL. The new try/finally still leaks the session on disconnect — same as the SDK.
- **No multi-invoke batch mode in a single CLI invocation.** The Q1 pack keeps multi-call workflows behind `--session` + a separate CLI invocation per cap.
- **No client-side health check before the auth frame.** The 3-second timeout already serves as a cheap liveness probe. A pre-flight ping would add round-trips.
- **No changes to the SDK door.** The SDK door's silent-ignore behavior is documented; we rely on it for the timeout-based detection, not on a new error code.
- **No new wire frames.** The pack uses existing `session.create`, `session.destroy`, `auth`, and `auth.ok` shapes.

## Out of Scope (Future)

- A top-level `agentide session create` / `agentide session destroy` alias for operators who want to manage sessions explicitly with shell scripting.
- Profile switching (`[profiles]` in `config.toml`) — already in the parent GRILL's future list.
- Shell completions — already a non-goal.
- Watch reconnect / resync — already a non-goal.

## References

- `agentide/docs/features/cli-consumer-ux/GRILL-cli-consumer-ux.txt` — locked decisions (Q1, Q2, Q3)
- `agentide/docs/features/agentide-cli-consumer/GRILL-agentide-cli-consumer.txt` — parent pack (Q1–Q5)
- `agentide/docs/CONTEXT.md` — Session/Session Manager glossary, Adapter door convention
- `agentide/docs/drift.md` D-78..D-84
- `agentide/docs/testing/2026-08-06-issues.md` — full e2e findings
- `packages/agentide/src/consumer.ts` — current consumer code (no session auto-mint, no URL defaulting)
- `packages/agentide/src/config.ts` — current URL resolution (no port defaulting)
- `packages/adapter-websocket/src/client.ts` — WS client (will gain `authTimeoutMs`)
- `packages/backend-runtime/src/server.ts` — SDK door first-frame rules (silent-ignore on mismatched auth)
