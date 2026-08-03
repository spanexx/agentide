# Q2 — Command surface

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (2026-08-03; Q2 locked — generic `invoke` + aliases)
**Blocks:** Q3 (config UX), Q4 (output + watch)

## Question

What commands does the Rust CLI expose in v1? The docs disagree on this —
that's what the question settles.

- Agentide §8 lists curated examples: `platform capabilities`, `platform
  sessions`, `platform browser`, `platform plugins`.
- Platform_Capabilities.md §CLI lists `plugin.install`, `plugin.list`,
  `gateway.status`, calling it "not a customer-facing CLI command."
- Both are *examples* — neither is a frozen list.

Q1 just locked the underlying transport (WS adapter) and language (Rust) and
write scope (reads + writes). The question is now: how do users *invoke*
those capabilities from the terminal?

## What I know

- The platform's interaction model is "everything accessed through
  capabilities" (Platform_Capabilities.md:43-50).
- The websocket-adapter wire is `{type:"invoke", correlationId, name, input?,
  sessionId?, mode:"call"|"stream"}` → `{type:"invoke.result"|"invoke.error",
  correlationId, output|error}` (locked W4).
- A single generic `invoke` command can reach every capability (current
  + future) without new CLI code.
- Curated aliases (e.g. `platform sessions` → `invoke session.list`) keep the
  §8 spirit (memorable words) without freezing a list.
- Writes include `session.create`, `session.suspend`, `plugin.install`,
  `plugin.uninstall`, `tenant.create`, `gateway.configuration` — authz
  already gates them.

## Sub-questions

1. Underlying shape: generic `invoke`, OR per-capability subcommands?
2. Aliases: which common admin calls get ergonomic aliases (and which don't)?
3. List of v1 aliases (with the capability each one maps to) — confirm
   coverage vs §8 / Platform_Capabilities.md examples.

## Resolution must record

The underlying shape, the alias list with their backing capabilities, and the
acceptance bar for adding a new alias vs telling the user to call `invoke`
directly. `delivery:` tag not needed on this ticket — the route is already
`feature-pipeline` per Q1's resolution.

## Resolution (locked 2026-08-03, autonomous under user delegation)

1. **Underlying shape = one generic `invoke`:**
   ```
   platform invoke <capability> [--args '<json>'] [--session <id>]
   ```
   Maps 1:1 to the locked wire `{type:"invoke", name: <capability>, input,
   sessionId?, mode:"call"}` — the wire key is `name` per adapter W4; the
   CLI's `<capability>` positional maps onto it. JSON `--args` is the input
   payload (default `{}`). Reaches every capability —
   current and future — with no CLI code changes.

2. **Aliases = ergonomic shortcuts for the common admin calls.** Aliases
   never freeze a list; the capability layer IS the surface. New aliases
   are additive; new capabilities don't need new aliases.

3. **v1 aliases (locked):**
   | Alias | Maps to | Why |
   |-------|---------|-----|
   | `platform capabilities` | `capability.list` | §8's `platform capabilities` example; discoverability. |
   | `platform sessions` | `session.list` | §8's `platform sessions` example; active session visibility. |
   | `platform plugins` | `plugin.list` | §8's `platform plugins` example; installed-plugin visibility. |
   | `platform status` | `gateway.status` | Platform_Capabilities.md §CLI's `gateway.status` example; one-shot health check. |
   | `platform health` | `system.health` | §14 Runtime Health view; same data as the dashboard's Health panel. |

   Aliases accept the same `--session`, `--args`, `--json`, `--watch` flags
   as `invoke` — they just pre-fill `capability` + sensible default `--args`
   (usually `{}`).

4. **Acceptance bar for adding a new alias:** the capability must be
   (a) read-or-write at *any* tier (no client-side restriction — capability
   layer authz handles it), (b) clearly named in the docs as a frequent
   admin call, (c) ergonomic benefit over `platform invoke <capability>`
   (i.e. the user types it often enough to memorize). Aliases are additive;
   no alias is removed without a deprecation note in CHANGELOG.

5. **Out of v1 aliases (deferred):** `platform browser` (§8 example, but
   browser-runtime has many caps and no obvious single-arg default — point
   users at `invoke browser.*`), `platform install <plugin-id>` (write,
   needs careful UX — could be a future alias, not v1).

## Consequences

- The CLI's Rust command parser handles a flat list of subcommands
  (`invoke`, `capabilities`, `sessions`, `plugins`, `status`, `health`) plus
  flags.
- Aliases are dispatched as `invoke <backing-capability>` with default args
  — single code path for execution.
- Capability list lives in the platform (gateway-core's `capability.list`),
  not the CLI — adding a capability does not require a CLI release.