import { describe, expect, it } from "vitest";
import { issueToken, type Clock } from "@spanexx/gateway-core";
import { createAuthPolicy, type AuthPolicyContext } from "../auth-policy.js";

const SECRET = new TextEncoder().encode("adapter-auth-secret");

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}

function context(overrides: Partial<AuthPolicyContext> = {}): AuthPolicyContext {
  return {
    clock: new TestClock(),
    tokenSecret: SECRET,
    origin: undefined,
    listTenants: () => [],
    ...overrides,
  };
}

const policy = createAuthPolicy({ mode: "early" });

describe("createAuthPolicy (early mode)", () => {
  it("reports mode on the policy", () => {
    expect(policy.mode).toBe("early");
    expect(createAuthPolicy().mode).toBe("early");
    expect(createAuthPolicy({ mode: "lazy" }).mode).toBe("lazy");
  });

  it("rejects a missing token with TOKEN_MISSING", () => {
    expect(policy.authenticate(undefined, context())).toEqual({ ok: false, reason: "TOKEN_MISSING" });
    expect(policy.authenticate("", context())).toEqual({ ok: false, reason: "TOKEN_MISSING" });
  });

  it("accepts a valid node token", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = policy.authenticate(token, context({ clock }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub.tenantId).toBe("acme");
      expect(result.claims.sub.callerId).toBe("ops");
    }
  });

  it("denies a browser token without expected origins (ORIGIN_MISMATCH)", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "browser" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = policy.authenticate(token, context({ clock, origin: "https://app.acme.com" }));
    expect(result).toEqual({ ok: false, reason: "ORIGIN_MISMATCH" });
  });

  it("accepts a browser token when origin matches expectedOrigins", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "browser" },
      scope: ["platform.*.read"],
      expectedOrigins: ["https://app.acme.com"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = policy.authenticate(token, context({ clock, origin: "https://app.acme.com" }));
    expect(result.ok).toBe(true);
  });

  it("denies an expired token (TOKEN_EXPIRED)", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: clock.now() - 2000,
      exp: clock.now() - 1000,
    }, SECRET, clock);
    expect(policy.authenticate(token, context({ clock }))).toEqual({ ok: false, reason: "TOKEN_EXPIRED" });
  });

  it("denies a garbage token (TOKEN_INVALID)", () => {
    expect(policy.authenticate("not.a.token", context())).toEqual({ ok: false, reason: "TOKEN_INVALID" });
  });

  it("denies a token for a suspended tenant (TENANT_SUSPENDED)", () => {
    const clock = new TestClock();
    const token = issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: clock.now(),
      exp: clock.now() + 1000,
    }, SECRET, clock);
    const result = policy.authenticate(token, context({
      clock,
      listTenants: () => [{ id: "acme", name: "Acme", createdAt: 0, suspended: true }],
    }));
    expect(result).toEqual({ ok: false, reason: "TENANT_SUSPENDED" });
  });
});
