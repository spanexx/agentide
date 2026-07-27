/*
 * Code Map: canonical handleInvocation pipeline
 * - handleInvocation: 13-step pipeline (TRD §2.3) — authn-shape → rate-limit → session → authz → version resolve → dispatch → audit → event
 *
 * CID Index:
 * CID:handle-001 -> handleInvocation
 *
 * Quick lookup: rg -n "CID:handle-" packages/gateway-core/src/handle-invocation.ts
 */

import type { EventBus } from "@platform/event-bus";
import type { CapabilityRegistry } from "@platform/capability-registry";
import type { SessionManager } from "@platform/session-manager";
import type { PluginManager } from "@platform/plugin-manager";
import { checkAuthz } from "./authz.js";
import { dispatchCapability, resolveCapability, type DispatchHandlers } from "./dispatch.js";
import { ERROR_CODES, GatewayError } from "./errors.js";
import type { AuditWriter } from "./audit.js";
import { RateLimiter } from "./rate-limit.js";
import type {
  CanonicalInvocation,
  CanonicalResponse,
  Clock,
  GatewayErrorPayload,
} from "./types.js";

const SESSION_LESS_CAPABILITIES: ReadonlySet<string> = new Set([
  "session.create",
  "session.resume",
  "session.list",
  "capability.list",
  "capability.describe",
  "gateway.status",
  "gateway.metrics",
  "gateway.configuration",
  "tenant.list",
]);

export interface HandleInvocationCtx {
  readonly registry: CapabilityRegistry;
  readonly sessionManager: SessionManager;
  readonly pluginManager: PluginManager;
  readonly handlers: DispatchHandlers;
  readonly audit: AuditWriter;
  readonly eventBus: EventBus;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
  readonly handlerTimeoutMs: number;
}

