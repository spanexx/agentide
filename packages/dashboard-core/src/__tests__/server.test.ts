import { describe, expect, it } from "vitest";
import {
  DASHBOARD_DEFAULT_PORT,
  mintDashboardToken,
  createDashboardServer,
} from "../index.js";
import type { Clock, Gateway, IssueTokenRequest } from "@spanexx/gateway-core";

// P3 dashboard-core IMPL: mint helper + static server (D3 + D4 lock).
// Mint produces claims matching the D4 contract:
//   callerId dashboard-bot, scope platform.*.read,
//   expectedOrigins both 127.0.0.1:7200 + localhost:7200, exp ≈ now + 1h.
// Server routes `GET /` (token injected), `GET /assets/*`, 404 else,
// binds 127.0.0.1, throws on port conflict.

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}
const clock = new FakeClock();

function makeGateway(): Gateway {
  return {
    async issueToken(req: IssueTokenRequest) {
      return { token: "test-token", claims: { ...req, sub: { tenantId: req.tenantId, callerId: req.callerId } } as never };
    },
  } as unknown as Gateway;
}

describe("mintDashboardToken (P3)", () => {
  it("mints a token with the D4 contract (caller/scope/origins/1h)", async () => {
    const calls: IssueTokenRequest[] = [];
    const gateway: Gateway = {
      async issueToken(req: IssueTokenRequest) {
        calls.push(req);
        return { token: "tok", claims: { sub: { tenantId: req.tenantId, callerId: req.callerId }, scope: [...req.scope], iat: clock.now(), exp: clock.now() + (req.expiresInMs ?? 3600000), expectedOrigins: req.expectedOrigins ? [...req.expectedOrigins] : undefined } };
      },
    } as unknown as Gateway;

    const result = await mintDashboardToken(gateway, { clock });
    expect(calls).toHaveLength(1);
    expect(calls[0].callerId).toBe("dashboard-bot");
    expect(calls[0].scope).toEqual(["platform.*.read"]);
    expect(calls[0].expectedOrigins).toEqual([
      `http://127.0.0.1:${DASHBOARD_DEFAULT_PORT}`,
      `http://localhost:${DASHBOARD_DEFAULT_PORT}`,
    ]);
    expect(calls[0].expiresInMs).toBe(60 * 60 * 1000);
    expect(result.token).toBe("tok");
  });
});

describe("createDashboardServer (P3)", () => {
  it("throws a clear error when the port is already bound", async () => {
    // Pre-bind a port (OS-assigned) so the second createDashboardServer
    // bound to the same port deterministically hits EADDRINUSE.
    const port = 27000 + Math.floor(Math.random() * 1000);
    const blocker = await createDashboardServer({
      port,
      gateway: makeGateway(),
      clock,
    });
    expect(blocker.port).toBe(port);
    // Second server on the SAME port must reject with a clear error.
    await expect(
      createDashboardServer({ port, gateway: makeGateway(), clock }),
    ).rejects.toThrow(/address|port|EADDRINUSE|in use/i);
    await blocker.stop();
  });

  it("GET / returns 200 with the token injected into the page", async () => {
    const port = 27100 + Math.floor(Math.random() * 200);
    const server = await createDashboardServer({
      port,
      gateway: {
        async issueToken() {
          return { token: "INJECTED-TOKEN-1234", claims: { sub: { tenantId: "default", callerId: "dashboard-bot" }, scope: ["platform.*.read"], iat: 0, exp: 0 } };
        },
      } as unknown as Gateway,
      clock,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("INJECTED-TOKEN-1234");
    } finally {
      await server.stop();
    }
  });

  it("GET /assets/app.js returns 200 (asset serving)", async () => {
    const port = 27200 + Math.floor(Math.random() * 200);
    const server = await createDashboardServer({
      port,
      gateway: makeGateway(),
      clock,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it("returns 404 for non-root paths (no data API)", async () => {
    const port = 27300 + Math.floor(Math.random() * 200);
    const server = await createDashboardServer({
      port,
      gateway: makeGateway(),
      clock,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/anything`);
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});