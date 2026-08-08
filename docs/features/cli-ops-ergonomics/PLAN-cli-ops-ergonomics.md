# PLAN: cli-ops-ergonomics (D-112, D-113, D-114)

**Slug:** cli-ops-ergonomics
**Status:** Approved (user lock, 2026-08-08)
**Parent:** agentide CLI; closes drift entries D-112, D-113, D-114.
**Predecessor:** `548c5b6 feat(cli): add --adapter-rest-port flag` (the smallest D-114 win, already landed).

## Why This Exists

Three operator-facing drifts in `docs/drift.md` share one root cause: the CLI is
stateless. Every fresh terminal needs `--url` + `--token` (or shell exports), every
gateway restart mints a new secret that invalidates every old token, and the only
way to open all doors was a dev-only script (`scripts/start-gateway.mjs`) that used
a *different* data-dir (`./data`) than the CLI (`.agentide/data`) — so tokens minted
against one gateway died on the other.

- **D-112 (Low):** no config file → operator repeats `--url`/`--token`/exports per terminal.
- **D-113 (Low):** CLI output missing trailing newline on exit paths → prompt glues to output.
- **D-114 (Low):** multi-port operational tax → 4 doors, per-door flags, secret rotation on restart.

## Locked Decisions (user, 2026-08-08)

1. Scope: **all four parts** (token persist, retire script, newline flush, `--all-doors`).
2. Token storage: **reuse `~/.config/platform/config.toml`** (the file the CLI already reads via `resolveConfig` — `packages/agentide/src/config.ts:143`). NOT a new `~/.agentiderc`.
3. `scripts/start-gateway.mjs`: **retire it**. `agentide start --all-doors --foreground` becomes the one dev bootstrap.

## Parts

### Part 1 — Token auto-save (D-112 core)

**Problem:** `agentide token issue` prints the token; nothing saves it.

**Change:**
- `packages/agentide/src/config.ts`: new `saveConfig(entries, opts)`:
  - Read existing `~/.config/platform/config.toml` if present (reuse `parseConfigFile`).
  - Merge: set `token = <new jwt>`, keep `gateway_url` and unknown keys untouched.
  - Atomic write: tmp file + rename, mode `0600`.
- `packages/agentide/src/cli.ts` `runToken` (`:412`): after `issueToken`, call `saveConfig({ token })`.
  - New `--no-save` flag: skip the write (scripting).
  - On write failure: warn on stderr, still exit 0 (token already printed — saving is a convenience).

**Result:** mint once → `agentide invoke ...` / `agentide sessions` just work in every terminal.
Fresh mint overwrites the stale token → the `GATEWAY_TOKEN_INVALID` treadmill dies.

**Tests** (`config.test.ts`, `cli.test.ts`):
- saveConfig merges, preserves `gateway_url`, writes 0600, atomic (no partial file).
- `token issue` → config file contains token; `resolveConfig` reads it back.
- `token issue --no-save` → no file change.
- Save failure → stderr warn, exit 0, token on stdout.

### Part 2 — Retire `scripts/start-gateway.mjs` (D-114 data-dir half)

**Problem:** script hardcodes `dataDir: './data'` (`start-gateway.mjs:66`) vs CLI default
`./.agentide/data` (`cli.ts:235`). Two gateways, two secrets, every token dies on the other.

**Change:**
- Delete `scripts/start-gateway.mjs`.
- `package.json` (`:12-13`): remove `gateway` / `gateway:log` scripts.
- Delete `packages/agentide/src/__tests__/dev-bootstrap.test.ts` — it only tests the script
  and is 2 of the pre-existing failing tests (CID:dev-bootstrap-001/003).
- Repoint references:
  - `packages/agentide/src/start.ts` comments (`:30`, `:262`) → `agentide start --all-doors --foreground`.
  - `packages/agentide/src/cli.ts:46` comment.
  - `packages/agentide/scripts/simulate-cli-consumer.mjs:25` — boot gateway via `agentide start`.
  - `docs/features/cjs-sdk-bootstrap/{PRD-TRD,IMPL}` — update bootstrap commands.
  - `docs/architecture/Agentide.md` §15 if it names the script.
  - `packages/agentide/dist/*.d.ts` are build artifacts — regenerated, not hand-edited.
