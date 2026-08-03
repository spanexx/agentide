# Q3 — Connection / config UX

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (2026-08-03, autonomous under user delegation —
precedence, TOML config, `path:` indirection, TTY prompt, no default URL)
**Blocks:** Q4 (output + watch) — unblocked, both closed together

## Question

How does the user tell the Rust CLI *where* the gateway is and *which token*
to use? The binary is local; the gateway is remote. The CLI must find both
before the first `auth` frame.

## What I know

- WS adapter expects `{type:"auth", token}` as the first message after
  `onopen` (locked W2). Token = a JWT minted by `gateway.issueToken`
  (caller `platform-cli` or similar; scope = `platform.*` or narrower per
  the operator's intent; `expectedOrigins` irrelevant for CLI — no `Origin`
  header is sent).
- The existing `agentide` operator CLI mints tokens via the in-process
  factory. The CLI adapter *consumes* tokens; minting stays with the
  operator CLI.
- Standard Rust config patterns: `~/.config/<app>/config.toml` on Linux,
  `~/Library/Application Support/<app>/config.toml` on macOS,
  `%APPDATA%<app>\config.toml` on Windows — provided by the `dirs` crate
  (idiomatic, replaces `directories` crate for new code).
- Tokens are secrets. argv and process listings are observable to other
  users on the box. A `path:/path/to/secret` reference keeps the literal
  out of argv.
- Env vars (`PLATFORM_GATEWAY_URL`, `PLATFORM_TOKEN`) are the universal
  CI-friendly surface.

## Sub-questions

1. **URL source precedence:** flag > env > config file > interactive prompt?
2. **Token source precedence:** flag > env > config file > interactive prompt
   (with `path:` indirection supported in any source)?
3. **Config file format:** TOML (`gateway_url`, `token`, optional `tenant`,
   optional `default_session`)? YAML? JSON? Recommend TOML — Rust-native,
   `serde` round-trips cleanly, comments allowed.
4. **Token security in config:** plain string OK in a `0600` file, or
   require `path:` indirection (file mode `0400` or stricter) for any
   file-sourced token?
5. **Interactive prompt:** only when nothing else is set? When called from a
   TTY? Skip in non-TTY (CI / scripts) — fail with a clear "no token
   configured" error pointing at the docs.
6. **Command-line surface for invocation:**
   `platform --url <ws://host:port/ws> --token <jwt|path:/...> <subcommand>`
   with `--config <path>` to point at a non-default config file?

## Resolution must record

Precedence order, file path + format + permissions, interactive prompt
behavior, and any per-source quirks (e.g. `path:` indirection). Confirm or
revise the recommended shape above.

## Recommendation up front

| Source | Precedence | Notes |
|--------|------------|-------|
| `--url`, `--token` flags | 1 | Per-invocation override; overrides everything below. |
| `PLATFORM_GATEWAY_URL`, `PLATFORM_TOKEN` env | 2 | CI / container friendly. |
| Config file (`<OS-config-dir>/platform/config.toml`) | 3 | `0600` file mode; `token` field may be a literal OR `path:/...`. |
| Interactive prompt | 4 | Only when stdin is a TTY AND nothing above is set. |

Token: `path:/...` indirection supported in **any** source — same flag/env
value, same config-file field. The token resolver reads the file and uses its
contents (trimmed) as the bearer string.

Lock this recommendation, or steer it?

## Resolution (locked 2026-08-03, autonomous under user delegation)

All six sub-questions locked. Every check ran against PHILOSOPHY.md
(delay-complexity, security-by-default, interfaces-forever), the locked
adapter wire (W2 auth, W4 envelope), and the in-flight adapter port question
before locking.

1. **URL precedence: flag > env > config > interactive prompt.**
   `--url` per-invocation, `PLATFORM_GATEWAY_URL` env for CI, TOML config for
   the persistent case, prompt only as last resort (TTY only).

2. **Token precedence: flag > env > config > prompt, `path:` in ANY source.**
   `--token` / `PLATFORM_TOKEN` / config `token` field each accept a literal
   JWT or `path:/abs/or/relative` to a file whose trimmed contents are the
   bearer. argv stays clean in the common case; env + config get the same
   indirection for free. `expectedOrigins` irrelevant — CLI sends no `Origin`
   header (W2 sub-Q 4 Node-bypass lock).

3. **Config file = TOML at `<OS-config-dir>/platform/config.toml`** via the
   `dirs` crate (`~/.config` Linux, `~/Library/Application Support` macOS,
   `%APPDATA%` Windows). v1 schema: `gateway_url` + `token` ONLY — no
   `tenant`, no `default_session` (tenant lives in the token's `sub` claim;
   session is per-invoke via `--session`; delay-complexity). Unknown keys
   IGNORED (forward-compatible — multi-tenant profiles in future.md will add
   `[profiles]` tables without breaking v1 binaries).

4. **Token in config: plain literal OK; `path:` for anything shared.** The
   CLI does NOT create the config file in v1 (user hand-writes it, guided by
   `--help`/docs). If the file's perms are looser than `0600`
   (group/world-readable), CLI prints ONE stderr warning suggesting
   `chmod 600` — warn, don't fail (self-hosted admin's box, their call;
   security-by-default without lockout).

5. **Interactive prompt: TTY-only, last resort.** Triggered only when stdin
   is a TTY AND flag/env/config are all silent for a given value. Token
   prompt reads WITHOUT echo (`rpassword` crate), URL prompt plain. Non-TTY
   + missing value = hard failure, exit 2, message pointing at the docs
   ("set PLATFORM_GATEWAY_URL or --url") — CI never hangs on a prompt.

6. **CLI surface: global flags before the subcommand.**
   ```
   platform [--url <ws://host:port/ws>] [--token <jwt|path:/...>]
            [--config <path>] <subcommand> [flags]
   ```
   `--config` points at a non-default config file (test/CI use). Scheme may
   be `ws://` or `wss://` (TLS failure → exit 3, see Q4).

7. **NO hardcoded default URL in v1.** The adapter's default port is not
   locked yet (adapter feature-pipeline in flight). Hardcoding `ws://127.0.0.1:
   <guess>/ws` would race that decision and bake a wrong default into an
   interface-forever binary. URL must be explicit (flag/env/config/prompt).
   Revisit in future.md when the adapter ships with a locked port.

Consequences: CONTEXT.md Decisions Log entry (Q3); GRILL record (Q3);
map Decisions-so-far; future.md multi-tenant profiles pre-req now satisfied
(TOML). No drift logged — no doc-vs-code divergence created.