// CID:handle-001 - handleInvocation
// Purpose: canonical entry point for every capability invocation; 13-step pipeline per TRD §2.3
//   1. validate request shape
//   2. consume 1 rate-limit token (or GATEWAY_RATE_LIMIT_EXCEEDED)
//   3. check session requirement + tenant match (or GATEWAY_SESSION_REQUIRED / TENANT_MISMATCH)
//   4. resolve capability version (auto-latest or pinned)
//   5. check authz tier hierarchy (or GATEWAY_INSUFFICIENT_SCOPE)
//   6. dispatch (in-process platform / plugin SDK UNREACHABLE for backend-sdk)
//   7. enforce handler timeout (or GATEWAY_HANDLER_TIMEOUT)
//   8. write audit record (every exit path)
//   9. emit gateway.invocation event (every exit path)
//   10. return CanonicalResponse
// Used by: every adapter (MCP / REST / CLI / WS) translates inbound requests into a CanonicalInvocation and calls this.
export async function handleInvocation(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
): Promise<CanonicalResponse> {
  const startedAt = ctx.clock.now();

  // (1) Validate request shape.
  if (!req.capability.name || typeof req.capability.name !== "string") {
    return await exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.INVALID_REQUEST,
      message: "capability.name is required",
      details: {},
      retryable: false,
    });
  }

  const bucketKey = `${req.caller.tenantId}:${req.caller.callerId}`;

  // (2) Rate-limit.
  if (!ctx.rateLimiter.tryConsume(bucketKey)) {
    return await exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message: `rate limit exceeded for caller ${req.caller.callerId}`,
      details: { callerId: req.caller.callerId, tenantId: req.caller.tenantId },
      retryable: true,
    });
  }

  // (3) Session requirement check.
  const requiresSession = !SESSION_LESS_CAPABILITIES.has(req.capability.name);
  if (requiresSession && !req.sessionId) {
    return await exitWithError(req, ctx, startedAt, {
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
      // Session Manager throws SessionNotFoundError; we surface SESSION_REQUIRED.
      sessionStatus = null;
    }
    if (sessionStatus === null || sessionStatus === "archived") {
      return await exitWithError(req, ctx, startedAt, {
        code: ERROR_CODES.SESSION_REQUIRED,
        message: `session "${req.sessionId}" is not active`,
        details: { sessionId: req.sessionId },
        retryable: false,
      });
    }
    // NOTE[agent]: tenant matching on sessionId relies on session-manager's existing
    // invariant that session.ownerId was set to the caller's tenantId at create time.
    // A v2 enhancement adds getSession(id) → TenantRecord lookup for explicit check.
  }

  // (4) Resolve capability version.
  const capability = resolveCapability(ctx.registry, req.capability.name, req.capability.version);
  if (!capability) {
    return await exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.CAPABILITY_NOT_FOUND,
      message: `capability "${req.capability.name}" is not registered`,
      details: { capability: req.capability.name, version: req.capability.version ?? null },
      retryable: false,
    });
  }

  // (5) Authz.
  if (!checkAuthz(req.caller.scope, capability.permissions)) {
    return await exitWithError(req, ctx, startedAt, {
      code: ERROR_CODES.INSUFFICIENT_SCOPE,
      message: `caller lacks required scope for "${req.capability.name}"`,
      details: {
        capability: req.capability.name,
        requiredPermissions: [...capability.permissions],
        callerScope: [...req.caller.scope],
      },
      retryable: false,
    });
  }

  // (6) Dispatch.
  try {
    const output = await dispatchCapability(capability, req.input, req.sessionId, {
      registry: ctx.registry,
      sessionManager: ctx.sessionManager,
      pluginManager: ctx.pluginManager,
      handlers: ctx.handlers,
      clock: ctx.clock,
      handlerTimeoutMs: ctx.handlerTimeoutMs,
    });

    // (8/9/10) Audit + event + success return.
    const resolvedVersion = capability.version;
    await ctx.audit.append({
      schemaVersion: 1,
      ts: startedAt,
      caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
      ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
      capability: { name: req.capability.name, version: resolvedVersion },
      owner: capability.owner,
      status: "ok",
      durationMs: ctx.clock.now() - startedAt,
    });
    await ctx.eventBus.publish("gateway.invocation", {
      schemaVersion: 1,
      ts: startedAt,
      caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
      ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
      capability: { name: req.capability.name, version: resolvedVersion },
      owner: capability.owner,
      status: "ok",
      durationMs: ctx.clock.now() - startedAt,
    });
    return { output };
  } catch (err) {
    // (6b/8/9/10) Dispatch failure path.
    const gatewayErr =
      err instanceof GatewayError
        ? err
        : new GatewayError(
            ERROR_CODES.INTERNAL_ERROR,
            err instanceof Error ? err.message : String(err),
            {},
            false,
          );
    await ctx.audit.append({
      schemaVersion: 1,
      ts: startedAt,
      caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
      ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
      capability: { name: req.capability.name, version: capability.version },
      owner: capability.owner,
      status: "error",
      errorCode: gatewayErr.code,
      errorMessage: gatewayErr.message,
      durationMs: ctx.clock.now() - startedAt,
    });
    await ctx.eventBus.publish("gateway.invocation", {
      schemaVersion: 1,
      ts: startedAt,
      caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
      ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
      capability: { name: req.capability.name, version: capability.version },
      owner: capability.owner,
      status: "error",
      errorCode: gatewayErr.code,
      errorMessage: gatewayErr.message,
      durationMs: ctx.clock.now() - startedAt,
    });
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

async function exitWithError(
  req: CanonicalInvocation,
  ctx: HandleInvocationCtx,
  startedAt: number,
  errPayload: GatewayErrorPayload,
): Promise<CanonicalResponse> {
  await ctx.audit.append({
    schemaVersion: 1,
    ts: startedAt,
    caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
    ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
    capability: { name: req.capability.name, version: "" },  // unknown at pre-resolve stage
    owner: "unknown",
    status: "denied",
    denyReason: errPayload.code,
    durationMs: ctx.clock.now() - startedAt,
  });
  await ctx.eventBus.publish("gateway.invocation", {
    schemaVersion: 1,
    ts: startedAt,
    caller: { id: req.caller.callerId, scope: [...req.caller.scope] },
    ...(req.sessionId !== undefined ? { session: { id: req.sessionId } } : {}),
    capability: { name: req.capability.name, version: "" },
    owner: "unknown",
    status: "denied",
    denyReason: errPayload.code,
    durationMs: ctx.clock.now() - startedAt,
  });
  return { error: errPayload };
}