# @spanexx/gateway-core

The kernel pipeline. Single function: `handleInvocation(req) → response`. Auth → rate limit → session check → authz (tier-hierarchy) → version resolve → dispatch (by owner prefix) → audit. Three dispatch paths: `platform-*` in-process, `plugin:<id>` via plugin-manager, `backend-sdk-*` via backend-runtime. No business logic, no execution — pure routing.

## install

```bash
npm install @spanexx/gateway-core
```

## usage

```typescript
import { createGateway } from '@spanexx/gateway-core';

const gateway = await createGateway(eventBus, registry, sessionManager, pluginManager, {
  fs,
  dataDir: './data',
  auditLogPath: './data/audit.log',
  tenantsPath: './data/tenants.json',
  secretPath: './data/gateway-secret',
  handlerTimeoutMs: 30_000,
});
```

## public surface

- `createGateway(...)` → `Gateway` handle
- `gateway.handleInvocation({ caller, session?, capability, input })` — the one function
- `gateway.issueToken({ tenantId, callerId, scope, expectedOrigins? })` → `{ token }` (HS256 JWT, 1h default)
- `gateway.status()` → `{ tenantCount, pluginCount, auditLogBytes, uptimeMs }`
- `gateway.listTenants()` / `createTenant()` / `suspendTenant()` / `deleteTenant()`
- error codes: `GATEWAY_CAPABILITY_NOT_FOUND`, `GATEWAY_PLUGIN_NOT_INSTALLED`, `GATEWAY_SDK_UNREACHABLE`, `GATEWAY_MANAGER_UNAVAILABLE`, `GATEWAY_HANDLER_TIMEOUT`, `GATEWAY_INTERNAL_ERROR`, `GATEWAY_HANDLER_NOT_FOUND`, `GATEWAY_HANDLER_ERROR`

## audit

every invocation writes one JSON line to `./data/audit.log`:
`{ts, caller, session, capability, owner, status, denyReason|errorCode, durationMs}`. input payloads are NOT logged (PII stays in the app). same record emitted on the bus as `gateway.invocation`.

## integration

depends on capability-registry + session-manager + plugin-manager + event-bus + errors + origin. depended on by the agentide meta-package (which composes the full platform) + every adapter (mcp/ws) routes through it.