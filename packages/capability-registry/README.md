# @platform/capability-registry

In-process catalog of every capability (business / platform / runtime) the platform knows about. Pure discovery — no execution, no auth, no routing.

Used by every component that needs to ask "what capabilities exist?" and "what's the contract for calling X?" — the Gateway resolves invocations against it, the meta-package's CLI lists and describes from it, and the Event Bus's lifecycle events fan out through it as capability manifests are registered and removed.

## Install

Workspace dependency on `@platform/event-bus`. No external runtime dependencies.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";

const bus = createEventBus();
const registry = createCapabilityRegistry(bus);

// Register one owner's manifest. Cross-owner name collisions throw.
const result = await registry.register("acme", {
  owner: "acme",
  capabilities: [
    {
      name: "customer.read",
      version: "1.0.0",
      type: "business",
      description: "Read a customer record by id.",
      permissions: ["customer.read"],
      owner: "acme",
    },
  ],
});
// result.added === [<capability>]; result.removed === []; result.updated === []

// Discover — list returns compact cards; describe returns the full record.
const list = registry.list();
const r = registry.describe("customer.read");            // latest version
const r2 = registry.describe("customer.read", "1.0.0");  // specific version
// r.capability is null when the name doesn't exist; r.capability is the full record when it does.
```

## Contract

- `register(owner, manifest)` diffs against that owner's previous state and returns `{added, updated, removed}`. Re-registering on restart with the same manifest is a no-op (all three arrays empty).
- `register` throws on a cross-owner collision — the same `(name, version)` cannot appear under two different owners. Migrating an existing capability to a new owner requires a deliberate two-phase `register` (one to remove from the old owner, one to add to the new).
- `list()` returns compact `CapabilityCard[]` (name + version + type + description). No `owner`, no `inputSchema`/`outputSchema`.
- `describe(name, version?)` returns `{capability, selectedVersion, note?}`. With no version, returns the latest registered version; with a version, returns that exact one.
- `search(query)` filters by case-insensitive substring across name, description, and owner.
- Capability types: `"business"` (apps), `"platform"` (kernel/platform), `"runtime"` (runtime plugins). The type is part of the manifest and never inferred.
- Lifecycle events (`capability.registered`, `capability.updated`, `capability.removed`) are emitted on the Event Bus for every diff entry.

## Public surface

| Export | Kind |
|---|---|
| `createCapabilityRegistry` | factory |
| `CapabilityRegistry` | interface (`register`, `list`, `search`, `describe`) |
| `CapabilityRecord` | interface (full record with permissions + owner) |
| `CapabilityCard` | interface (compact list view) |
| `CapabilityType` | type (`"business" \| "platform" \| "runtime"`) |
| `DescribeResult` | interface (capability + selectedVersion + optional note) |
| `RegisterResult` | interface (added / updated / removed diff) |
| `UpdatedRecord` | interface (previous + current for an updated capability) |

## Design references

- PRD: [docs/features/capability-registry/PRD-capability-registry.md](../../docs/features/capability-registry/PRD-capability-registry.md)
- TRD: [docs/features/capability-registry/TRD-capability-registry.md](../../docs/features/capability-registry/TRD-capability-registry.md)
- FLOW: [docs/features/capability-registry/FLOW-capability-registry.md](../../docs/features/capability-registry/FLOW-capability-registry.md)
- IMPL: [docs/features/capability-registry/IMPL-capability-registry.md](../../docs/features/capability-registry/IMPL-capability-registry.md)
- GRILL: [docs/features/capability-registry/GRILL-capability-registry.txt](../../docs/features/capability-registry/GRILL-capability-registry.txt)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Capability*, *Capability Registry*