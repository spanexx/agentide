import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "../auth.js";
import type { Clock, TokenClaims } from "../index.js";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, _ms: number): number { cb(); return 0; }
  clearTimeout(_h: number): void { /* noop */ }
}

function claims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  return {
    sub: { tenantId: "acme", callerId: "agent-1" },
    scope: ["customer.read"],
    iat: 1_700_000_000_000,
    exp: 1_700_000_003_600,
    ...overrides,
  };
}

const SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only");

describe("issueToken + verifyToken (HS256)", () => {
  it("round-trip: issue then verify returns the same claims", () => {
    const clock = new FakeClock();
    const token = issueToken(claims(), SECRET, clock);
    const result = verifyToken(token, clock, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toEqual(claims());
    }
  });

  it("rejects a token with a tampered signature", () => {
    const clock = new FakeClock();
    const token = issueToken(claims(), SECRET, clock);
    // Tamper: flip the last char of the signature.
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${p}.${s.slice(0, -1)}${s.slice(-1) === "A" ? "B" : "A"}`;
    const result = verifyToken(tampered, clock, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GATEWAY_TOKEN_INVALID");
  });

  it("rejects a token signed with a different secret", () => {
    const clock = new FakeClock();
    const token = issueToken(claims(), SECRET, clock);
    const other = new TextEncoder().encode("different-secret");
    const result = verifyToken(token, clock, other);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GATEWAY_TOKEN_INVALID");
  });

  it("rejects an expired token (exp <= now)", () => {
    const clock = new FakeClock();
    const token = issueToken(claims({ exp: 1_700_000_003_600 }), SECRET, clock);
    clock.nowValue = 1_700_000_003_601;
    const result = verifyToken(token, clock, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GATEWAY_TOKEN_EXPIRED");
  });

  it("accepts a token whose exp is exactly now + 1 (boundary)", () => {
    const clock = new FakeClock();
    clock.nowValue = 1_700_000_000_000;
    const token = issueToken(claims({ exp: 1_700_000_000_001 }), SECRET, clock);
    const result = verifyToken(token, clock, SECRET);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed token (not 3 parts)", () => {
    const clock = new FakeClock();
    const result = verifyToken("not-a-real-jwt", clock, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GATEWAY_TOKEN_INVALID");
  });

  it("rejects an RS256-shaped token verified against HS256 secret (algorithm confusion)", () => {
    // Hand-craft a token that *looks* like RS256 in the header but no signature matches HS256(secret).
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: { tenantId: "x", callerId: "y" },
      scope: [], iat: 0, exp: 9_999_999_999,
    })).toString("base64url");
    const fakeSig = Buffer.from("not-a-real-rs256-signature").toString("base64url");
    const result = verifyToken(`${header}.${payload}.${fakeSig}`, new FakeClock(), SECRET);
    expect(result.ok).toBe(false);
  });

  it("issueToken produces a 3-part dot-separated string", () => {
    const clock = new FakeClock();
    const token = issueToken(claims(), SECRET, clock);
    expect(token.split(".")).toHaveLength(3);
  });

  it("accepts an expired token within the leeway window", () => {
    const clock = new FakeClock();
    const token = issueToken(claims({ exp: 1_700_000_003_600 }), SECRET, clock);
    clock.nowValue = 1_700_000_003_700;
    expect(verifyToken(token, clock, SECRET, { leewayMs: 1000 }).ok).toBe(true);
    clock.nowValue = 1_700_000_004_700;
    expect(verifyToken(token, clock, SECRET, { leewayMs: 1000 }).ok).toBe(false);
  });

  it("defaults to no leeway (zero backward-compatible behavior)", () => {
    const clock = new FakeClock();
    const token = issueToken(claims({ exp: 1_700_000_003_600 }), SECRET, clock);
    clock.nowValue = 1_700_000_003_601;
    expect(verifyToken(token, clock, SECRET).ok).toBe(false);
  });
});