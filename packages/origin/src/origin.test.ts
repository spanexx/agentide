import { describe, expect, it } from "vitest";
import { originMatches } from "./origin.js";

describe("originMatches (RFC 6125 §6.4.3)", () => {
  it("bypasses the check when the upgrade had no Origin header (Node client)", () => {
    expect(originMatches(undefined, ["https://app.acme.com"])).toBe(true);
    expect(originMatches(undefined, [])).toBe(true);
  });

  it("accepts exact origins", () => {
    expect(originMatches("https://app.acme.com", ["https://app.acme.com"])).toBe(true);
  });

  it("accepts a single-label `*.` wildcard, right-anchored", () => {
    expect(originMatches("https://app.acme.com", ["https://*.acme.com"])).toBe(true);
  });

  it("rejects zero-label, multi-label, and typo-squat attempts", () => {
    expect(originMatches("https://acme.com", ["https://*.acme.com"])).toBe(false);
    expect(originMatches("https://a.b.acme.com", ["https://*.acme.com"])).toBe(false);
    expect(originMatches("https://acme.com.evil.com", ["https://*.acme.com"])).toBe(false);
  });

  it("rejects a wildcard embedded mid-pattern or in a non-label position", () => {
    expect(originMatches("https://app.acme.com", ["https://a.*.com"])).toBe(false);
    expect(originMatches("https://app.acme.com", ["*.acme.com"])).toBe(false);
    expect(originMatches("https://app.acme.com", ["https://*"])).toBe(false);
  });

  it("accepts if any pattern in the list matches", () => {
    expect(originMatches("https://app.acme.com", ["https://other.com", "https://*.acme.com"])).toBe(true);
  });
});
