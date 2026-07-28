# @platform/platform-capabilities

Single source of truth for every platform capability the kernel exposes — `session.*`, `tenant.*`, `capability.*`, `gateway.*`, `auth.token.*`, `plugin.*`, `system.*` (25 caps total). Each capability is registered with the Capability Registry under the **owner of the module that owns it** (Session Manager, Capability Registry, Plugin Manager, or the gateway itself), with a permission declared as `platform.<domain>.<read|write>`.

This package is a registration seam only — it owns the *shape* of every platform capability (name, version, permissions, description, owner) but does not own the handler implementations. Handlers stay in the kernel package because they touch in-process state (Plugin Manager, audit log, secret). The kernel calls `registerPlatformCapabilities(registry)` once at boot; the registry's diff handles the migration from older code that registered everything under `owner="gateway"`.

## Install

Workspace dependency on `@platform/capability-registry`. No external runtime dependencies.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { registerPlatformCapabilities } from "@platform/platform-capabilities";

const bus = createEventBus();
const registry = createCapabilityRegistry(bus);

await registerPlatformCapabilities(registry);
// 25 CapabilityRecord entries now registered under:
//   - gateway              (12 caps: tenant.*, gateway.*, auth.token.*, system.*)
//   - session-manager      (5 caps)
//   - capability-registry   (2 caps)
//   - plugin-manager       (6 caps)
```

That's the entire public API. The function is the package.

## Contract

- `registerPlatformCapabilities(registry)` performs **four `register` calls**, one per owner. This is intentional — the registry's `register` diffs per-owner and does not release records held by other owners. A single `register` with all 25 caps under one owner would fail the cross-owner collision check on upgrade from pre-registration code.
- The first call re-registers `gateway` with only the 12 caps it legitimately owns. On upgrade from pre-`@platform/platform-capabilities`, the registry's diff removes the 7 legacy caps under `gateway` whose owners have moved (5 `session.*` + 2 `capability.*`) from the global store.
- Subsequent calls register `session-manager` (5), `capability-registry` (2), and `plugin-manager` (6) — each with no global collision risk.
- Every call is idempotent on restart (the diff is empty after the first run).
- All 25 caps use `version: "1.0.0"`. Permission naming is the read/write split: write caps declare `platform.<domain>.write`; read caps declare `platform.<domain>.read`. The wildcard `platform.*.read` covers every read-tier platform cap via the authz tier-hierarchy.
- This package adds **no new types or constants** beyond `registerPlatformCapabilities` itself — it's a single function. The capability shapes, error codes, and permission strings are defined and exported from `@platform/gateway-core`.

## Public surface

| Export | Kind |
|---|---|
| `registerPlatformCapabilities` | function (registers the 25-cap manifest in 4 owner-grouped calls) |

## Design references

- PRD: [docs/features/platform-capabilities/PRD-platform-capabilities.md](../../docs/features/platform-capabilities/PRD-platform-capabilities.md)
- TRD: [docs/features/platform-capabilities/TRD-platform-capabilities.md](../../docs/features/platform-capabilities/TRD-platform-capabilities.md)
- FLOW: [docs/features/platform-capabilities/FLOW-platform-capabilities.md](../../docs/features/platform-capabilities/FLOW-platform-capabilities.md)
- IMPL: [docs/features/platform-capabilities/IMPL-platform-capabilities.md](../../docs/features/platform-capabilities/IMPL-platform-capabilities.md)
- GRILL: [docs/features/platform-capabilities/GRILL-platform-capabilities.txt](../../docs/features/platform-capabilities/GRILL-platform-capabilities.txt)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Platform Capability*, *Owner*, *Tier*