# @spanexx/platform-capabilities

Registers the 25 built-in platform caps: `session.*` (5, owner `session-manager`), `capability.*` (2, owner `capability-registry`), `tenant.*` + `auth.*` + `gateway.*` (12, owner `gateway`), `plugin.*` (6, owner `plugin-manager`), `system.*` (3). Each cap declares `tier: 'read' | 'write'` and `permissions: ['platform.<domain>.<read|write>']`.

## install

```bash
npm install @spanexx/platform-capabilities
```

## usage

```typescript
import { registerPlatformCapabilities } from '@spanexx/platform-capabilities';

// inside createGateway():
registerPlatformCapabilities(capabilityRegistry);
```

## public surface

- `registerPlatformCapabilities(registry)` — registers all 25 caps in one call
- `DASHBOARD_CAPS` — list of `dashboard.view.*` cap names (session-less add-ons)
- `SESSION_LESS_CAPABILITIES` — caps that don't require a session id

## what caps are exposed

| namespace | count | owner | tier | permission |
|---|---|---|---|---|
| `session.*` | 5 | session-manager | read/write | `platform.session.<r|w>` |
| `capability.*` | 2 | capability-registry | read | `platform.capability.read` |
| `tenant.*` | 4 | gateway | write | `platform.tenant.write` |
| `auth.*` | 2 | gateway | write | `platform.auth.write` |
| `gateway.*` | 6 | gateway | read/write | `platform.gateway.<r|w>` |
| `plugin.*` | 6 | plugin-manager | read/write | `platform.plugin.<r|w>` |
| `system.*` | 3 | platform-capabilities | read | `platform.system.read` |

## integration

depends on capability-registry. called by gateway-core's `createGateway()` to bootstrap the kernel.