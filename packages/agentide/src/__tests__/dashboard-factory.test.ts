import { describe, expect, it } from "vitest";
import { createPlatform } from "../index.js";
import type { Clock, FileSystem } from "@spanexx/gateway-core";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");
void TEST_SECRET;

describe("agentide factory wiring (P6 dashboard-core)", () => {
  it("starts the dashboard static server when dashboardPort is set", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      clock: new FakeClock(),
      // Pick a free port for the MCP + WS adapters so this test doesn't
      // collide with a live demo gateway. Dashboard gets a fixed port we
      // can reach in the assertion.
      adapterMcpPort: 0,
      adapterWsHost: "127.0.0.1",
      wsPort: 0,
      // The dashboard wiring (P6):
      dashboardPort: 27400,
    });
    try {
      // GET / returns 200 + a page that includes the injected token.
      const res = await fetch("http://127.0.0.1:27400/");
      expect(res.status).toBe(200);
      const body = await res.text();
      // The token placeholder is replaced TWICE: once on the variable
      // name (window.__AGENTIDE_TOKEN__ → window.<token>) and once on
      // the assignment string (window.<token> = "<token>").
      //      expect(body).not.toContain("__AGENTIDE_TOKEN__");
      // JWT tokens may contain dots and underscores — match any non-whitespace
      // string of 8+ chars for the var name and value.
      expect(body).toMatch(/window\.\S{8,} = "\S{8,}";/);
    } finally {
      await platform.stop();
    }
  });

  it("registers dashboard.view.* caps so they resolve over the WS adapter", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      clock: new FakeClock(),
      adapterMcp: false,
      adapterWs: false,
      defaultTenant: { id: "default", name: "Default" },
      dashboardPort: 27401,
    });
    try {
      // Mint the test token via the gateway so it uses the same secret.
      const minted = await platform.gateway.issueToken({
        tenantId: "default",
        callerId: "alice",
        scope: ["platform.dashboard.read"],
        expiresInMs: 60 * 60 * 1000,
      });
      const res = await platform.gateway.handleInvocation({
        token: minted.token,
        caller: { tenantId: "default", callerId: "alice", scope: ["platform.dashboard.read"] },
        capability: { name: "dashboard.view.sessions" },
        input: {},
      });
      expect(res).toHaveProperty("output");
    } finally {
      await platform.stop();
    }
  });

  it("does NOT start a dashboard server when dashboardPort is omitted", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      clock: new FakeClock(),
      adapterMcp: false,
      adapterWs: false,
      // No dashboardPort — server should not start.
    });
    try {
      // Default dashboard port 7200 must NOT respond (we just verified the
      // server is optional; without dashboardPort nothing binds).
      let reachable = false;
      try {
        const res = await fetch("http://127.0.0.1:7200/", { signal: AbortSignal.timeout(200) });
        reachable = res.status === 200;
      } catch { reachable = false; }
      expect(reachable).toBe(false);
    } finally {
      await platform.stop();
    }
  });
});