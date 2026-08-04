# Future: agentide CLI

deferred items for `agentide` (operator + consumer CLI). captured here so they don't get re-litigated each pack.

## shell completions

`agentide completion bash|zsh|fish` — emit a completion script. **trigger:** first external user asks for it. **not in v1.**

## profile switching

config.toml supports a `[profiles.<name>]` table; `--profile <name>` picks one. useful for operators juggling staging/prod gateways.

```toml
[default]
gateway_url = "ws://localhost:7300/ws"

[staging]
gateway_url = "wss://staging.example.com/ws"

[prod]
gateway_url = "wss://gateway.example.com/ws"
```

**trigger:** any user mentions "staging" or "prod". **not in v1.**

## watch reconnect + resync

today: `agentide watch <alias>` dies when the connection drops. desired: auto-reconnect with exponential backoff (mirror sdk-node's 1→30s ±20% jitter curve), resubscribe to the same topics on reconnect, optionally emit a synthetic `{"type":"reconnect"}` NDJSON line so consumers can re-snapshot.

**trigger:** first user complains "watch died when gateway restarted". **not in v1.**

## `--stream` invoke mode

the WS adapter already has `invoke.partial` / `invoke.end` for streaming. the CLI today accepts `--mode stream` but treats it as `call`. wire up partial frames to stdout NDJSON, end frame → exit 0.

**trigger:** kernel-level streaming promotes from "future" to "shipped" (websocket-adapter future.md item). **not in v1.**

## `agentide config set`

subcommand to write/rewrite config.toml with the given URL/token. today: operator hand-edits the file. CLI adds: `agentide config set --url ... --token ... [--config <path>]`, refuses to write if perms are looser than 0600.

**trigger:** anyone asks "how do i configure this?" and the answer isn't "edit a TOML file." **not in v1.**

## platform-specific TTY colors

today: `output.ts` emits plain text/JSON, no color. desired: green checkmarks on success, red X on errors, when stdout is a TTY and `--no-color` isn't set. cross-platform color via `chalk` (or hand-rolled ANSI for tree-shake).

**trigger:** a user complains "i can't tell when something failed in a long log scroll." **not in v1.**

## i18n

subcommand names + flags + error messages in non-English locales. cli.ts would need a string table.

**trigger:** never, unless the platform goes international. **not in v1.**

## structured output for scripts

`--format jsonl` (one JSON object per line for snapshot) or `--format ndjson-strict` (same as `agentide watch --json`). useful for piping into `jq` or log aggregators.

**trigger:** a user pipes `agentide capability list | jq` and complains about array brackets in the output. **not in v1.**

## env var for token (already shipped — but flag here for completeness)

`PLATFORM_TOKEN` works today (Phase 2). the `path:` indirection is supported. **no future work here.**

## per-tenant config

config.toml scoped to a tenant id, so the same `agentide` binary can talk to multiple tenants without re-specifying --tenant every time. out of scope for the operator CLI today (operator uses `agentide tenant list` + per-command `--tenant`).

**trigger:** anyone using `agentide` for multi-tenant work. **not in v1.**