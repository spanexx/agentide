# PRD: Platform Capabilities

## Status

- Type: Product requirements document
- Audience: Platform engineering, plugin authors, operators
- Scope: Ship `@platform/platform-capabilities` package with 25 platform capabilities (16 migrated from gateway-core + 9 new), under their real owners, with a clean read/write permission split.

## Summary

The platform itself exposes a small, well-defined set of **platform capabilities** — built-in actions that manage the platform itself. Examples: "list sessions," "install a plugin," "show me the platform version." Today, gateway-core ships 16 of these but registers them all under owner `gateway`, which makes the `owner` field meaningless for filtering. BI[6] ships a new package `@platform/platform-capabilities` that:

1. **Migrates** the 16 existing caps under their real owners (`session-manager`, `capability-registry`, `gateway`).
2. **Adds** 9 new caps: `plugin.*` (6) and `system.*` (3).
3. **Standardizes** permissions: every write-cap declares `platform.<domain>.write`; every read-cap declares `platform.<domain>.read`. The wildcard `platform.*.read` covers every read-tier cap.

After BI[6], the kernel and the platform capabilities live in separate packages (per PHILOSOPHY §Nothing Is Special), operators can mint read-only tokens with one scope, and the `owner` field on a Capability Record means what it says.

## Problem

Without this pack, three real gaps hold the platform back:

1. **Owner string lies.** A query for `capability.list --owner session-manager` returns nothing, because every session cap was registered with `owner: "gateway"` by gateway-core. Operators can't filter caps by the team/module that owns them.
2. **Plugin capabilities aren't reachable.** The Plugin Manager pack (`@platform/plugin-manager`) ships handlers for `plugin.install`, `plugin.list`, etc., but never registered them as platform capabilities. The `agentide plugin list` CLI calls `pluginManager.list()` directly. An MCP agent calling `tools/list` doesn't see `plugin.*` and can't invoke it. **The CLI and an agent see different platforms.**
3. **Permission naming is inconsistent.** `platform.session.create` (an action name) coexists with `platform.session.read` (a tier name). Operators can't mint a read-only token without listing every read cap individually.

## Goals

1. **Operators can list platform caps by owner.** `agentide capability list --owner session-manager` returns exactly the `session.*` caps.
2. **Operators can list platform caps by tier.** `agentide capability list --tier read` returns every read-cap.
3. **Operators can mint a read-only token in one scope.** `agentide token issue --scope platform.*.read --tenant acme --caller dashboard-bot` produces a token that can list every read-tier cap but can't write to any.
4. **Plugin management is reachable from any adapter.** `tools/call plugin.install --source ./x.yaml` works the same as the CLI.
5. **The kernel package stays small.** All platform-cap registration moves out of gateway-core into `@platform/platform-capabilities`. gateway-core's `factory.ts` shrinks.

## Non-Goals

- **`runtime.*` (platform-owned runtime management) — punted.** No Runtime Manager exists in v1. Reserved for a future pack.
- **`marketplace.*` — BI[16].**
- **`dashboard.*` — BI[13].**
- **Tenant-scoped plugin list — punted to BI[7] permission-tiering.** Today's `plugin.list` returns all plugins on the platform.
- **Multi-process / distributed health check.** `system.health` always returns `{status: "ok"}` in v1 single-process. "Degraded" path deferred to v2.
- **`system.version` exposing commit hash.** Returns semver only in v1; `buildHash` field reserved but always null.

## Canonical Product Language

Uses existing terms from CONTEXT.md: **Platform Capability** (`type: platform`), **Capability** (smallest invocable unit), **Owner** (the module that built the capability), **Tier** (`read` / `write` / `act` / `destructive`).

New terms introduced:

- **Platform capability category**: one of `session`, `tenant`, `capability`, `gateway`, `auth.token`, `plugin`, `system`. The category determines the owner string and the permission namespace (`platform.<category>.<tier>`).
- **Tier wildcard**: a scope like `platform.*.read` that matches every read-tier platform cap via the authz tier-hierarchy.

## Product Scope

### The 25 caps

**Migrated from gateway-core (16 — owner renamed):**

