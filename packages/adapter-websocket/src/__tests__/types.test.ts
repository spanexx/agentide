/*
 * Phase 1 gate: types + error codes.
 * Verifies the locked defaults (PRD-TRD §Config), the 5 WS_* codes, the
 * auth lowercase phrases, and the no-clash rule against @platform/errors.
 */
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@platform/errors";
import { validatePattern } from "@platform/event-bus";
import { AUTH_ERROR_CODES, DEFAULT_CONFIG } from "../types.js";
import { WS_ERROR_CODES } from "../errors.js";

describe("DEFAULT_CONFIG (locked defaults)", () => {
  it("binds 127.0.0.1:7300 (MCP=7100, dashboard=7200 — confirmed 2026-08-03)", () => {
    expect(DEFAULT_CONFIG.host).toBe("127.0.0.1");
    expect(DEFAULT_CONFIG.port).toBe(7300);
  });

  it("caps both buffers at 1 MiB", () => {
    expect(DEFAULT_CONFIG.maxBufferedBytes).toBe(1_048_576);
    expect(DEFAULT_CONFIG.maxFrameBytes).toBe(1_048_576);
  });

  it("arms stats at 1s after first drop (recovery signal)", () => {
    expect(DEFAULT_CONFIG.statsIntervalMs).toBe(1000);
  });

  it("arms pre-auth timeout at 30s → close 1008", () => {
    expect(DEFAULT_CONFIG.preAuthTimeoutMs).toBe(30_000);
  });

  it("heartbeat: ping 30s, pong timeout 10s → close 1011", () => {
    expect(DEFAULT_CONFIG.heartbeatIntervalMs).toBe(30_000);
    expect(DEFAULT_CONFIG.heartbeatTimeoutMs).toBe(10_000);
  });
});

describe("WS_ERROR_CODES", () => {
  it("exports exactly the 5 locked WS_* codes", () => {
    expect(Object.values(WS_ERROR_CODES)).toEqual([
      "WS_INVALID_TOPIC",
      "WS_FORBIDDEN",
      "WS_INVALID_FRAME",
      "WS_INTERNAL",
      "WS_FRAME_TOO_LARGE",
    ]);
  });

  it("never collides with @platform/errors GATEWAY_* codes", () => {
    const gatewayCodes = new Set<string>(Object.values(ERROR_CODES));
    for (const code of Object.values(WS_ERROR_CODES)) {
      expect(gatewayCodes.has(code)).toBe(false);
    }
  });
});

describe("Event Bus pattern seam", () => {
  it("exposes locked subscription grammar through the package root", () => {
    expect(() => validatePattern("session.*")).not.toThrow();
    expect(() => validatePattern("session.*.extra")).toThrow();
  });
});

describe("AUTH_ERROR_CODES", () => {
  it("uses the locked lowercase phrases verbatim (W2)", () => {
    expect(AUTH_ERROR_CODES).toEqual({
      TOKEN_EXPIRED: "token expired",
      TOKEN_INVALID: "token invalid",
      TOKEN_MISSING: "token missing",
      ORIGIN_MISMATCH: "origin mismatch",
      TENANT_SUSPENDED: "tenant suspended",
    });
  });
});
