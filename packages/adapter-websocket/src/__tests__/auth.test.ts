import { describe, expect, it } from "vitest";
import { issueToken, type Clock } from "@spanexx/gateway-core";
import { authenticateToken, originMatches, type AuthContext } from "../auth.js";

const SECRET = new TextEncoder().encode("adapter-auth-secret");

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}

function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    clock: new TestClock(),
    tokenSecret: SECRET,
    origin: undefined,
    listTenants: () => [],
    ...overrides,
  };
}

describe("originMatches", () => {
  it("accepts exact origins and one-label wildcards only", () => {
    expect(originMatches("https://app.acme.com", ["https://app.acme.com"])).toBe(true);
    expect(originMatches("https://app.acme.com", ["https://*.acme.com"])).toBe(true);
    expect(originMatches("https://acme.com", ["https://*.acme.com"])).toBe(false);
    expect(originMatches("https://a.b.acme.com", ["https://*.acme.com"])).toBe(false);
    expect(originMatches("https://acme.com.evil.com", ["https://*.acme.com"])).toBe(false);
  });
});

describe("authenticateToken", () => {
  it("rejects a missing token with the locked auth code", () => {
    expect(authenticateToken(undefined, context())).toEqual({ ok: false, code: "token missing" });
  });

  it("accepts a valid node token", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = authenticateToken(token, context({ clock }));
    expect(result.ok).toBe(true);
  });

  it("denies a browser token without expected origins", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "browser" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = authenticateToken(token, context({ clock, origin: "https://app.acme.com" }));
    expect(result).toEqual({ ok: false, code: "origin mismatch" });
  });
});