| Cap | Owner (new) | Permission (new) | Tier |
|---|---|---|---|
| `session.create` | `session-manager` | `platform.session.write` | write |
| `session.resume` | `session-manager` | `platform.session.write` | write |
| `session.destroy` | `session-manager` | `platform.session.write` | write |
| `session.touch` | `session-manager` | `platform.session.write` | write |
| `session.list` | `session-manager` | `platform.session.read` | read |
| `tenant.create` | `gateway` | `platform.tenant.write` | write |
| `tenant.list` | `gateway` | `platform.tenant.read` | read |
| `tenant.suspend` | `gateway` | `platform.tenant.write` | write |
| `tenant.delete` | `gateway` | `platform.tenant.write` | write |
| `capability.list` | `capability-registry` | `platform.capability.read` | read |
| `capability.describe` | `capability-registry` | `platform.capability.read` | read |
| `gateway.status` | `gateway` | `platform.gateway.read` | read |
| `gateway.metrics` | `gateway` | `platform.gateway.read` | read |
| `gateway.configuration` | `gateway` | `platform.gateway.read` | read |
| `auth.token.issue` | `gateway` | `platform.token.write` | write |
| `auth.token.revoke` | `gateway` | `platform.token.write` | write |

**New in BI[6] (9):**

| Cap | Owner | Permission | Tier | Description |
|---|---|---|---|---|
| `plugin.list` | `plugin-manager` | `platform.plugin.read` | read | List installed plugins |
| `plugin.install` | `plugin-manager` | `platform.plugin.write` | write | Install from local source |
| `plugin.uninstall` | `plugin-manager` | `platform.plugin.write` | write | Uninstall + cleanup |
| `plugin.enable` | `plugin-manager` | `platform.plugin.write` | write | Enable a disabled plugin |
| `plugin.disable` | `plugin-manager` | `platform.plugin.write` | write | Disable without uninstall |
| `plugin.reload` | `plugin-manager` | `platform.plugin.write` | write | Re-read source from disk |
| `system.info` | `gateway` | `platform.system.read` | read | Platform name + version |
| `system.version` | `gateway` | `platform.system.read` | read | Same as info (semver only) |
| `system.health` | `gateway` | `platform.system.read` | read | `{status: "ok"}` in v1 |

### Operator flow

```
$ agentide capability list --owner session-manager
- session.create         (platform.session.write)
- session.resume         (platform.session.write)
- session.destroy        (platform.session.write)
- session.touch          (platform.session.write)
- session.list           (platform.session.read)

$ agentide token issue --tenant acme --caller dashboard-bot --scope platform.*.read
# JWT with scope=platform.*.read — covers every read-tier cap, denies every write-tier cap.
```

### Agent flow (via MCP, when BI[9] ships)

```
> tools/list
  plugin.list          (platform.plugin.read)
  plugin.install       (platform.plugin.write)
  system.health        (platform.system.read)
  ... (all 25)

> tools/call system.health
  { status: "ok" }

> tools/call plugin.install --source ./browser.yaml
  { id: "browser", version: "1.0.0" }
```

## Acceptance Criteria

| AC | What | How verified |
|---|---|---|
| AC-1 | The 16 migrated caps appear in `capabilityRegistry.list()` under their new owners. | Test: list caps and assert `owner === "session-manager"` for all `session.*` etc. |
| AC-2 | The 9 new caps appear in `capabilityRegistry.list()` with `type: "platform"`. | Test: list and assert presence of all 9. |
| AC-3 | `handleInvocation({capability: "plugin.install", input: {source: "./x.yaml"}})` routes through the dispatcher's `plugin-manager` path and invokes `pluginManager.install()`. | Test: call through a real Gateway end-to-end. |
| AC-4 | A token with scope `["platform.*.read"]` can invoke `session.list`, `tenant.list`, `capability.list`, `gateway.status`, `plugin.list`, `system.info`, `system.version`, `system.health`, but is denied `session.create`, `plugin.install`, etc. | Test: mint such a token, invoke one of each tier, assert ok/denied. |
| AC-5 | gateway-core's `factory.ts` no longer contains `registerGatewayCapabilities`; the equivalent lives in `@platform/platform-capabilities`. | grep + test asserting registration count. |
| AC-6 | The `agentide capability list --owner session-manager` CLI command works (added in BI[6]). | CLI test. |
| AC-7 | All 242 existing tests still pass; 9+ new tests added. | Full suite green. |

## Out of Scope (explicit)

- Adapter integration (MCP, REST, WS) — separate packs (BI[9], BI[10], BI[24]).
- Tenant-scoped capability filtering — BI[7] permission-tiering.
- `runtime.*` capabilities (platform-owned runtime management) — needs a Runtime Manager pack that doesn't exist.
- Streaming or async invocations — v1 sync only (CONTEXT.md Q11).

## Open Questions

- (none — all resolved in grill session 2026-07-28)