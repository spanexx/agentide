import { describe, expect, it } from "vitest";
import type { CanonicalInvocation, CanonicalResponse, Gateway } from "@spanexx/gateway-core";
import { createCapabilityLookup } from "../capabilities/lookup.js";
import { createErrorConverter } from "../error-converter.js";

const identityConverter = createErrorConverter({
  defaultError: (p) => ({ code: p.code, message: p.message }),
});

function gateway(handler: (request: CanonicalInvocation) => CanonicalResponse | Promise<CanonicalResponse>): Gateway {
  return { handleInvocation: async (request) => handler(request) } as Gateway;
}

const cards = [
  { name: "runtime.browser.read", description: "read browser", tier: "read" },
  { name: "runtime.browser.click", description: "click browser", tier: "act" },
];

describe("createCapabilityLookup", () => {
  it("lists cards filtered by the token's scope", async () => {
    let seen: CanonicalInvocation | undefined;
    const lookup = createCapabilityLookup({
      gateway: gateway(async (request) => {
        seen = request;
        return { output: cards };
      }),
      errors: identityConverter,
    });
    // scope claim in the token: runtime.browser.read, runtime.browser.click
    const result = await lookup.list(issueToken("runtime.browser.read,runtime.browser.click"));
    expect(result).toEqual({ ok: true, value: cards });
    expect(seen?.capability.name).toBe("capability.list");
    expect(seen?.input).toEqual({ scope: ["runtime.browser.read", "runtime.browser.click"] });
  });

  it("returns [] without invoking the gateway when scope is empty", async () => {
    let invoked = false;
    const lookup = createCapabilityLookup({
      gateway: gateway(() => {
        invoked = true;
        return { output: cards };
      }),
      errors: identityConverter,
    });
    const result = await lookup.list(issueToken(""));
    expect(result).toEqual({ ok: true, value: [] });
    expect(invoked).toBe(false);
  });

  it("maps capability.list errors through the converter", async () => {
    const lookup = createCapabilityLookup({
      gateway: gateway(() => ({ error: { code: "CAPABILITY_LIST_DENIED", message: "nope", details: {}, retryable: false } })),
      errors: identityConverter,
    });
    const result = await lookup.list(issueToken("runtime.browser.read"));
    expect(result).toEqual({ ok: false, error: { code: "CAPABILITY_LIST_DENIED", message: "nope" } });
  });

  it("describes a single capability with its inputSchema", async () => {
    const lookup = createCapabilityLookup({
      gateway: gateway(() => ({
        output: {
          name: "runtime.browser.click",
          description: "click browser",
          inputSchema: { type: "object" },
          tier: "act",
        },
      })),
      errors: identityConverter,
    });
    const result = await lookup.describe("runtime.browser.click", issueToken("runtime.browser.click"));
    expect(result).toEqual({
      ok: true,
      value: { name: "runtime.browser.click", description: "click browser", inputSchema: { type: "object" }, tier: "act" },
    });
  });

  it("describe passes the name through to capability.describe", async () => {
    let seen: CanonicalInvocation | undefined;
    const lookup = createCapabilityLookup({
      gateway: gateway(async (request) => {
        seen = request;
        return { output: { name: "x", description: "d", inputSchema: null, tier: null } };
      }),
      errors: identityConverter,
    });
    await lookup.describe("session.list", issueToken("session.read"));
    expect(seen?.capability.name).toBe("capability.describe");
    expect(seen?.input).toEqual({ name: "session.list" });
  });

  it("maps describe errors through the converter", async () => {
    const lookup = createCapabilityLookup({
      gateway: gateway(() => ({ error: { code: "INVALID_REQUEST", message: "name required", details: {}, retryable: false } })),
      errors: identityConverter,
    });
    const result = await lookup.describe("missing.cap", issueToken("runtime.browser.read"));
    expect(result).toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "name required" } });
  });
});

// Minimal unsigned JWT with a scope claim (matches WS/MCP test-token pattern).
function issueToken(scopeCsv: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: { tenantId: "acme", callerId: "test" }, scope: scopeCsv.split(",").filter(Boolean) }),
    "utf8",
  ).toString("base64url");
  return `hdr.${payload}.sig`;
}
