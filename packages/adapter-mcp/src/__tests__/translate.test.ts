/*
 * Behavior spec for the MCP adapter translation core (pure logic, no I/O):
 *  - gatewayErrorToJsonRpc: kernel error code -> JSON-RPC error (PRD-TRD §Error Handling)
 *  - validateMeta: _meta presence gate (PRD Scenario 6)
 *  - decodeScopeFromToken: JWT payload scope extraction for capability.list filtering
 *  - listTools / callTool: canonical invocation translation (PRD Scenarios 1-5, 8)
 * Tests verify behavior through public functions with a mock Gateway — no HTTP here.
 */

import { describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@spanexx/errors";
import type { CanonicalInvocation, CanonicalResponse, Gateway } from "@spanexx/gateway-core";
import {
  callTool,
  decodeScopeFromToken,
  gatewayErrorToJsonRpc,
  listTools,
  validateMeta,
  META_PROTOCOL_KEY,
  META_CAPABILITIES_KEY,
  META_SESSION_ID_KEY,
} from "../translate.js";

type MockGateway = Gateway & { readonly handleInvocation: ReturnType<typeof vi.fn> };

function mockGateway(responses: Readonly<Record<string, CanonicalResponse>>): MockGateway {
  const handleInvocation = vi.fn(
    async (inv: CanonicalInvocation): Promise<CanonicalResponse> => {
      const r = responses[inv.capability.name];
      if (r === undefined) {
        return {
          error: {
            code: ERROR_CODES.CAPABILITY_NOT_FOUND,
            message: `capability "${inv.capability.name}" is not registered`,
            details: {},
            retryable: false,
          },
        };
      }
      return r;
    },
  );
  return {
    handleInvocation,
    registerAdapter: vi.fn(async () => undefined),
    unregisterAdapter: vi.fn(async () => undefined),
    issueToken: vi.fn(async () => ({ token: "", claims: { sub: { tenantId: "t1", callerId: "c1" }, scope: [], iat: 0, exp: 0 } })),
    createTenant: vi.fn(async () => ({ id: "t1", name: "T1", createdAt: 0, suspended: false })),
    listTenants: () => [],
    suspendTenant: vi.fn(async () => ({ id: "t1", name: "T1", createdAt: 0, suspended: true })),
    deleteTenant: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ uptimeMs: 0, tenantCount: 0, pluginCount: 0, auditLogBytes: 0 })),
    clientService: undefined as never,
  };
}

describe("gatewayErrorToJsonRpc", () => {
  it("maps the auth family to -32001 with a stable wire message", () => {
    expect(gatewayErrorToJsonRpc(ERROR_CODES.AUTH_FAILED, "boom")).toEqual({
      code: -32001,
      message: "GATEWAY_AUTH_FAILED",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.TOKEN_INVALID, "bad jwt")).toEqual({
      code: -32001,
      message: "GATEWAY_AUTH_FAILED",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.TOKEN_EXPIRED, "expired")).toEqual({
      code: -32001,
      message: "GATEWAY_AUTH_FAILED",
    });
  });

  it("maps CAPABILITY_NOT_FOUND to -32001 with the capability name in the message", () => {
    expect(gatewayErrorToJsonRpc(ERROR_CODES.CAPABILITY_NOT_FOUND, "kernel msg", "customer.refund")).toEqual({
      code: -32001,
      message: "capability 'customer.refund' not found",
    });
  });

  it("maps the remaining PRD error table rows", () => {
    expect(gatewayErrorToJsonRpc(ERROR_CODES.INSUFFICIENT_SCOPE, "no scope")).toEqual({
      code: -32002,
      message: "GATEWAY_INSUFFICIENT_SCOPE",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.RATE_LIMIT_EXCEEDED, "slow down")).toEqual({
      code: -32003,
      message: "slow down",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.PLUGIN_DISABLED, "disabled")).toEqual({
      code: -32004,
      message: "disabled",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.SDK_UNREACHABLE, "unreachable")).toEqual({
      code: -32005,
      message: "unreachable",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.INTERNAL_ERROR, "oops")).toEqual({
      code: -32006,
      message: "oops",
    });
    expect(gatewayErrorToJsonRpc(ERROR_CODES.HANDLER_ERROR, "handler blew up")).toEqual({
      code: -32006,
      message: "handler blew up",
    });
  });

  it("maps unlisted codes to the -32006 fallback with code prefix", () => {
    expect(gatewayErrorToJsonRpc(ERROR_CODES.SESSION_REQUIRED, "need a session")).toEqual({
      code: -32006,
      message: "GATEWAY_SESSION_REQUIRED: need a session",
    });
  });
});

