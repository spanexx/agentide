# PRD-TRD: agentide CLI consumer commands

**Slug:** agentide-cli-consumer
**Status:** Approved (pending IMPL)
**Date:** 2026-08-03
**Replaces:** BI[23] cli-adapter for the consumer use case. operator side (init/status/tenant/token/capability/plugin) is unchanged.

## Why This Exists

the TS `agentide` CLI today (`packages/agentide/src/cli.ts`) is operator-only: it spins up its own `Platform` per invocation, runs in-process caps (`tenant.create`, `token.issue`, `capability.list`, etc.), tears down. there's no first-party way to:

- query a **live** gateway's runtime state (`sessions list`, `system.health`)
- **invoke a registered business cap** by name from a terminal (`agentide invoke product.list '{}'`)
- **stream live events** as NDJSON (`agentide watch sessions`)

without these, every script author hand-builds a websocket client, re-implements auth and exit-code conventions, and the adapters' "one door for all v1 clients" promise is quietly untrue.

## scope

this pack adds the consumer side to `agentide` so a single binary does both jobs (operator + consumer). replaces the `crates/cli-adapter/` rust binary.

## Behavioral Spec

all behavior below is locked in `GRILL-agentide-cli-consumer.txt` (Q1–Q5) and ports the 8 scenarios from `docs/features/cli-adapter/PRD-TRD-cli-adapter.md` verbatim, changing only the implementation language.

### Scenario 1: Config precedence

**Given** sources in order flag > env > config file > prompt (TTY only)
**When** `agentide` resolves the gateway URL and token
**Then** the first source that supplies a value wins:
- flags: `--url <ws://host/ws>`, `--token <jwt|path:/...>`
- env: `PLATFORM_GATEWAY_URL`, `PLATFORM_TOKEN`
- config: `<OS-config-dir>/platform/config.toml` (override with `--config <path>`); v1 schema `{gateway_url, token}`; unknown keys IGNORED
- prompt: TTY only, no-echo token read; URL never prompted

`path:/...` reads the file as the token from any source, once per run. missing URL+token with no TTY → exit 2.

### Scenario 2: Alias commands

**Given** an authenticated connection
**When** the operator runs a convenience alias
**Then** it maps to a capability invoke:
- `capabilities` → `capability.list`
- `sessions` → `session.list` *(remote)*
- `plugins` → `plugin.list`
- `status` → `gateway.status`
- `health` → `system.health` *(remote, alias for `system health`)*

aliases are additive — no alias is removed without a preceding deprecation note.

### Scenario 3: Output shaping

**Given** a completed invoke
**When** stdout is a TTY → aliases render tables (`capabilities` = name/version/tier, `sessions` = id/status/created, `plugins` = id/version/status), `status`/`health` render key:value, `agentide invoke <cap>` renders pretty JSON
**When** stdout is piped (non-TTY), or `--json` is passed → everything renders compact JSON on one line — script-safe

### Scenario 4: Invoke with arguments

**Given** an authenticated connection
**When** the operator runs `agentide invoke <capability> [--args '<json>'] [--session <id>] [--mode call|stream]`
**Then** the wire frame is `{type:"invoke", correlationId, name, input?, sessionId?, mode:"call"|"stream"}` and the response maps to the terminal:
- `invoke.result` → output (exit 0)
- `invoke.error` → `error: <code> — <message>` with the gateway's code passed through verbatim (no third vocabulary), exit 1

`--mode stream` is reserved for v2 (kernel-level streaming); v1 only supports `call`. passing `--mode stream` is a no-op flag in v1 (warning printed, behavior is `call`).

### Scenario 5: Exit codes

**Given** any run
**Then** exit codes are:
- `0` = `invoke.result`
- `1` = `invoke.error` (any `GATEWAY_*` code)
- `2` = pre-flight / connection failure (usage, config, token unparseable, connect refused, close 1009/1011, `subscribe.error`, `error` frame)
- `3` = TLS / upgrade failure
- `4` = `auth.error` before `auth.ok` (close 1008 — all W2 codes except `origin mismatch`; CLI never sends Origin)
- `5` = interrupted (Ctrl-C / SIGTERM)

### Scenario 6: Token hygiene

**Given** config file present with perms looser than 0600
**When** a run starts and the config source actually supplies the token or URL
**Then** exactly ONE stderr warning per run, naming the offending file (`<file> is group/world-readable — consider chmod 600`, where `<file>` is the `config.toml` or the `path:` token file that triggered it).

