# @platform/agentide

Meta-package — composes every Tier 1 control-plane component plus `@platform/gateway-core` into one started Platform handle, and ships the `agentide` CLI for operator day-2 operations.

`createPlatform(config)` is the entry point: pass it a filesystem seam, a data directory, and an optional default tenant; get back a wired Platform (EventBus, Capability Registry, Session Manager, Plugin Manager, Gateway). The CLI subcommands (`agentide init / status / tenant / token / capability / plugin`) spin up a Platform from on-disk state, operate, tear down — so the same factory that powers the long-lived daemon also powers the operator shell.

## Install

Workspace dependencies on `@platform/event-bus`, `@platform/capability-registry`, `@platform/session-manager`, `@platform/plugin-manager`, `@platform/gateway-core`. No external runtime dependencies.

## Usage

```ts
import { createPlatform } from "@platform/agentide";

// Programmatic use (e.g. a custom boot script or integration test)
const platform = await createPlatform({
  fs,                                   // production uses node:fs/promises; tests pass InMemoryFs
  dataDir: "/data",
  defaultTenant: { id: "default", name: "Default" },  // idempotent on re-init
});
// platform.gateway.handleInvocation(...) — call any capability
// platform.stop() — idempotent

// CLI (production install via install.sh; one binary, one entry point)
//
//   agentide init --data-dir ~/.agentide/data --default-tenant acme
//   agentide status
//   agentide tenant {create|list|suspend|delete}
//   agentide token issue --tenant <id> --caller <id> --scope <csv>
//   agentide capability {list|describe --name <n>} [--owner <o>] [--tier <read|write>]
//   agentide plugin list
```

## Contract

- `createPlatform(config)` is async because the inner `createPluginManager` factory is async (it reads the install record file at startup and re-installs persisted plugins). Everything else composes synchronously around it.
- `dataDir` defaults all file paths: `${dataDir}/tenants.json`, `${dataDir}/audit.log`, `${dataDir}/gateway-secret`, `${dataDir}/plugins/installed.json`. Each is overridable in `config`.
- `defaultTenant` is **optional and idempotent** — provided AND the tenant does not already exist, it is created. Pass this from `agentide init` only; other subcommands omit it to avoid leaking a fake `default` tenant into a freshly-init'd install.
- `platform.stop()` is idempotent (callable multiple times). Currently a no-op pending future adapter cleanup / audit flush; reserved as the canonical shutdown seam.
- The CLI's `runCli(argv, opts)` accepts a `FileSystem` so tests can drive it without touching disk. The bin entry point (`dist/cli.js`) reads `process.env.AGENTIDE_DATA_DIR` (default `./.agentide/data`).
- The meta-package depends on every Tier 1 component but **does not register a default adapter** — per PHILOSOPHY §Tiny Kernel, the kernel does not depend on a transport. Operators wire MCP/REST/WS adapters via `gateway.registerAdapter()` from their own boot script.
- Capability filtering via `--owner` and `--tier` on `agentide capability list` is pure client-side filtering over `registry.list()` output. The CLI calls `registry.describe(name)` per card to read `owner` (N+1 perf smell, sub-millisecond for ~30 caps; deferred helper in `registry.listByOwner()`).

## Public surface

| Export | Kind |
|---|---|
| `createPlatform` | factory (async) — composes the full Platform |
| `Platform` | interface (eventBus, capabilityRegistry, sessionManager, pluginManager, gateway, stop) |
| `CreatePlatformConfig` | interface (fs, dataDir, paths, timeouts, rate limits, defaultTenant?) |
| `runCli` | function — argv parser + subcommand dispatch, returns `{exitCode, stdout, stderr}` |
| `CliOptions` / `CliResult` | interfaces (CLI testability seam) |

## Design references

- PRD: [docs/features/gateway-core/PRD-gateway-core.md](../../docs/features/gateway-core/PRD-gateway-core.md) §Phase 7 (the meta-package was scoped under the gateway-core pack)
- TRD: [docs/features/gateway-core/TRD-gateway-core.md](../../docs/features/gateway-core/TRD-gateway-core.md) (the meta-package is part of the gateway-core architecture)
- FLOW: [docs/features/gateway-core/FLOW-gateway-core.md](../../docs/features/gateway-core/FLOW-gateway-core.md)
- IMPL: [docs/features/gateway-core/IMPL-gateway-core.md](../../docs/features/gateway-core/IMPL-gateway-core.md) §Phase 7 + §Phase 8
- GRILL: [docs/features/gateway-core/GRILL-gateway-core.txt](../../docs/features/gateway-core/GRILL-gateway-core.txt) Q12 (distribution + default adapter)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Platform*, *Adapter*