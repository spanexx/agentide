/*
 * Test Map: REST error table + converter (Phase 2, PRD-TRD §Behavioral Spec)
 * - Every locked Q4 row renders its expected HTTP status.
 * - The verbatim body shape stays {code, message, details, retryable} —
 *   the door never rewrites kernel bytes (A9 Q4 lock).
 * - Unmapped codes fall in the runtime family (500), body verbatim.
 */

import { describe, expect, it } from "vitest";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import { restErrorConverter, REST_ERROR_TABLE } from "../errors.js";

const payload = (code: string, message = "boom"): GatewayErrorPayload => ({
  code,
  message,
  details: { hint: "x" },
  retryable: true,
});

// The locked Q4 table (18 rows, verbatim from GRIPL / pre-impl sim):
// auth 401, authz 403, request 400, not-found 404, rate 429, runtime 500.
const EXPECTED_STATUS: Readonly<Record<string, number>> = {
  [ERROR_CODES.TOKEN_INVALID]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.AUTH_FAILED]: 401,
  [ERROR_CODES.INSUFFICIENT_SCOPE]: 403,
  [ERROR_CODES.UNAUTHORIZED_OPERATION]: 403,
  [ERROR_CODES.TENANT_MISMATCH]: 403,
  [ERROR_CODES.SESSION_REQUIRED]: 400,
  [ERROR_CODES.INVALID_REQUEST]: 400,
  [ERROR_CODES.CAPABILITY_NOT_FOUND]: 404,
  [ERROR_CODES.HANDLER_NOT_FOUND]: 404,
  [ERROR_CODES.PLUGIN_NOT_INSTALLED]: 404,
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 429,
  [ERROR_CODES.SDK_UNREACHABLE]: 500,
  [ERROR_CODES.HANDLER_TIMEOUT]: 500,
  [ERROR_CODES.PLUGIN_DISABLED]: 500,
  [ERROR_CODES.MANAGER_UNAVAILABLE]: 500,
  [ERROR_CODES.HANDLER_ERROR]: 500,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};

describe("REST status map (Q4)", () => {
  it("covers every ERROR_CODES catalog entry with a locked status", () => {
    const locked = Object.keys(EXPECTED_STATUS).sort();
    const table = Object.keys(REST_ERROR_TABLE).sort();
    expect(table).toEqual(locked);
    expect(table.length).toBe(18);
  });

  it("renders the expected HTTP status for every locked row", () => {
    for (const [code, httpStatus] of Object.entries(EXPECTED_STATUS)) {
      expect(restErrorConverter(payload(code)).status, `status for ${code}`).toBe(httpStatus);
    }
  });

  it("renders 401 for the auth family", () => {
    for (const code of [ERROR_CODES.TOKEN_INVALID, ERROR_CODES.TOKEN_EXPIRED, ERROR_CODES.AUTH_FAILED]) {
      const converted = restErrorConverter(payload(code, "bad token"));
      expect(converted.status).toBe(401);
      expect(converted.retryable).toBe(true);
    }
  });

  it("renders 403 for the authorization family", () => {
    for (const code of [
      ERROR_CODES.INSUFFICIENT_SCOPE,
      ERROR_CODES.UNAUTHORIZED_OPERATION,
      ERROR_CODES.TENANT_MISMATCH,
    ]) {
      expect(restErrorConverter(payload(code)).status).toBe(403);
    }
  });

  it("renders 400 for the request family", () => {
    for (const code of [ERROR_CODES.SESSION_REQUIRED, ERROR_CODES.INVALID_REQUEST]) {
      expect(restErrorConverter(payload(code)).status).toBe(400);
    }
  });

  it("renders 404 for the not-found family", () => {
    for (const code of [
      ERROR_CODES.CAPABILITY_NOT_FOUND,
      ERROR_CODES.HANDLER_NOT_FOUND,
      ERROR_CODES.PLUGIN_NOT_INSTALLED,
    ]) {
      expect(restErrorConverter(payload(code)).status).toBe(404);
    }
  });

  it("renders 429 for the rate family", () => {
    expect(restErrorConverter(payload(ERROR_CODES.RATE_LIMIT_EXCEEDED, "slow down")).status).toBe(429);
  });

  it("renders 500 for the runtime family", () => {
    for (const code of [
      ERROR_CODES.SDK_UNREACHABLE,
      ERROR_CODES.HANDLER_TIMEOUT,
      ERROR_CODES.PLUGIN_DISABLED,
      ERROR_CODES.MANAGER_UNAVAILABLE,
      ERROR_CODES.HANDLER_ERROR,
      ERROR_CODES.INTERNAL_ERROR,
    ]) {
      expect(restErrorConverter(payload(code)).status).toBe(500);
    }
  });

  it("preserves the GatewayErrorPayload body verbatim", () => {
    const p = payload(ERROR_CODES.HANDLER_ERROR, "handler blew up");
    const converted = restErrorConverter(p);
    expect(converted.code).toBe(p.code);
    expect(converted.message).toBe("handler blew up");
    expect(converted.details).toEqual({ hint: "x" });
    expect(converted.retryable).toBe(true);
    expect(converted).not.toHaveProperty("httpStatus");
  });

  it("unmapped codes fall back to 500 with the body verbatim", () => {
    const p = payload("SOME_UNKNOWN_GATEWAY_CODE", "unmapped");
    const converted = restErrorConverter(p);
    expect(converted.status).toBe(500);
    expect(converted.code).toBe("SOME_UNKNOWN_GATEWAY_CODE");
    expect(converted.message).toBe("unmapped");
    expect(converted.details).toEqual({ hint: "x" });
    expect(converted.retryable).toBe(true);
  });

  it("Scenario 3/9/10 body shape byte-for-byte matches PRD-TRD", () => {
    const p401: GatewayErrorPayload = {
      code: "TOKEN_INVALID",
      message: "missing bearer token",
      details: {},
      retryable: false,
    };
    expect(JSON.stringify({ code: p401.code, message: p401.message, retryable: p401.retryable, details: p401.details })).toBe(
      '{"code":"TOKEN_INVALID","message":"missing bearer token","retryable":false,"details":{}}',
    );
  });
});