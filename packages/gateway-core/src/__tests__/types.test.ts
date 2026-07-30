import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  GatewayError,
  type AuditRecord,
  type CanonicalInvocation,
  type CanonicalResponse,
  type CallerIdentity,
  type Gateway,
  type GatewayConfig,
  type TenantRecord,
  type TokenClaims,
  type Adapter,
  type GatewayErrorPayload,
} from "../index.js";

describe("gateway-core types", () => {
  it("exports ERROR_CODES with all 18 stable strings", () => {
    expect(ERROR_CODES.AUTH_FAILED).toBe("GATEWAY_AUTH_FAILED");
    expect(ERROR_CODES.TOKEN_INVALID).toBe("GATEWAY_TOKEN_INVALID");
    expect(ERROR_CODES.TOKEN_EXPIRED).toBe("GATEWAY_TOKEN_EXPIRED");
    expect(ERROR_CODES.INSUFFICIENT_SCOPE).toBe("GATEWAY_INSUFFICIENT_SCOPE");
    expect(ERROR_CODES.UNAUTHORIZED_OPERATION).toBe("GATEWAY_UNAUTHORIZED_OPERATION");
    expect(ERROR_CODES.SESSION_REQUIRED).toBe("GATEWAY_SESSION_REQUIRED");
    expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe("GATEWAY_RATE_LIMIT_EXCEEDED");
    expect(ERROR_CODES.CAPABILITY_NOT_FOUND).toBe("GATEWAY_CAPABILITY_NOT_FOUND");
    expect(ERROR_CODES.PLUGIN_NOT_INSTALLED).toBe("GATEWAY_PLUGIN_NOT_INSTALLED");
    expect(ERROR_CODES.PLUGIN_DISABLED).toBe("GATEWAY_PLUGIN_DISABLED");
    expect(ERROR_CODES.SDK_UNREACHABLE).toBe("GATEWAY_SDK_UNREACHABLE");
    expect(ERROR_CODES.MANAGER_UNAVAILABLE).toBe("GATEWAY_MANAGER_UNAVAILABLE");
    expect(ERROR_CODES.HANDLER_TIMEOUT).toBe("GATEWAY_HANDLER_TIMEOUT");
    // BI[8a] Phase 3: plugin-handler error-path codes
    expect(ERROR_CODES.HANDLER_NOT_FOUND).toBe("GATEWAY_HANDLER_NOT_FOUND");
    expect(ERROR_CODES.HANDLER_ERROR).toBe("GATEWAY_HANDLER_ERROR");
    expect(ERROR_CODES.INTERNAL_ERROR).toBe("GATEWAY_INTERNAL_ERROR");
    expect(ERROR_CODES.TENANT_MISMATCH).toBe("GATEWAY_TENANT_MISMATCH");
    expect(ERROR_CODES.INVALID_REQUEST).toBe("GATEWAY_INVALID_REQUEST");
  });

  it("exposes GatewayError with code, message, details, retryable", () => {
    const err = new GatewayError("GATEWAY_AUTH_FAILED", "missing token", {}, false);
    expect(err.code).toBe("GATEWAY_AUTH_FAILED");
    expect(err.message).toBe("missing token");
    expect(err.details).toEqual({});
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("GatewayError");
    expect(err).toBeInstanceOf(Error);
  });

  it("types are assignable in their declared shapes", () => {
    const caller: CallerIdentity = { tenantId: "acme", callerId: "agent-1", scope: ["customer.read"] };
    const invocation: CanonicalInvocation = {
      token: "x",
      caller,
      capability: { name: "customer.read" },
      input: { id: 42 },
      sessionId: "s_abc",
    };
    const okResponse: CanonicalResponse = { output: { customer: { name: "Acme" } } };
    const errPayload: GatewayErrorPayload = {
      code: "GATEWAY_INSUFFICIENT_SCOPE",
      message: "test",
      details: { requiredScope: "customer.read" },
      retryable: false,
    };
    const errResponse: CanonicalResponse = { error: errPayload };
    const tenant: TenantRecord = { id: "acme", name: "Acme", createdAt: 0, suspended: false };
    const claims: TokenClaims = {
      sub: { tenantId: "acme", callerId: "agent-1" },
      scope: ["customer.read"],
      iat: 0,
      exp: 0,
    };
    const audit: AuditRecord = {
      schemaVersion: 1,
      ts: 0,
      tenantId: "acme",
      caller: { id: "agent-1", scope: ["customer.read"] },
      session: { id: "s_abc" },
      capability: { name: "customer.read", version: "1.0.0" },
      owner: "backend-sdk-acme",
      status: "ok",
      durationMs: 12,
    };
    const config: GatewayConfig = {
      auditLogPath: "/data/audit.log",
      tenantsPath: "/data/tenants.json",
      secretPath: "/data/gateway-secret",
    };
    const adapter: Adapter = {
      name: "mcp",
      start: async () => {},
      stop: async () => {},
    };
    const gateway: Gateway = {
      handleInvocation: async () => okResponse,
      registerAdapter: async () => {},
      unregisterAdapter: async () => {},
      issueToken: async () => ({ token: "x", claims }),
      createTenant: async (_req) => tenant,
      listTenants: () => [tenant],
      suspendTenant: async (_id) => tenant,
      deleteTenant: async (_id) => {},
      status: async () => ({ uptimeMs: 0, tenantCount: 1, pluginCount: 0, auditLogBytes: 0 }),
    };

    expect(invocation.caller?.tenantId).toBe("acme");
    expect(okResponse.output).toEqual({ customer: { name: "Acme" } });
    expect(errResponse.error.code).toBe("GATEWAY_INSUFFICIENT_SCOPE");
    expect(tenant.id).toBe("acme");
    expect(claims.sub.tenantId).toBe("acme");
    expect(audit.status).toBe("ok");
    expect(config.auditLogPath).toBe("/data/audit.log");
    expect(adapter.name).toBe("mcp");
    expect(typeof gateway.handleInvocation).toBe("function");
  });
});