`path:` token files follow the same 0600 rule. missing `path:` file → error + exit 2.

### Scenario 7: Watch

**Given** an authenticated connection and `--watch` on one of the aliases
**Then** the CLI invokes the snapshot once, subscribes to the alias's default topic:
- `sessions` → `session.*`
- `plugins` → `plugin.*`
- `capabilities` → `capability.*`
- `status`/`health` → `gateway.*` *(NOT `system.*` — no producers exist there per dashboard-core D3)*

prints `{type:"event", ...}` frames as NDJSON (one per line) until Ctrl-C. snapshot prints in the normal TTY/`--json` shape; events never re-render it. `--topic <pattern>` overrides the default. `--watch --json` = pure JSON stream. a `stats` frame with `dropped > 0` → one stderr warning. Ctrl-C → exit 5. **no reconnect in v1**.

### Scenario 8: Failure surfaces

**Given** a run that cannot complete
**Then** errors print to stderr as `error: <plain-English message>` and the exit code distinguishes the layer: TLS (3) vs auth (4) vs connection/pre-flight (2) vs capability denial or failure (1). unreachable gateway, close codes 1009 (frame too large) and 1011 (heartbeat) are pre-flight/connection failures (exit 2).

## Simulation Contract

post-impl sim must drive the real `agentide` binary against a live gateway + websocket adapter and demonstrate:

```bash
agentide --data-dir ./data status                          # in-process, exit 0
agentide --data-dir ./data capability list                # in-process, table
agentide --url ws://127.0.0.1:7300/ws --token <jwt> capability list
                                                        # remote, exit 0 (gateway invocation)
agentide --url ws://127.0.0.1:7300/ws --token <jwt> sessions
                                                        # remote, exit 0
agentide --url ws://127.0.0.1:7300/ws --token <jwt> invoke gateway.status
                                                        # remote, pretty JSON
agentide --url ws://127.0.0.1:7300/ws --token <jwt> invoke product.list '{}'
                                                        # remote, exit 0 (business cap)
agentide --url ws://127.0.0.1:7300/ws --token <jwt> --json sessions
                                                        # remote, compact JSON
agentide --url ws://127.0.0.1:7300/ws --token <jwt> --watch sessions
                                                        # NDJSON stream, Ctrl-C → exit 5
agentide --url ws://127.0.0.1:7300/ws --token bad.jwt sessions
                                                        # exit 4 (auth)
agentide --url ws://127.0.0.1:7300/ws --token path:/tmp/nope.jwt sessions
                                                        # exit 2 (missing token file)
agentide --token token.bad sessions                       # exit 2 (no URL, non-TTY)
echo '{}' | agentide --url wss://untrusted:7300/ws --token <jwt> health
                                                        # exit 3 (TLS)
echo '<config 0644>' > /tmp/agentide-cfg.toml
agentide --config /tmp/agentide-cfg.toml --token <jwt> status
                                                        # one stderr warning
```

each behavioral scenario maps 1:1 to sim commands; the sim asserts the same observable states the cli-adapter pre-impl sim showed (exit codes, tables/JSON shapes, wire frames, NDJSON events).

## Technical Design

### architecture

`packages/agentide/src/cli.ts` (operator commands) is extended with a parallel `consumer.ts` module that owns the WS client + TTY-aware output. `bin.js` keeps its thin wrapper (runCli → stdout/stderr/exit).

two modes per invocation:
- **in-process:** `createPlatform({ fs, dataDir, ... })` — used for `init`/`status`/`tenant`/`token issue`/`capability`/`plugin list`
- **remote:** `connectClient({ url, token })` — used for `sessions`/`health`/`invoke`/`watch`

### dependencies (additions to `@platform/agentide`)

- `ws` — websocket client (matches the server-side dep already in `@spanexx/adapter-websocket`)
- `@spanexx/adapter-websocket` — wire protocol types from `src/protocol.ts`
- `@spanexx/origin` — only if `--origin` flag is added (out of scope per Q1; skip for v1)
- NO new runtime deps for the operator side; everything already in tree

### module layout (additions)

