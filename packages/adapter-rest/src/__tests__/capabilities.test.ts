/*
 * Test Map: REST GET /capabilities handler (Phase 4, PRD-TRD Scenario 8)
 * - List returns kernel-filtered cards wrapped as `{capabilities: [...]}`.
 * - Missing bearer → 401 TOKEN_INVALID (door-fabricated).
 * - Insufficient scope → 403 INSUFFICIENT_SCOPE (from the kernel via the
 *   shared lookup).
 * - Empty-scope tokens return `[]` defensively (lookup.ts:60) — kernel
 *   NOT called.
 * - Kernel error paths render via the locked Q4 status map.
 *
 * readClaims decodes the JWT payload segment as base64url; tests build
 * real-looking JWTs so the lookup actually reaches the kernel.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Gateway, CanonicalInvocation, CanonicalResponse } from "@spanexx/gateway-core";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import { handleGetCapabilities } from "../capabilities.js";

// ─── Helpers ──────────────────────────────────────────────────────────

const encodePayload = (claims: Readonly<Record<string, unknown>>): string =>
  Buffer.from(JSON.stringify(claims), "utf-8").toString("base64url");
const JWT = (claims: Readonly<Record<string, unknown>>): string => `hdr.${encodePayload(claims)}.sig`;

const SCOPED_TOKEN = JWT({ scope: ["platform.session.read"] }); // lacks capability.read
const RUNTIME_TOKEN = JWT({ scope: ["platform.session.read"] }); // for handler-error path
const VALID_TOKEN = JWT({ scope: ["platform.*.read"] });

// ─── Fakes ────────────────────────────────────────────────────────────

interface FakeResponse {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

function fakeResponse(): FakeResponse {
  const captured: FakeResponse = {
    res: undefined as unknown as ServerResponse,
    status: undefined,
    headers: {},
    body: "",
  };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
    },
    end(chunk?: string | Buffer) {
      captured.body = typeof chunk === "string" ? chunk : chunk !== undefined ? chunk.toString("utf-8") : "";
    },
  } as unknown as ServerResponse;
  captured.res = res;
  return captured;
}

function fakeRequest(authorization?: string): IncomingMessage {
  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers["authorization"] = authorization;
  const req = Object.assign(emitter, { headers, method: "GET", url: "/capabilities" }) as unknown as IncomingMessage;
  queueMicrotask(() => emitter.emit("end"));
  return req;
}

function fakeGateway(handler: (req: CanonicalInvocation) => Promise<CanonicalResponse> | CanonicalResponse): Gateway {
  return {
    handleInvocation: vi.fn(async (req: CanonicalInvocation) => handler(req)) as unknown as Gateway["handleInvocation"],
  } as Gateway;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("handleGetCapabilities — PRD-TRD Scenario 8 + auth gate", () => {
  it("returns kernel-filtered cards wrapped as {capabilities: [...]}", async () => {
    const cards = [
      { name: "capability.list", description: "List caps", tier: "read" },
      { name: "session.list", description: "List sessions", tier: "read" },
    ];
    const gateway = fakeGateway(async (req) => {
      expect(req.capability.name).toBe("capability.list");
      expect(req.token).toBe(VALID_TOKEN);
      return { output: cards };
    });
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest(`Bearer ${VALID_TOKEN}`), fr.res, gateway);
    expect(fr.status).toBe(200);
    expect(fr.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(fr.body)).toEqual({ capabilities: cards });
  });

  it("missing bearer → 401 TOKEN_INVALID (door-fabricated, no gateway call)", async () => {
    const handler = vi.fn();
    const gateway = fakeGateway(handler);
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest(), fr.res, gateway);
    expect(fr.status).toBe(401);
    expect(JSON.parse(fr.body)).toEqual({
      code: ERROR_CODES.TOKEN_INVALID,
      message: "missing bearer token",
      details: {},
      retryable: false,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("non-Bearer authorization → 401 TOKEN_INVALID", async () => {
    const gateway = fakeGateway(vi.fn());
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest("Basic abc123"), fr.res, gateway);
    expect(fr.status).toBe(401);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.TOKEN_INVALID);
  });

  it("insufficient scope → 403 INSUFFICIENT_SCOPE (verbatim kernel payload)", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.INSUFFICIENT_SCOPE,
      message: "caller lacks required scope: platform.capability.read",
      details: {},
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest(`Bearer ${SCOPED_TOKEN}`), fr.res, gateway);
    expect(fr.status).toBe(403);
    const parsed = JSON.parse(fr.body);
    expect(parsed.code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
    expect(parsed.message).toBe(payload.message);
    expect(parsed.retryable).toBe(false);
  });

  it("kernel runtime error → 500 with retryable: true", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.HANDLER_ERROR,
      message: "registry down",
      details: {},
      retryable: true,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest(`Bearer ${RUNTIME_TOKEN}`), fr.res, gateway);
    expect(fr.status).toBe(500);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.HANDLER_ERROR);
  });

  it("empty-scope token returns {capabilities: []} defensively (no kernel call)", async () => {
    // Token "xxx" has no JWT structure (no dots) → readClaims returns scope:[].
    // The lookup short-circuits to {ok:true, value:[]} without invoking the kernel.
    const handler = vi.fn();
    const gateway = fakeGateway(handler);
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest("Bearer xxx"), fr.res, gateway);
    expect(fr.status).toBe(200);
    expect(JSON.parse(fr.body)).toEqual({ capabilities: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards the bearer token verbatim to the kernel (A8 lazy auth)", async () => {
    const gateway = fakeGateway(async (req) => {
      expect(req.token).toBe(VALID_TOKEN);
      return { output: [{ name: "x", description: "x", tier: "read" }] };
    });
    const fr = fakeResponse();
    await handleGetCapabilities(fakeRequest(`Bearer ${VALID_TOKEN}`), fr.res, gateway);
    expect(fr.status).toBe(200);
  });
});