# @spanexx/capability-registry

Catalog of every capability registered with the platform. discovery + validation only — no execution. The registry is queried by the gateway (routing), adapters (MCP tools/list, WS subscribe), the CLI (`agentide capability list`), and the dashboard (registry view).

## install

```bash
npm install @spanexx/capability-registry
```

## usage

```typescript
import { createCapabilityRegistry } from '@spanexx/capability-registry';

const registry = createCapabilityRegistry(eventBus);
registry.register({
  name: 'product.list',
  version: '1.0.0',
  type: 'business',
  description: 'List active products',
  permissions: [],
  tier: null,
});
```

## public surface

- `createCapabilityRegistry(eventBus)` → `{ register, list, search, describe, resolve }`
- `CapabilityRecord` — full metadata (name, version, type, permissions, tier, owner)
- `CapabilityCard` — slim version for `capability.list` responses
- `CapabilityTier = 'read' | 'act' | 'destructive'`
- `CapabilityType = 'business' | 'platform' | 'runtime'`
- `validateRecord(record)` — throws on bad shape

## when you'll see it

every capability registration flows through here. `gateway.handleInvocation()` calls `registry.describe(name)` to look up the handler's metadata + permissions before dispatch. `sdk-node` / `sdk-browser` register their caps here on connect.

## integration

depends on `@spanexx/event-bus` (publishes `capability.registered` / `unregistered` / `rejected`). depended on by gateway-core (dispatch), platform-capabilities (registers the 25 built-in caps), plugin-manager (registers plugin caps), backend-runtime (registers SDK caps).