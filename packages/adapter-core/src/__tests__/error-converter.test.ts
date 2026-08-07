import { describe, expect, it } from "vitest";
import { createErrorConverter, type DoorError } from "../error-converter.js";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";

const payload = (code: string, message = "boom", details = {}) => ({
  code,
  message,
  details,
  retryable: false,
});

describe("createErrorConverter", () => {
  it("maps a known code through the door table (static entry)", () => {
    const table = {
      [ERROR_CODES.INSUFFICIENT_SCOPE]: {
        code: -32002,
        message: "GATEWAY_INSUFFICIENT_SCOPE",
      } satisfies DoorError,
    };
    const convert = createErrorConverter({ table });
    expect(convert(payload(ERROR_CODES.INSUFFICIENT_SCOPE))).toEqual({
      code: -32002,
      message: "GATEWAY_INSUFFICIENT_SCOPE",
    });
  });

  it("maps a known code through a function entry", () => {
    const table = {
      [ERROR_CODES.RATE_LIMIT_EXCEEDED]: (p: GatewayErrorPayload) => ({ code: -32003, message: p.message }),
    };
    const convert = createErrorConverter({ table });
    expect(convert(payload(ERROR_CODES.RATE_LIMIT_EXCEEDED, "slow down"))).toEqual({
      code: -32003,
      message: "slow down",
    });
  });

  it("falls back to the shared default for unmapped codes", () => {
    const convert = createErrorConverter();
    const p = payload(ERROR_CODES.SESSION_REQUIRED, "session needed");
    expect(convert(p)).toEqual({ code: -32006, message: "GATEWAY_SESSION_REQUIRED: session needed" });
  });

  it("honors a door-configurable default error", () => {
    const convert = createErrorConverter({ defaultError: { code: -1, message: "door fallback" } });
    expect(convert(payload(ERROR_CODES.TENANT_MISMATCH))).toEqual({
      code: -1,
      message: "door fallback",
    });
  });

  it("honors a door-configurable default function", () => {
    const convert = createErrorConverter({
      defaultError: (p) => ({ code: -9, message: `got ${p.code}` }),
    });
    expect(convert(payload("SOME_UNKNOWN_CODE"))).toEqual({ code: -9, message: "got SOME_UNKNOWN_CODE" });
  });

  it("carries details through when the door payload includes them", () => {
    const table = {
      [ERROR_CODES.HANDLER_ERROR]: (p: GatewayErrorPayload) => ({ code: -32006, message: p.message, details: p.details }),
    };
    const convert = createErrorConverter({ table });
    expect(convert(payload(ERROR_CODES.HANDLER_ERROR, "handler fail", { cause: "x" }))).toEqual({
      code: -32006,
      message: "handler fail",
      details: { cause: "x" },
    });
  });
});