describe("validateMeta", () => {
  it("accepts _meta carrying protocolVersion and clientCapabilities", () => {
    expect(
      validateMeta({ [META_PROTOCOL_KEY]: "2025-11-25", [META_CAPABILITIES_KEY]: {} }),
    ).toBe(true);
  });

  it("rejects missing, partial, null and undefined _meta", () => {
    expect(validateMeta(undefined)).toBe(false);
    expect(validateMeta({})).toBe(false);
    expect(validateMeta({ [META_PROTOCOL_KEY]: "2025-11-25" })).toBe(false);
    expect(validateMeta({ [META_CAPABILITIES_KEY]: {} })).toBe(false);
    expect(validateMeta({ [META_PROTOCOL_KEY]: null, [META_CAPABILITIES_KEY]: {} })).toBe(false);
    expect(validateMeta({ [META_SESSION_ID_KEY]: "s1" })).toBe(false);
  });
});

describe("decodeScopeFromToken", () => {
  it("extracts the scope array from the JWT payload", () => {
    const payload = Buffer.from(JSON.stringify({ sub: { tenantId: "t1", callerId: "c1" }, scope: ["customer.read"] }), "utf8").toString("base64url");
    const token = `header.${payload}.sig`;
    expect(decodeScopeFromToken(token)).toEqual(["customer.read"]);
  });

  it("returns [] defensively for malformed tokens", () => {
    expect(decodeScopeFromToken("not-a-jwt")).toEqual([]);
    expect(decodeScopeFromToken("a.b.c")).toEqual([]);
    expect(decodeScopeFromToken("header." + Buffer.from("not json", "utf8").toString("base64url") + ".sig")).toEqual([]);
    expect(decodeScopeFromToken("header." + Buffer.from(JSON.stringify({ sub: {} }), "utf8").toString("base64url") + ".sig")).toEqual([]);
  });
});

describe("listTools", () => {
  const cardRead = { name: "customer.read", version: "1.0.0", type: "business", description: "Read customers", tier: "read" };
  const cardDelete = { name: "customer.delete", version: "1.0.0", type: "business", description: "Delete customers", tier: "destructive" };
  const describeRead = {
    capability: { name: "customer.read", version: "1.0.0", type: "business", description: "Read customers", inputSchema: { type: "object", properties: { id: { type: "string" } } }, permissions: ["customer.read"], owner: "demo-sdk", tier: "read" },
    selectedVersion: "1.0.0",
  };

  it("lists capabilities (kernel-filtered by scope) and enriches via describe", async () => {
    // The kernel's capability.list handler performs scope filtering (BI[7]);
    // the adapter's job is to pass the decoded scope and enrich each card.
    // The mock emulates a kernel that filtered out customer.delete for this caller.
    const gw = mockGateway({
      "capability.list": { output: [cardRead] },
      "capability.describe": { output: describeRead },
    });
    const token = `h.${Buffer.from(JSON.stringify({ sub: { tenantId: "t1", callerId: "c1" }, scope: ["customer.read"] }), "utf8").toString("base64url")}.s`;
    const outcome = await listTools(gw, token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tools).toEqual([
      {
        name: "customer.read",
        description: "Read customers",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        annotations: { tier: "read" },
      },
    ]);
    // capability.list must be called with the caller's decoded scope (BI[7] tier filter)
    const listCall = gw.handleInvocation.mock.calls[0];
    expect(listCall?.[0]?.input).toEqual({ scope: ["customer.read"] });
  });

  it("falls back to an empty object schema when describe carries no inputSchema", async () => {
    const gw = mockGateway({
      "capability.list": { output: [cardRead] },
      "capability.describe": { output: { capability: { name: "customer.read", version: "1.0.0", type: "business", description: "Read customers", permissions: [], owner: "demo-sdk" }, selectedVersion: "1.0.0" } },
    });
    const outcome = await listTools(gw, "x");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tools[0]?.inputSchema).toEqual({ type: "object" });
  });

  it("skips cards whose describe returns no capability record", async () => {
    const gw = mockGateway({
      "capability.list": { output: [cardRead, cardDelete] },
      "capability.describe": { output: { capability: null, selectedVersion: null } },
    });
    const outcome = await listTools(gw, "x");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tools).toEqual([]);
  });

  it("includes a card with a fallback schema when describe is denied (restricted caller)", async () => {
    // capability.describe requires platform.capability.read; a business-scoped
    // caller is denied it. The catalog must stay visible (BI[7]) — the card
    // from the kernel-filtered list is kept with a generic schema. Authz is
    // still enforced at call time.
    const gw = mockGateway({
      "capability.list": { output: [cardRead] },
      "capability.describe": {
        error: { code: ERROR_CODES.INSUFFICIENT_SCOPE, message: "caller lacks required scope", details: {}, retryable: false },
      },
    });
    const outcome = await listTools(gw, "x");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tools).toEqual([
      {
        name: "customer.read",
        description: "Read customers",
        inputSchema: { type: "object" },
        annotations: { tier: "read" },
      },
    ]);
  });

  it("propagates a mapped JSON-RPC error when capability.list fails", async () => {
    const gw = mockGateway({
      "capability.list": {
        error: { code: ERROR_CODES.CAPABILITY_NOT_FOUND, message: "nope", details: {}, retryable: false },
      },
    });
    const outcome = await listTools(gw, "x");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: -32001, message: "capability 'capability.list' not found" });
  });
});

