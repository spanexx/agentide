/*
 * Lazy auth path — first true lazy consumer (A8 Q1 lock).
 * adapter-core's pipeline forwards the token to the kernel and the kernel
 * verifies per call; the MCP door performs NO adapter-side verification and
 * NO identity caching. These tests pin that: the token reaches the kernel
 * unchanged, and errors are the shared converter's shapes (no extra
 * door-layer wrapper). New behavior → its own new test (A8 Q3).
 */
import { describe, expect, it } from "vitest";
import { callTool, listTools } from "../translate.js";
import { ERROR_CODES } from "@spanexx/errors";
import type { Gateway } from "@spanexx/gateway-core";

/** Mock gateway that records every token it sees and always denies. */
function lazyMockGateway(): Gateway & { receivedTokens: string[] } {
  const receivedTokens: string[] = [];
  const gw: Gateway & { receivedTokens: string[] } = {
    receivedTokens,
    async handleInvocation(inv: { token: string }) {
      receivedTokens.push(inv.token);
      return {
        error: {
          code: ERROR_CODES.INSUFFICIENT_SCOPE,
          message: "caller lacks required scope",
          details: {},
          retryable: false,
        },
      };
    },
  } as unknown as Gateway & { receivedTokens: string[] };
  return gw;
}

describe("lazy auth path — no adapter-side verify", () => {
  it("listTools forwards the token to the kernel unchanged (no early verify)", async () => {
    const gw = lazyMockGateway();
    await listTools(gw, "fake.bad");
    expect(gw.receivedTokens).toContain("fake.bad");
  });

  it("listTools returns the kernel-rendered error via the shared converter", async () => {
    const gw = lazyMockGateway();
    const out = await listTools(gw, "fake.bad");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // INSUFFICIENT_SCOPE → -32002 (MCP table), message verbatim.
    expect(out.error).toEqual({ code: -32002, message: "GATEWAY_INSUFFICIENT_SCOPE" });
  });

  it("callTool forwards the token to the kernel unchanged (no early verify)", async () => {
    const gw = lazyMockGateway();
    await callTool(gw, {
      token: "fake.bad",
      name: "customer.refund",
      args: {},
      sessionId: undefined,
    });
    expect(gw.receivedTokens).toContain("fake.bad");
  });

  it("callTool surfaces the kernel error through the shared converter", async () => {
    const gw = lazyMockGateway();
    const out = await callTool(gw, {
      token: "fake.bad",
      name: "customer.refund",
      args: {},
      sessionId: undefined,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(-32002);
    expect(out.error.message).toBe("GATEWAY_INSUFFICIENT_SCOPE");
  });
});
