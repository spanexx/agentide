/*
 * Code Map: canonical handleInvocation pipeline
 * - handleInvocation: token verify → tenant state → rate-limit → session check → capability resolve → authz → dispatch → audit + event
 *
 * CID Index:
 * CID:handle-001 -> handleInvocation
 * CID:handle-002 -> exitWithError
 *
 * Quick lookup: rg -n "CID:handle-" packages/gateway-core/src/handle-invocation.ts
 */

import type { BackendRuntime } from "@spanexx/backend-runtime";
import type { EventBus } from "@spanexx/event-bus";
import type { CapabilityRegistry } from "@spanexx/capability-registry";
import type { SessionManager } from "@spanexx/session-manager";
import type { PluginManager } from "@spanexx/plugin-manager";
import { checkAuthz } from "./authz.js";
import { dispatchCapability, resolveCapability, type DispatchHandlers } from "./dispatch.js";
import { ERROR_CODES, GatewayError } from "./errors.js";
import { verifyToken } from "./auth.js";
import type { AuditWriter } from "./audit.js";
import { RateLimiter } from "./rate-limit.js";
import { validateJsonSchema } from "./json-schema.js";
import type { TenantStore } from "./tenant-store.js";
import type { ClientService } from "./client-service.js";
import type { MetricsCounter } from "./metrics.js";
import type {
  CanonicalInvocation,
  CanonicalResponse,
  CallerIdentity,
  Clock,
  GatewayErrorPayload,
  YamlValue,
} from "./types.js";

// Per GRILL Q3 / PRD §Product Scope: session-less capabilities are those that don't need a session
// to be invoked. `session.create` and `session.resume` are session lifecycle calls (they CREATE
// the session); `session.list`, `capability.list`, `capability.describe`, `gateway.status`,
// `gateway.metrics`, `gateway.configuration`, `tenant.list` are read-only discovery.
// `session.touch` operates on an existing session but doesn't need it active (it's a no-op for
// a missing session — caller may be calling to "wake up" a session). `session.destroy` and
// capability.*/plugin.* write paths REQUIRE an active session.
// Per GRILL Q3 (gateway-core): session-less caps are session.* lifecycle, read-only discovery,
// and operator token issuance. session.* read + write paths (session.create, session.resume,
// session.touch, session.list) don't carry a sessionId; session.destroy DOES (it operates on
// an existing session). plugin.* write paths (install/uninstall/enable/disable/reload) require
// a session. plugin.list is read-only discovery and is session-less.
const SESSION_LESS_CAPABILITIES: ReadonlySet<string> = new Set([
  "session.create",
  "session.resume",
  "session.touch",
  "session.list",
  "capability.list",
  "capability.describe",
  "plugin.list",
  "gateway.status",
  "gateway.metrics",
  "gateway.configuration",
  "tenant.list",
  "system.info",
  "system.version",
  "system.health",
  "auth.token.issue",
  "auth.token.revoke",
]);

export interface HandleInvocationCtx {
  readonly registry: CapabilityRegistry;
  readonly sessionManager: SessionManager;
  readonly pluginManager: PluginManager;
  readonly tenantStore: TenantStore;
  readonly handlers: DispatchHandlers;
  readonly audit: AuditWriter;
  readonly eventBus: EventBus;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
  readonly handlerTimeoutMs: number;
  readonly secret: Uint8Array;
  readonly backendRuntime?: BackendRuntime;
  readonly tokenLeewayMs?: number;
  // D-46 closeout (2026-08-06): per-gateway metrics counter. Incremented at
  // the canonical exit paths below; read by the gateway.metrics handler.
  readonly metrics?: MetricsCounter;
  // P1 dashboard-core (D2 lock): extra session-less names beyond the kernel
  // set (dashboard.view.* join it via factory config).
  readonly sessionLessCapabilities?: ReadonlySet<string>;
  // BI[29] S4 active revocation (drift 2026-08-05): when a caller is a
  // registered client_credentials identity (callerId starts with `cli_`),
  // handleInvocation must re-check `revoked` after verifyToken and deny with
  // 401 + `error: client_revoked`. Without this check a revoked client's
  // existing JWT keeps working for up to its expiry window. Optional in tests
  // that pre-date the field.
  readonly clientSvc?: ClientService;
}