describe("callTool", () => {
  const READ_TOKEN = `h.${Buffer.from(JSON.stringify({ sub: { tenantId: "t1", callerId: "c1" }, scope: ["customer.read"] }), "utf8").toString("base64url")}.s`;

  it("round-trips a successful invocation into MCP content + structuredContent", async () => {
    const gw = mockGateway({ "customer.read": { output: { id: "c1", name: "Ada" } } });
    const outcome = await callTool(gw, { token: READ_TOKEN, name: "customer.read", args: { id: "c1" }, sessionId: "s1" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.structuredContent).toEqual({ id: "c1", name: "Ada" });
    expect(outcome.result.content).toEqual([{ type: "text", text: '{"id":"c1","name":"Ada"}' }]);
    const call = gw.handleInvocation.mock.calls[0]?.[0];
    expect(call?.capability).toEqual({ name: "customer.read" });
    expect(call?.input).toEqual({ id: "c1" });
    expect(call?.sessionId).toBe("s1");
  });

  it("wraps ARRAY outputs in structuredContent (D-125 — session.list etc.)", async () => {
    const gw = mockGateway({ "session.list": { output: [{ id: "s1", status: "active" }] } });
    const outcome = await callTool(gw, { token: READ_TOKEN, name: "session.list", args: {}, sessionId: undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The MCP SDK's CallToolResult schema demands a RECORD for structuredContent;
    // a raw array is rejected with -32602 "expected record, received array".
    expect(outcome.result.structuredContent).toEqual({ items: [{ id: "s1", status: "active" }] });
    expect(outcome.result.content).toEqual([{ type: "text", text: '[{"id":"s1","status":"active"}]' }]);
  });

  it("wraps NULL outputs in structuredContent (D-125)", async () => {
    const gw = mockGateway({ "capability.list": { output: null } });
    const outcome = await callTool(gw, { token: READ_TOKEN, name: "capability.list", args: {}, sessionId: undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.structuredContent).toEqual({ items: null });
  });

  it("passes no sessionId when the request carries none", async () => {
    const gw = mockGateway({ "customer.read": { output: {} } });
    await callTool(gw, { token: READ_TOKEN, name: "customer.read", args: {}, sessionId: undefined });
    const call = gw.handleInvocation.mock.calls[0]?.[0];
    expect(call?.sessionId).toBeUndefined();
  });

  it("maps HANDLER_TIMEOUT to an isError result, not a JSON-RPC error", async () => {
    const gw = mockGateway({
      "customer.read": {
        error: { code: ERROR_CODES.HANDLER_TIMEOUT, message: "timed out after 5000ms", details: {}, retryable: true },
      },
    });
    const outcome = await callTool(gw, { token: READ_TOKEN, name: "customer.read", args: {}, sessionId: undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content[0]?.text).toContain("timed out");
  });

  it("maps INSUFFICIENT_SCOPE to -32002", async () => {
    const gw = mockGateway({
      "customer.delete": {
        error: { code: ERROR_CODES.INSUFFICIENT_SCOPE, message: "scope customer.delete required", details: {}, retryable: false },
      },
    });
    const outcome = await callTool(gw, { token: READ_TOKEN, name: "customer.delete", args: {}, sessionId: undefined });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: -32002, message: "GATEWAY_INSUFFICIENT_SCOPE" });
  });

  it("maps unknown capability to -32001 with its name", async () => {
    const outcome = await callTool(mockGateway({}), { token: READ_TOKEN, name: "customer.refund", args: {}, sessionId: undefined });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: -32001, message: "capability 'customer.refund' not found" });
  });
});