```
packages/agentide/src/
├── cli.ts              # existing — operator commands
├── cli-types.ts        # existing — add CliConsumerConfig, ResolvedConfig
├── consumer.ts         # NEW — WS client + invoke + watch loop
├── config.ts           # NEW — flag > env > file > prompt precedence, path: indirection
├── output.ts           # NEW — TTY-aware formatters (table / key:value / pretty / compact)
├── exit-codes.ts       # NEW — 0..5 enum + mapping
├── errors.ts (existing) — add stderr warning helpers
└── __tests__/
    ├── cli.test.ts (existing) — add consumer command tests
    ├── consumer.test.ts  # NEW — WS client + invoke + watch
    ├── config.test.ts    # NEW — precedence + path: + perms warning
    ├── output.test.ts    # NEW — TTY vs non-TTY vs --json
    └── exit-codes.test.ts # NEW — mapping
```

### data models

```typescript
// config resolution
interface ResolvedConfig {
  url: string;
  token: string;
  tokenSource: 'flag' | 'env' | 'config-file' | 'prompt';
  urlSource: 'flag' | 'env' | 'config-file';  // prompt never provides URL
}

enum Source { Flag, Env, ConfigFile, Prompt }

enum ExitCode {
  Ok = 0,
  InvokeError = 1,
  Preflight = 2,
  Tls = 3,
  Auth = 4,
  Interrupted = 5,
}

// config file v1 — unknown keys ignored (TOML parser w/ strict OFF or strip unknown)
interface ConfigFile {
  gateway_url?: string;
  token?: string;
}

// WS client minimal surface (consumer-side)
interface WsClient {
  invoke<I, O>(name: string, input: I, opts?: { sessionId?: string }): Promise<O>;
  subscribe(topics: string[]): AsyncIterable<{ topic: string; payload: unknown }>;
  close(): void;
}
```

### wire contract

verbatim from `docs/features/cli-adapter/PRD-TRD-cli-adapter.md` (port unchanged):
- C→S `{type:"auth", token}`, `{type:"invoke", correlationId, name, input?, sessionId?, mode:"call"}`, `{type:"subscribe", topics}`; `{type:"unsubscribe", topics}`
- S→C `{type:"auth.ok"|"auth.error", ...}`, `{type:"invoke.result", correlationId, output}`, `{type:"invoke.error", correlationId, code, message, details?}`, `{type:"event", topic, id, publishedAt, payload}`, `{type:"stats", dropped}`, `{type:"error", code, message}`

### TTY detection

`process.stdout.isTTY === true` for table/key:value/pretty rendering; false (or `--json`) for compact one-line JSON. no external dep — `node:tty` `isatty` is sufficient. on Windows, also check for color support (out of scope v1).

## Non-Goals

- no `config.toml` writer (operator hand-writes; docs show the example)
- no reconnect or watch-resume in v1 (watch dies with the connection)
- no `--stream` invoke mode (reserved flag only; behavior = `call`)
- no hardcoded default URL in v1
- no interactive shell / REPL; one command per process
- no profile switching
- no token minting through the CLI's `invoke` command (only via `agentide token issue`, which uses in-process `gateway.issueToken`)

## Out of Scope (Future)

tracked in `docs/features/agentide-cli-consumer/future.md` (TBD):
- shell completions (`agentide completion bash`)
- profile switching (`[profiles]` in config.toml)
- watch reconnect + resync after disconnect
- `--stream` invoke mode (kernel-level streaming)
- `--tee` for operator (log every gateway event to a file)

## Deletions

- `crates/cli-adapter/` — entire rust crate (CHARTED in BI[23], never delivered)
- BI[23] row in `docs/Feature_Backlog.md` — replace with "DELETED — superseded by BI[28] agentide-cli-consumer"
- `crates/cli-adapter/README.md` — already updated; final cleanup happens with the rust crate removal

## References

- `GRILL-agentide-cli-consumer.txt` — locked decisions Q1–Q5 (this pack)
- `docs/features/cli-adapter/PRD-TRD-cli-adapter.md` — 8 scenarios ported verbatim
- `docs/features/cli-adapter/IMPL-cli-adapter.md` — IMPL phase pattern, port to TS
- `docs/features/cli-adapter/GRILL-cli-adapter.txt` — original grill source
- `docs/features/websocket-adapter/PRD-TRD-websocket-adapter.md` — wire contract W1–W6 (verbatim, no re-grilling)
- `packages/agentide/src/cli.ts` — current operator CLI
- `packages/agentide/dist/bin.js` — current bin entry (fixed in commit `c621005`)
- `CONTEXT.md` — glossary
- `IMPL-agentide-cli-consumer.md` — execution plan (separate doc, TBD)