// CID:handle-001 - handleInvocation
// Purpose: canonical entry point for every capability invocation. Pipeline:
//   1. validate request shape (GATEWAY_INVALID_REQUEST)
//   2. verify JWT (GATEWAY_AUTH_FAILED / GATEWAY_TOKEN_INVALID / GATEWAY_TOKEN_EXPIRED) — the kernel
//      is the trust boundary; adapters pass the bearer token they received, the kernel derives
//      tenantId / callerId / scope from verified claims.
//   3. check tenant state (GATEWAY_TENANT_MISMATCH if missing or suspended)
//   4. rate-limit check (GATEWAY_RATE_LIMIT_EXCEEDED) — bucket keyed by (tenantId, callerId)
//   5. session requirement check (GATEWAY_SESSION_REQUIRED) + session status check (must be "active")
//   6. capability version resolution (auto-latest or pinned)
//   7. authz tier hierarchy (GATEWAY_INSUFFICIENT_SCOPE)
//   8. dispatch
//   9. audit + gateway.invocation event on every exit path
// Used by: every adapter (MCP / REST / CLI / WS) translates inbound requests into a CanonicalInvocation and calls this.
export async function handleInvocation(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
): Promise<CanonicalResponse> {
  const startedAt = ctx.clock.now();

  // (1) Validate request shape — must be done first so malformed requests don't waste a rate-limit token.
  if (typeof req.token !== "string" || req.token.length === 0) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.INVALID_REQUEST,
      message: "request.token is required",
      details: {},
      retryable: false,
    });
  }
  if (!req.capability || typeof req.capability.name !== "string" || req.capability.name.length === 0) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.INVALID_REQUEST,
      message: "request.capability.name is required",
      details: {},
      retryable: false,
    });
  }
  if (req.caller !== undefined) {
    if (typeof req.caller.tenantId !== "string" || typeof req.caller.callerId !== "string" || !Array.isArray(req.caller.scope)) {
      return exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "request.caller must have tenantId, callerId, scope (when present)",
        details: {},
        retryable: false,
      });
    }
  }

  // (2) Verify the JWT — the kernel is the trust boundary. Adapters pass the bearer token they received.
  const verifyResult = verifyToken(req.token, ctx.clock, ctx.secret, { leewayMs: ctx.tokenLeewayMs });
  if (!verifyResult.ok) {
    return exitWithError(req, ctx, startedAt, {
      code: verifyResult.code,
      message: verifyResult.code === "GATEWAY_TOKEN_EXPIRED" ? "token expired" : "token invalid",
      details: {},
      retryable: false,
    });
  }
  const claims = verifyResult.claims;
  // Defense in depth: if the adapter passed `caller`, it must match the verified claims.
  if (req.caller !== undefined) {
    if (req.caller.tenantId !== claims.sub.tenantId || req.caller.callerId !== claims.sub.callerId) {
      return exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.AUTH_FAILED,
        message: "request.caller does not match verified token claims",
        details: {},
        retryable: false,
      });
    }
  }
  const caller: CallerIdentity = {
    tenantId: claims.sub.tenantId,
    callerId: claims.sub.callerId,
    scope: [...claims.scope],
  };

  // (4a) Active revocation (BI[29] S4): a freshly-verified JWT is not enough.
  // If the caller is a registered client_credentials identity (id prefix
  // `cli_`), look up the ClientRecord on disk and reject when revoked.
  // Operator-tooling tokens (mint via `agentide token issue`) carry a
  // callerId that does NOT start with `cli_` — those bypass this check.
  // The lookup is best-effort: a missing record (deleted concurrently) is
  // treated as "not revoked" — the JWT itself is the trust anchor.
  if (ctx.clientSvc !== undefined && caller.callerId.startsWith("cli_")) {
    const record = await ctx.clientSvc.findClientById(caller.callerId);
    if (record !== null && record.revoked) {
      return exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.AUTH_FAILED,
        message: "client revoked",
        details: { callerId: caller.callerId, error: "client_revoked" },
        retryable: false,
      });
    }
  }

  // (5) Tenant state check — must exist, not be suspended.
  const tenant = ctx.tenantStore.get(caller.tenantId);
  if (!tenant) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.TENANT_MISMATCH,
      message: `tenant "${caller.tenantId}" is not registered`,
      details: { tenantId: caller.tenantId },
      retryable: false,
    });
  }
  if (tenant.suspended) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.TENANT_MISMATCH,
      message: `tenant "${caller.tenantId}" is suspended`,
      details: { tenantId: caller.tenantId },
      retryable: false,
    });
  }

  // (6) Tenant isolation check for tenant.suspend, tenant.delete, tenant.list
  if (req.capability.name === "tenant.suspend" || req.capability.name === "tenant.delete" || req.capability.name === "tenant.list") {
    const inputTenantId = typeof req.input === "object" && req.input !== null && "id" in req.input ? String(req.input.id) : null;
    if (inputTenantId !== caller.tenantId) {
      return exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.TENANT_MISMATCH,
        message: `tenant "${inputTenantId}" does not match caller's tenant "${caller.tenantId}"`,
        details: { tenantId: inputTenantId, callerTenantId: caller.tenantId },
        retryable: false,
      });
    }
  }

  // (7) Rate-limit. Bucket keyed by (tenantId, callerId).
  const bucketKey = `${caller.tenantId}:${caller.callerId}`;
  if (!ctx.rateLimiter.tryConsume(bucketKey)) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message: `rate limit exceeded for caller ${caller.callerId}`,
      details: { callerId: caller.callerId, tenantId: caller.tenantId },
      retryable: true,
    });
  }

  // (5) Session requirement + status check.
  const requiresSession = !SESSION_LESS_CAPABILITIES.has(req.capability.name)
    && !(ctx.sessionLessCapabilities?.has(req.capability.name) ?? false);
  if (requiresSession && !req.sessionId) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.SESSION_REQUIRED,
      message: `capability "${req.capability.name}" requires a session`,
      details: { capability: req.capability.name },
      retryable: false,
    });
  }
  if (req.sessionId) {
    let sessionStatus: string | null = null;
    try {
      sessionStatus = ctx.sessionManager.getStatus(req.sessionId);
    } catch {
      sessionStatus = null;
    }
    // Only "active" sessions are valid for capability invocations. "suspended" / "archived" / missing → SESSION_REQUIRED.
    if (sessionStatus !== "active") {
      return exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.SESSION_REQUIRED,
        message: `session "${req.sessionId}" is not active`,
        details: { sessionId: req.sessionId, status: sessionStatus ?? "missing" },
        retryable: false,
      });
    }
  }

  // (6) Resolve capability version.
  const capability = resolveCapability(ctx.registry, req.capability.name, req.capability.version);
  if (!capability) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.CAPABILITY_NOT_FOUND,
      message: `capability "${req.capability.name}" is not registered`,
      details: { capability: req.capability.name, version: req.capability.version ?? null },
      retryable: false,
    });
  }

  // (7) Authz.
  if (!checkAuthz(caller.scope, capability.permissions)) {
    return exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `caller lacks required scope for "${req.capability.name}"`,
      details: {
        capability: req.capability.name,
        requiredPermissions: [...capability.permissions],
        callerScope: [...caller.scope],
      },
      retryable: false,
    });
  }

  // (8) Dispatch.
  let output: YamlValue;
  try {
    if (capability.inputSchema !== undefined) {
      const validation = validateJsonSchema(req.input, capability.inputSchema);
      if (!validation.ok) {
        const errorList: YamlValue = validation.errors.map((e) => ({ path: e.path, message: e.message }));
        await auditError(req, ctx, capability, caller, startedAt, new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          "input does not match capability inputSchema",
          { capability: req.capability.name, errors: errorList },
          false,
        ));
        return {
          error: {
            code: ERROR_CODES.INVALID_REQUEST,
            message: "input does not match capability inputSchema",
            details: { capability: req.capability.name, errors: errorList },
            retryable: false,
          },
        };
      }
    }
    output = await dispatchCapability(capability, req.input, req.sessionId, {
      registry: ctx.registry,
      sessionManager: ctx.sessionManager,
      pluginManager: ctx.pluginManager,
      handlers: ctx.handlers,
      clock: ctx.clock,
      handlerTimeoutMs: ctx.handlerTimeoutMs,
      backendRuntime: ctx.backendRuntime,
    });
    if (capability.outputSchema !== undefined) {
      const validation = validateJsonSchema(output, capability.outputSchema);
      if (!validation.ok) {
        const errorList: YamlValue = validation.errors.map((e) => ({ path: e.path, message: e.message }));
        await auditError(req, ctx, capability, caller, startedAt, new GatewayError(
          ERROR_CODES.INTERNAL_ERROR,
          "handler output does not match capability outputSchema",
          { capability: req.capability.name, errors: errorList },
          true,
        ));
        return {
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: "handler output does not match capability outputSchema",
            details: { capability: req.capability.name, errors: errorList },
            retryable: true,
          },
        };
      }
    }

    // (9) Audit + event + success return.
    await auditOk(req, ctx, capability, caller, startedAt);
    return { output };
  } catch (err) {
    // (9) Dispatch failure path.
    const gatewayErr =
      err instanceof GatewayError
        ? err
        : new GatewayError(
            ERROR_CODES.INTERNAL_ERROR,
            err instanceof Error ? err.message : String(err),
            {},
            false,
          );
    await auditError(req, ctx, capability, caller, startedAt, gatewayErr);
    return {
      error: {
        code: gatewayErr.code,
        message: gatewayErr.message,
        details: gatewayErr.details,
        retryable: gatewayErr.retryable,
      },
    };
  }
}

