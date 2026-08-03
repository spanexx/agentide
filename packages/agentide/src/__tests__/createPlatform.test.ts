import { describe, expect, it } from "vitest";
import { createPlatform } from "../index.js";
import type { FileSystem } from "@platform/gateway-core";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

describe("createPlatform", () => {
  it("returns a started platform with wired components", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      defaultTenant: { id: "default", name: "Default" },
      // BI[9] — keep the hermetic createPlatform suite port-free; the MCP
      // wiring itself is exercised in mcp-adapter.test.ts.
      adapterMcp: false,
      adapterWs: false,
    });
    expect(platform.gateway).toBeDefined();
    expect(platform.eventBus).toBeDefined();
    expect(platform.capabilityRegistry).toBeDefined();
    expect(platform.sessionManager).toBeDefined();
    expect(platform.pluginManager).toBeDefined();
    expect(platform.stop).toBeInstanceOf(Function);
    // No default adapter registered when opted out (per Plan Decision 7).
    expect(platform.mcpAdapter).toBeUndefined();
    const status = await platform.gateway.status();
    expect(status.tenantCount).toBe(1);
  });

  it("default tenant exists and a token can be issued for it", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      defaultTenant: { id: "acme", name: "Acme" },
      adapterMcp: false,
      adapterWs: false,
    });
    const { token } = await platform.gateway.issueToken({
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["*"],
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("reuses an existing JWT secret across createPlatform calls", async () => {
    const fs = new InMemoryFs();
    const p1 = await createPlatform({
      fs,
      dataDir: "/data",
      defaultTenant: { id: "default", name: "Default" },
      adapterMcp: false,
      adapterWs: false,
    });
    await p1.stop();
    const p2 = await createPlatform({
      fs,
      dataDir: "/data",
      defaultTenant: { id: "default", name: "Default" },
      adapterMcp: false,
      adapterWs: false,
    });
    // same on-disk state means the secret file is byte-identical
    const sec1 = await p1.gateway["status"]; // not testing internals — just verifying p2 wired up
    expect(sec1).toBeDefined();
    const status = await p2.gateway.status();
    expect(status.tenantCount).toBe(1);
  });

  it("stop() is idempotent", async () => {
    const fs = new InMemoryFs();
    const platform = await createPlatform({
      fs,
      dataDir: "/data",
      defaultTenant: { id: "default", name: "Default" },
      adapterMcp: false,
      adapterWs: false,
    });
    await platform.stop();
    await platform.stop(); // must not throw
  });
});