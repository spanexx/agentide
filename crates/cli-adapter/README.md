# cli-adapter (crates/cli-adapter)

Rust static binary `platform` — a **consumer** of platform capabilities. Connects to a running Agentide gateway over websocket, invokes caps, renders output. NOT the operator CLI (that's `@spanexx/agentide`'s `agentide` binary).

## build

```bash
cd crates/cli-adapter
cargo build --release
# binary at target/release/platform
```

## config

TOML at the path from `--config` flag (defaults to `<config-dir>/platform/config.toml`):

```toml
gateway_url = "ws://127.0.0.1:7300/ws"
token = "path:/etc/agentide/platform.jwt"   # or "literal:eyJ..." or env var
```

resolution order: flag > env (`PLATFORM_GATEWAY_URL` / `PLATFORM_TOKEN`) > config file > TTY prompt. `path:` prefix reads token from file once per run.

## usage

```bash
# list aliases
./target/release/platform --help

# one-shot invocation
./target/release/platform capabilities                      # alias → capability.list
./target/release/platform sessions list                      # alias → session.list
./target/release/platform plugins list                       # alias → plugin.list
./target/release/platform status                             # alias → gateway.status
./target/release/platform health                             # alias → system.health

# generic invoke
./target/release/platform invoke product.list '{}'
./target/release/platform invoke cart.add '{"userId":"u1","productId":"p1","sku":"X","name":"X","priceCents":100,"qty":1}'

# watch an alias for live events
./target/release/platform --watch sessions                    # streams session.* as NDJSON
```

## TTY-aware output

- TTY → aliases render as tables, status/health as key:value, invoke as pretty JSON
- non-TTY or `--json` → compact one-line JSON

## exit codes

0 = `invoke.result` · 1 = `invoke.error` (codes passed verbatim) · 2 = pre-flight (usage, config, refused, close 1009/1011, `subscribe.error`, `error`) · 3 = TLS-layer · 4 = `auth.error` / close 1008 · 5 = interrupted (Ctrl-C / SIGTERM)

## what it doesn't do

- **doesn't mint tokens.** use `@spanexx/agentide`'s `agentide token issue` for that (or the dev `scripts/mint-token.mjs`).
- **doesn't manage the gateway.** no `init`, no `start`, no `stop`. the gateway must be running before this connects.

## wire

talks the same `@spanexx/adapter-websocket` protocol (`{type, ...}` envelope, port 7300, JWT in first message after onopen). shares the wire with `sdk-node` and `sdk-browser` — any of the three can connect to the same gateway and call the same caps.