async function auditOk(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
  capability: { readonly name: string; readonly version: string; readonly owner: string },
  caller: CallerIdentity,
  startedAt: number,
): Promise<void> {
  const record = {
    schemaVersion: 1 as const,
    ts: startedAt,
    tenantId: caller.tenantId,
    caller: { id: caller.callerId, scope: [...caller.scope] },
    ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
    capability: { name: req.capability.name, version: capability.version },
    owner: capability.owner,
    status: "ok" as const,
    durationMs: ctx.clock.now() - startedAt,
  };
  await ctx.audit.append(record);
  await ctx.eventBus.publish("gateway.invocation", record);
  ctx.metrics?.recordOk();
}

async function auditError(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
  capability: { readonly name: string; readonly version: string; readonly owner: string },
  caller: CallerIdentity,
  startedAt: number,
  gatewayErr: GatewayError,
): Promise<void> {
  const record = {
    schemaVersion: 1 as const,
    ts: startedAt,
    tenantId: caller.tenantId,
    caller: { id: caller.callerId, scope: [...caller.scope] },
    ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
    capability: { name: req.capability.name, version: capability.version },
    owner: capability.owner,
    status: "error" as const,
    errorCode: gatewayErr.code,
    errorMessage: gatewayErr.message,
    durationMs: ctx.clock.now() - startedAt,
  };
  await ctx.audit.append(record);
  await ctx.eventBus.publish("gateway.invocation", record);
  ctx.metrics?.recordError();
}

// CID:handle-002 - exitWithError
// Purpose: shared error-path helper. Emits one audit record + one gateway.invocation event
// for every denied/errored request, then returns the CanonicalResponse. Pre-token-verify
// failures have no verified caller; we record the audit with "unknown" tenantId so the event
// still surfaces the request shape for operators.
async function exitWithError(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
  startedAt: number,
  errPayload: GatewayErrorPayload,
): Promise<CanonicalResponse> {
  const record = {
    schemaVersion: 1 as const,
    ts: startedAt,
    tenantId: "unknown",
    caller: { id: "unknown", scope: [] },
    capability: {
      name: typeof req.capability?.name === "string" ? req.capability.name : "",
      version: typeof req.capability?.version === "string" ? req.capability.version : "",
    },
    owner: "unknown",
    status: "denied" as const,
    denyReason: errPayload.code,
    durationMs: ctx.clock.now() - startedAt,
  };
  await ctx.audit.append(record);
  await ctx.eventBus.publish("gateway.invocation", record);
  ctx.metrics?.recordDenied(errPayload.code);
  return { error: errPayload };
}
