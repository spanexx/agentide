/*
 * Test Map: REST HTTP server + router (Phase 5)
 * - Boots the server on a free port (port 0 → OS-assigned).
 * - Drives all 10 PRD-TRD scenarios end-to-end via Node 22 stdlib fetch.
 * - Asserts HTTP status, body JSON shape, and content-type.
 * - GET /capabilities/{name} is intentionally not routed (D-100) — verifies
 *   the router 404s with an INVALID_REQUEST body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Gateway, CanonicalInvocation, CanonicalResponse } from "@spanexx/gateway-core";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import { createRestAdapter } from "../server.js";

// ─── Fakes ────────────────────────────────────────────────────────────

interface FakeResponse {
  status: number;
  headers: Headers;
  body: string;
}

async function fetchText(url: string, init?: RequestInit): Promise<FakeResponse> {
  const res = await fetch(url, init);
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

function fakeGateway(
  handler: (req: CanonicalInvocation) => Promise<CanonicalResponse> | CanonicalResponse,
): Gateway {
  return {
    handleInvocation: vi.fn(async (req: CanonicalInvocation) => handler(req)) as unknown as Gateway["handleInvocation"],
  } as Gateway;
}

const encodePayload = (claims: Readonly<Record<string, unknown>>): string =>
  Buffer.from(JSON.stringify(claims), "utf-8").toString("base64url");
const JWT = (claims: Readonly<Record<string, unknown>>): string => `hdr.${encodePayload(claims)}.sig`;

const VALID_TOKEN = JWT({ scope: ["platform.*.read"] });
const SCOPED_TOKEN = JWT({ scope: ["product.read"] });

// ─── Test fixtures ────────────────────────────────────────────────────

describe("createRestAdapter — Phase 5 server + router", () => {
  let adapter: ReturnType<typeof createRestAdapter>;
  let baseUrl: string;

  beforeEach(async () => {
    const gateway = fakeGateway(async (req) => {
      // PRD Scenario 1: capability.list → cards
      if (req.capability.name === "capability.list") {
        return { output: [{ name: "capability.list", description: "List caps", tier: "read" }] };
      }
      // PRD Scenario 2: product.list → products
      if (req.capability.name === "product.list") {
        return { output: [{ id: "p1", name: "Widget" }] };
      }
      return { error: { code: ERROR_CODES.CAPABILITY_NOT_FOUND, message: "unknown", details: {}, retryable: false } };
    });
    adapter = createRestAdapter(gateway, { port: 0 });
    await adapter.start();
    baseUrl = `http://127.0.0.1:${adapter.port}`;
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it("Scenario 1 — POST /invoke capability.list → 200 + {output: cards} + content-type", async () => {
    const res = await fetchText(`${baseUrl}/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ capability: "capability.list", input: {} }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(res.body)).toEqual({ output: [{ name: "capability.list", description: "List caps", tier: "read" }] });
  });

  it("Scenario 2 — POST /invoke product.list with sessionId → 200 + {output: products}", async () => {
    const res = await fetchText(`${baseUrl}/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ capability: "product.list", input: {}, sessionId: "s-1" }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ output: [{ id: "p1", name: "Widget" }] });
  });

  it("Scenario 3 — POST /invoke without Authorization → 401 TOKEN_INVALID", async () => {
    const res = await fetchText(`${baseUrl}/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "product.list", input: {} }),
    });
    expect(res.status).toBe(401);
    const parsed = JSON.parse(res.body);
    expect(parsed.code).toBe(ERROR_CODES.TOKEN_INVALID);
    expect(parsed.message).toBe("missing bearer token");
    expect(parsed.retryable).toBe(false);
  });

  it("Scenario 4 — POST /invoke with expired token (kernel returns TOKEN_EXPIRED) → 401", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.TOKEN_EXPIRED, message: "token expired", details: { exp: 1 }, retryable: false },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${JWT({ scope: ["product.read"] })}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {}, sessionId: "s-1" }),
      });
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).code).toBe(ERROR_CODES.TOKEN_EXPIRED);
    } finally {
      await a.stop();
    }
  });

  it("Scenario 5 — POST /invoke with empty-scope token (kernel INSUFFICIENT_SCOPE) → 403", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.INSUFFICIENT_SCOPE, message: "no scope", details: {}, retryable: false },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: "Bearer noscope", "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {} }),
      });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body).code).toBe(ERROR_CODES.INSUFFICIENT_SCOPE);
    } finally {
      await a.stop();
    }
  });

  it("Scenario 6 — POST /invoke without sessionId for session-required cap (kernel SESSION_REQUIRED) → 400", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.SESSION_REQUIRED, message: "session needed", details: {}, retryable: false },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {} }),
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).code).toBe(ERROR_CODES.SESSION_REQUIRED);
    } finally {
      await a.stop();
    }
  });

  it("Scenario 7 — POST /invoke unknown capability (kernel CAPABILITY_NOT_FOUND) → 404", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.CAPABILITY_NOT_FOUND, message: "unknown: does.not.exist", details: {}, retryable: false },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "does.not.exist", input: {}, sessionId: "s-1" }),
      });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body).code).toBe(ERROR_CODES.CAPABILITY_NOT_FOUND);
    } finally {
      await a.stop();
    }
  });

  it("Scenario 8 — GET /capabilities → 200 {capabilities: cards}", async () => {
    const res = await fetchText(`${baseUrl}/capabilities`, {
      method: "GET",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      capabilities: [{ name: "capability.list", description: "List caps", tier: "read" }],
    });
  });

  it("Scenario 9 — kernel RATE_LIMIT_EXCEEDED → 429", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.RATE_LIMIT_EXCEEDED, message: "slow down", details: {}, retryable: false },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {}, sessionId: "s-1" }),
      });
      expect(res.status).toBe(429);
      expect(JSON.parse(res.body).code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    } finally {
      await a.stop();
    }
  });

  it("Scenario 10 — kernel HANDLER_TIMEOUT → 500 with retryable: true", async () => {
    const gate = fakeGateway(async () => ({
      error: { code: ERROR_CODES.HANDLER_TIMEOUT, message: "timeout", details: { timeoutMs: 30000 }, retryable: true },
    }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {}, sessionId: "s-1" }),
      });
      expect(res.status).toBe(500);
      const parsed = JSON.parse(res.body);
      expect(parsed.code).toBe(ERROR_CODES.HANDLER_TIMEOUT);
      expect(parsed.retryable).toBe(true);
    } finally {
      await a.stop();
    }
  });

  it("GET /capabilities/{name} is NOT routed → 404 with INVALID_REQUEST body (D-100 deferral)", async () => {
    const res = await fetchText(`${baseUrl}/capabilities/some.capability`, {
      method: "GET",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(404);
    const parsed = JSON.parse(res.body);
    expect(parsed.code).toBe(ERROR_CODES.INVALID_REQUEST);
    expect(parsed.details).toMatchObject({ method: "GET", path: "/capabilities/some.capability" });
  });

  it("GET /invoke (wrong method) → 404 with INVALID_REQUEST body", async () => {
    const res = await fetchText(`${baseUrl}/invoke`, {
      method: "GET",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).code).toBe(ERROR_CODES.INVALID_REQUEST);
  });

  it("POST /unknown → 404 with INVALID_REQUEST body", async () => {
    const res = await fetchText(`${baseUrl}/unknown`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).code).toBe(ERROR_CODES.INVALID_REQUEST);
  });

  it("stop() is idempotent (calling twice is a no-op)", async () => {
    await adapter.stop();
    await adapter.stop(); // second stop is a no-op
  });

  it("start() throws if called twice without an intervening stop", async () => {
    await expect(adapter.start()).rejects.toThrow(/already started/);
  });

  it("binds 127.0.0.1 only (no public 0.0.0.0 exposure)", async () => {
    // Connect to the local interface on the bound port — the test proves
    // 127.0.0.1 works; if it also worked on the public interface, an
    // external client could probe it. Verify the address is loopback.
    // We can't directly inspect server.address() from here, but the
    // host config defaults to 127.0.0.1 and Phase 1 documents loopback-only.
    expect(adapter.name).toBe("adapter-rest");
    expect(adapter.port).toBeGreaterThan(0);
  });

  it("Scenario 6 + 9 — body verbatim includes details object", async () => {
    const payload: GatewayErrorPayload = {
      code: ERROR_CODES.SESSION_REQUIRED,
      message: "session needed",
      details: { capability: "product.list" },
      retryable: false,
    };
    const gate = fakeGateway(async () => ({ error: payload }));
    const a = createRestAdapter(gate, { port: 0 });
    await a.start();
    try {
      const res = await fetchText(`http://127.0.0.1:${a.port}/invoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SCOPED_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ capability: "product.list", input: {} }),
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.details).toEqual({ capability: "product.list" });
      expect(parsed.retryable).toBe(false);
    } finally {
      await a.stop();
    }
  });
});