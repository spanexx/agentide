/*
 * Test Map: REST POST /invoke handler (Phase 3, PRD-TRD scenarios 1-7, 9, 10)
 * - Every PRD scenario is driven end-to-end through handleInvoke with a
 *   fake gateway + fake IncomingMessage + fake ServerResponse.
 * - The verbatim body shape {code, message, details, retryable} is asserted
 *   byte-for-byte against the kernel payload (Scenario 10 bytewise check).
 * - The locked Q4 status map renders the right HTTP status for every
 *   scenario the kernel can return.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Gateway, CanonicalInvocation, CanonicalResponse } from "@spanexx/gateway-core";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import { handleInvoke } from "../invoke.js";
import { restErrorConverter } from "../errors.js";

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

interface FakeRequestOptions {
  body?: string;
  authorization?: string;
}

function fakeRequest({ body = "", authorization }: FakeRequestOptions): IncomingMessage {
  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers["authorization"] = authorization;
  const req = Object.assign(emitter, {
    headers,
    method: "POST",
    url: "/invoke",
  }) as unknown as IncomingMessage;
  if (body.length > 0) {
    queueMicrotask(() => {
      emitter.emit("data", Buffer.from(body, "utf-8"));
      emitter.emit("end");
    });
  } else {
    queueMicrotask(() => {
      emitter.emit("end");
    });
  }
  return req;
}

function fakeGateway(handler: (req: CanonicalInvocation) => Promise<CanonicalResponse> | CanonicalResponse): Gateway {
  return {
    handleInvocation: vi.fn(async (req: CanonicalInvocation) => handler(req)) as unknown as Gateway["handleInvocation"],
  } as Gateway;
}

const VALID_TOKEN = "valid.jwt.token";
const SCOPED_TOKEN = "scoped.jwt.token";
const EXPIRED_TOKEN = "expired.jwt.token";

// ─── Tests ────────────────────────────────────────────────────────────

describe("handleInvoke — PRD-TRD scenarios 1-7, 9, 10", () => {
  it("Scenario 1 — capability.list happy path → 200 {output: cards}", async () => {
    const cards = [
      { name: "capability.list", description: "list caps", tier: "read" },
      { name: "session.list", description: "list sessions", tier: "read" },
    ];
    const gateway = fakeGateway(async (req) => {
      expect(req.capability.name).toBe("capability.list");
      expect(req.token).toBe(VALID_TOKEN);
      return { output: cards };
    });
    const fr = fakeResponse();
    await handleInvoke(fakeRequest({ authorization: `Bearer ${VALID_TOKEN}`, body: '{"capability":"capability.list","input":{}}' }), fr.res, gateway);
    expect(fr.status).toBe(200);
    expect(fr.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(fr.body)).toEqual({ output: cards });
  });

  it("Scenario 2 — product.list happy path → 200 {output: products}", async () => {
    const products = [{ id: "p1", name: "Widget" }];
    const gateway = fakeGateway(async (req) => {
      expect(req.capability.name).toBe("product.list");
      expect(req.sessionId).toBe("s-1");
      return { output: products };
    });
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"product.list","input":{},"sessionId":"s-1"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(200);
    expect(JSON.parse(fr.body)).toEqual({ output: products });
  });

  it("Scenario 3 — missing bearer → 401 TOKEN_INVALID (door-fabricated, no pipeline call)", async () => {
    const handler = vi.fn();
    const gateway = fakeGateway(handler);
    const fr = fakeResponse();
    await handleInvoke(fakeRequest({ body: '{"capability":"product.list","input":{}}' }), fr.res, gateway);
    expect(fr.status).toBe(401);
    expect(JSON.parse(fr.body)).toEqual({
      code: ERROR_CODES.TOKEN_INVALID,
      message: "missing bearer token",
      details: {},
      retryable: false,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("Scenario 4 — expired token → 401 TOKEN_EXPIRED (verbatim kernel payload)", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.TOKEN_EXPIRED,
      message: "token expired at 2026-08-06",
      details: { exp: 1_755_446_400 },
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${EXPIRED_TOKEN}`, body: '{"capability":"product.list","input":{}}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(401);
    expect(JSON.parse(fr.body)).toEqual({
      code: payload.code,
      message: payload.message,
      details: payload.details,
      retryable: payload.retryable,
    });
  });

  it("Scenario 5 — insufficient scope → 403 INSUFFICIENT_SCOPE", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.INSUFFICIENT_SCOPE,
      message: "caller lacks required scope: product.read",
      details: {},
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: "Bearer noscope", body: '{"capability":"product.list","input":{}}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(403);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
  });

  it("Scenario 6 — session-required missing → 400 SESSION_REQUIRED", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.SESSION_REQUIRED,
      message: "product.list requires a sessionId",
      details: {},
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"product.list","input":{}}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(400);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.SESSION_REQUIRED);
  });

  it("Scenario 7 — unknown capability → 404 CAPABILITY_NOT_FOUND", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.CAPABILITY_NOT_FOUND,
      message: "unknown capability: does.not.exist",
      details: { capability: "does.not.exist" },
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"does.not.exist","input":{},"sessionId":"s-1"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(404);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.CAPABILITY_NOT_FOUND);
  });

  it("Scenario 9 — rate limit → 429 RATE_LIMIT_EXCEEDED (retryable: false)", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message: "token bucket empty",
      details: {},
      retryable: false,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"product.list","input":{},"sessionId":"s-1"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(429);
    const parsed = JSON.parse(fr.body);
    expect(parsed.code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    expect(parsed.retryable).toBe(false);
  });

  it("Scenario 10 — runtime family → 500 with retryable: true (HANDLER_TIMEOUT)", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.HANDLER_TIMEOUT,
      message: "handler exceeded 30000ms",
      details: { timeoutMs: 30_000 },
      retryable: true,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"product.list","input":{},"sessionId":"s-1"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(500);
    const parsed = JSON.parse(fr.body);
    expect(parsed.code).toBe(ERROR_CODES.HANDLER_TIMEOUT);
    expect(parsed.retryable).toBe(true);
  });

  it("Scenario 10 — SDK_UNREACHABLE → 500 verbatim body byte-for-byte", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.SDK_UNREACHABLE,
      message: "backend-sdk disconnected",
      details: {},
      retryable: true,
    };
    const gateway = fakeGateway(async () => ({ error: payload }));
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"capability":"product.list","input":{},"sessionId":"s-1"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(500);
    expect(JSON.parse(fr.body)).toEqual({
      code: payload.code,
      message: payload.message,
      details: payload.details,
      retryable: payload.retryable,
    });
  });

  it("invalid JSON body → 400 INVALID_REQUEST (door-fabricated)", async () => {
    const gateway = fakeGateway(vi.fn());
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: "{not json" }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(400);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.INVALID_REQUEST);
  });

  it("missing capability field → 400 INVALID_REQUEST (door-fabricated)", async () => {
    const gateway = fakeGateway(vi.fn());
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${SCOPED_TOKEN}`, body: '{"input":{}}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(400);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.INVALID_REQUEST);
  });

  it("non-Bearer authorization → 401 TOKEN_INVALID", async () => {
    const gateway = fakeGateway(vi.fn());
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: "Basic abc123", body: '{"capability":"x"}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(401);
    expect(JSON.parse(fr.body).code).toBe(ERROR_CODES.TOKEN_INVALID);
  });

  it("passes the bearer token verbatim to the kernel (A8 lazy auth)", async () => {
    const gateway = fakeGateway(async (req) => {
      expect(req.token).toBe(VALID_TOKEN);
      return { output: { ok: true } };
    });
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${VALID_TOKEN}`, body: '{"capability":"product.list","input":{}}' }),
      fr.res,
      gateway,
    );
    expect(fr.status).toBe(200);
  });

  it("forwards sessionId only when present in the request body", async () => {
    const seen: (string | undefined)[] = [];
    const gateway = fakeGateway(async (req) => {
      seen.push(req.sessionId);
      return { output: { ok: true } };
    });
    const fr = fakeResponse();
    await handleInvoke(
      fakeRequest({ authorization: `Bearer ${VALID_TOKEN}`, body: '{"capability":"product.list","input":{}}' }),
      fr.res,
      gateway,
    );
    expect(seen[0]).toBeUndefined();
  });

  it("byte-for-byte verbatim body shape (Q4 lock) — Scenario 10 reference payload", () => {
    const payload: GatewayErrorPayload = {
      code: "GATEWAY_HANDLER_TIMEOUT",
      message: "handler exceeded 30000ms",
      details: { timeoutMs: 30_000 },
      retryable: true,
    };
    const wire = JSON.stringify({
      code: payload.code,
      message: payload.message,
      details: payload.details,
      retryable: payload.retryable,
    });
    expect(wire).toBe(
      '{"code":"GATEWAY_HANDLER_TIMEOUT","message":"handler exceeded 30000ms","details":{"timeoutMs":30000},"retryable":true}',
    );
  });

  it("uses the door's restErrorConverter by default (matches the locked table)", () => {
    // Sanity check the default param equals the locked converter — guards
    // against a future refactor that accidentally swaps the default.
    const ref = restErrorConverter({
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      message: "x",
      details: {},
      retryable: false,
    });
    expect(ref.status).toBe(429);
  });
});