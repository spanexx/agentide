# @platform/gateway-core

The control-plane kernel — every capability invocation (from MCP, REST, CLI, WebSocket adapters) flows through `Gateway.handleInvocation`. The Gateway authenticates the caller, authorizes the capability, manages the session, dispatches to the handler, audits every invocation, applies rate limits, and enforces tenant isolation. It does not execute capability logic — that lives in plugins and SDKs.

This is the package that wraps every other control-plane component (Event Bus, Capability Registry, Session Manager, Plugin Manager) into one canonical entry point. Adapters call `handleInvocation(req) → response` and never have to know about auth, sessions, or dispatch.

## Install

Workspace dependencies on `@platform/event-bus`, `@platform/capability-registry`, `@platform/session-manager`, `@platform/plugin-manager`. Node built-ins for crypto (HS256 JWT signing) and `node:fs/promises` for persistence.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import { createSessionManager } from "@platform/session-manager";
import { createPluginManager } from "@platform/plugin-manager";
import { createGateway } from "@platform/gateway-core";

const bus = createEventBus();
const registry = createCapabilityRegistry(bus);
const sm = createSessionManager(bus);
const pm = await createPluginManager(bus, registry, { fs, clock });

const gateway = await createGateway(bus, registry, sm, pm, {
  fs,                                  // file seam (tests pass InMemoryFs)
  auditLogPath: "/data/audit.log",     // append-only JSONL
  tenantsPath: "/data/tenants.json",
  secretPath: "/data/gateway-secret",  // base64-encoded HS256 secret, mode 0600
  handlerTimeoutMs: 30_000,
  rateLimit: { capacity: 100, tokensPerSecond: 50 },
});

// Canonical invocation — every adapter translates to this shape.
const response = await gateway.handleInvocation({
  token,                                // JWT issued via gateway.issueToken(...)
  capability: { name: "session.create" },
  input: { ownerId: "agent-1", adapterType: "mcp" },
});
// response is { output: SessionRecord } OR { error: GatewayErrorPayload }.
```

## Contract

- The kernel pipeline (per invocation): validate request → verify JWT (HS256) → check tenant state → rate-limit (keyed by `(tenantId, callerId)`) → session requirement → capability resolve → authz (tier-hierarchy: `read` < `write`, wildcard `platform.*.read` covers every read-tier platform cap) → dispatch → audit + event.
- Caller identity comes from the **verified JWT claims**, not from any `caller` field the caller may pass. The kernel overrides passed-in caller with verified claims and rejects if they disagree.
- Tenants: every token's `sub` is `{tenantId, callerId}`. Every audit record and rate-limit bucket carries `tenantId`. The Gateway refuses any cross-tenant operation. v1 ships full tenant lifecycle (`createTenant`, `listTenants`, `suspendTenant`, `deleteTenant`).
- Errors are stable, structured `{code, message, details, retryable}`. Codes are one of 16 constants (e.g. `GATEWAY_AUTH_FAILED`, `GATEWAY_TENANT_MISMATCH`, `GATEWAY_INSUFFICIENT_SCOPE`, `GATEWAY_CAPABILITY_NOT_FOUND`, `GATEWAY_HANDLER_TIMEOUT`). Callers match on `.code`.
- Audit log is append-only JSONL at `${auditLogPath}`. Every invocation (ok, denied, error) produces one record. Mirrored on the Event Bus as `gateway.invocation`. File write failures don't break the invocation (best-effort).
- Dispatch routes by `owner` prefix: `gateway` / `session-manager` / `plugin-manager` / `capability-registry` / `platform-*` → in-process handlers (gateway-built-ins). `plugin:<id>` runtime plugins → in-process via Plugin Manager. `backend-sdk-*` → returns `GATEWAY_SDK_UNREACHABLE` (reserved for the future Backend Runtime + SDK pack).
- Default handler timeout is 30s, configurable. Handlers that don't return in time get `GATEWAY_HANDLER_TIMEOUT`; the handler itself is allowed to finish (the response is discarded, not awaited).

## Public surface

| Export | Kind |
|---|---|
| `createGateway` | factory (async) |
| `Gateway` | interface (`handleInvocation`, `registerAdapter`, `unregisterAdapter`, `issueToken`, `createTenant`, `listTenants`, `suspendTenant`, `deleteTenant`, `status`) |
| `Adapter` | interface (`name`, `start`, `stop`) |
| `CanonicalInvocation` / `CanonicalResponse` | interface (the canonical invocation packet) |
| `CallerIdentity` / `TokenClaims` / `IssueTokenRequest` | interfaces (auth surface) |
| `AuditRecord` / `GatewayErrorPayload` / `GatewayStatus` | interfaces (audit + status) |
| `TenantRecord` / `CreateTenantRequest` | interfaces (tenant lifecycle) |
| `RateLimitBucketConfig` | interface |
| `GatewayError` | typed error class |
| `ERROR_CODES` | 16 stable error-code constants |
| `issueToken` / `verifyToken` | functions (HS256 JWT) |
| `Clock` / `FileSystem` | interfaces (testability seams) |

## Design references

- PRD: [docs/features/gateway-core/PRD-gateway-core.md](../../docs/features/gateway-core/PRD-gateway-core.md)
- TRD: [docs/features/gateway-core/TRD-gateway-core.md](../../docs/features/gateway-core/TRD-gateway-core.md)
- FLOW: [docs/features/gateway-core/FLOW-gateway-core.md](../../docs/features/gateway-core/FLOW-gateway-core.md)
- IMPL: [docs/features/gateway-core/IMPL-gateway-core.md](../../docs/features/gateway-core/IMPL-gateway-core.md)
- GRILL: [docs/features/gateway-core/GRILL-gateway-core.txt](../../docs/features/gateway-core/GRILL-gateway-core.txt)
- EXPLAINED: [docs/features/gateway-core/EXPLAINED-gateway-core.txt](../../docs/features/gateway-core/EXPLAINED-gateway-core.txt)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Gateway*, *Capability Invocation*, *Tenant*, *Audit Log*