- Doc: `agentide start --all-doors --foreground` is THE dev bootstrap (help text + `buildHelp`).

### Part 3 — Newline flush (D-113)

**Problem:** some exit paths don't end stdout with `\n` → shell prompt glues to last output.

**Change:** safety net in `runCli` (`cli.ts:219`): before returning a result, if stdout
is non-empty and does not end with `\n`, append one. One point covers every path.

**Tests:** a command whose stdout lacks trailing newline → returned stdout ends with `\n`.
Success + error paths.

### Part 4 — `--all-doors` flag (D-114 door half)

**Problem:** opening all 4 client doors needs 3 separate flags.

**Change:** `packages/agentide/src/start.ts` CID:start-015: `--all-doors` sets the defaults —
MCP 7100 (on), WS 7300 (on), SDK 7350 (`--port-sdk` default), REST 7400
(`--adapter-rest-port` default). Dashboard stays opt-in via `--dashboard-port`
(UI, not a client door). Explicit per-door flags still override.

**Tests** (`start.test.ts`, `--port-sdk` pattern):
- `--all-doors` → factory called with adapterMcp on, adapterWs on, backendRuntimePort 7350, adapterRestPort 7400.
- `--all-doors --port-sdk 7400` → exit 2 (collision).
- absent → unchanged (doors closed except MCP/WS defaults).

### Part 5 — Close the drifts + log

- `docs/drift.md`: move **D-112, D-113, D-114** to Resolved with `Verified by:` trail.
  Header: Open 36 → 33, Resolved 63 → 66.
- `docs/CONTEXT.md`: decisions-log entry (2026-08-08 — cli-ops-ergonomics).
- Handoff doc in `docs/handoff/` (root repo, per AGENTS.md).

## Files Touched

| File | Action |
| --- | --- |
| `packages/agentide/src/config.ts` | add `saveConfig` |
| `packages/agentide/src/cli.ts` | token save hook, `--no-save`, newline safety net, help text |
| `packages/agentide/src/start.ts` | `--all-doors`, comment updates |
| `packages/agentide/src/__tests__/config.test.ts` | saveConfig tests |
| `packages/agentide/src/__tests__/cli.test.ts` | token-save + newline tests |
| `packages/agentide/src/__tests__/start.test.ts` | `--all-doors` tests |
| `packages/agentide/src/__tests__/dev-bootstrap.test.ts` | **delete** |
| `scripts/start-gateway.mjs` | **delete** |
| `package.json` | remove gateway scripts |
| `packages/agentide/scripts/simulate-cli-consumer.mjs` | boot via `agentide start` |
| `docs/drift.md` | resolve D-112/113/114 |
| `docs/CONTEXT.md` | decision-log entry |
| `docs/features/cjs-sdk-bootstrap/*` | command updates |
| `docs/architecture/Agentide.md` | §15 if it names the script |
| `docs/handoff/` | handoff doc (root repo) |

## Commit Sequence (one green commit per part)

1. `feat(cli): save token to config on \`agentide token issue\` (--no-save opt-out)`
2. `chore(scripts): retire start-gateway.mjs — agentide start --all-doors is the dev bootstrap`
3. `fix(cli): ensure stdout ends with newline on every exit path`
4. `feat(cli): add --all-doors flag to \`agentide start\``
5. `chore(drift): resolve D-112, D-113, D-114 (cli-ops-ergonomics)`

## Notes / Known Constraints

- `pnpm install`/`pnpm build` broken pre-existing (`packages/__tests__` references
  `@types/node@workspace:*`) → build via direct `npx tsc --build` + `npx esbuild`
  (same workaround as `548c5b6`). Bundle rebuild for global CLI:
  `npx esbuild src/bin.ts --bundle --platform=node --target=node20 --format=cjs
  --outfile=dist/bin.bundled.cjs --define:CLI_VERSION='"0.5.0-patch"'
  --banner:js='#!/usr/bin/env node'`
- Pre-existing failing tests NOT in scope: `integration.test.ts` (2), `release-yml-005`,
  `consumer-ux` wrong-door — verified failing on main before this pack; dev-bootstrap
  failures disappear with the file deletion (Part 2).
- Drift-skill rule: resolved entries keep `Verified by:` (commit hash + test counts).
- AGENTS.md rule -1: `scripts/start-gateway.mjs` deletion is explicit user lock (#3 above).
