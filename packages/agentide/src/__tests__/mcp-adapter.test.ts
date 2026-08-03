/*
 * Code Map: BI[9] Phase 5 — agentide meta-package auto-registers the MCP
 * adapter, exposes `platform.mcpAdapter`, and stops it during platform.stop().
 *
 * Why: per GRILL Q6, the meta-package (not the kernel) is the intended home
 * for adapter wiring. This test drives a real createPlatform with
 * adapterMcpPort: 0 (OS-assigned) + backendRuntimePort: 0 so parallel vitest
 * workers don't collide on 7100.
 *
 * CID Index:
 * CID:agentide-mcp-test-001 -> createPlatform wiring + auto-register
 * CID:agentide-mcp-test-002 -> end-to-end tools/list + tools/call via fetch
 * CID:agentide-mcp-test-003 -> platform.stop() releases the MCP port
 * CID:agentide-mcp-test-004 -> adapterMcp:false suppresses the adapter
 */

import { afterEach, describe, expect, it } from "vitest";
import { createPlatform, type Platform } from "../index.js";
import type { FileSystem } from "@platform/gateway-core";
import type { BackendValue } from "@platform/backend-runtime";

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

const RPC_ACCEPT = "application/json, text/event-stream";
const META = {
  "io.modelcontextprotocol/protocolVersion": "2025-11-25",
  "io.modelcontextprotocol/clientCapabilities": { tools: {} },
};

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly result?: {
    tools?: Array<{ name: string; inputSchema: object; annotations: { tier: string | null } }>;
    content?: Array<{ type: string; text: string }>;
    structuredContent?: BackendValue;
    isError?: boolean;
  };
  readonly error?: { code: number; message: string };
}

const platforms: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  for (const p of platforms.splice(0)) {
    try {
      await p.stop();
    } catch {
      // ignore
    }
  }
});

interface CustomerReadCardShape {
  name: "customer.read";
  version: string;
  type: "business";
  description: string;
  permissions: string[];
  owner: string;
  inputSchema: { type: "object"; properties: { id: { type: "string" } }; required: string[] };
}

function customerReadCard(): CustomerReadCardShape {
  return {
    name: "customer.read",
    version: "1.0.0",
    type: "business",
    description: "Read customers",
    permissions: ["customer.read"],
    owner: "backend-sdk-customer-app",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  };
}

async function rpc(platform: Platform, body: string, auth: string | null): Promise<{ status: number; json: JsonRpcResponse }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: RPC_ACCEPT };
  if (auth !== null) headers["Authorization"] = auth;
  const port = platform.mcpAdapter?.port;
  if (port === null || port === undefined) {
    throw new Error("mcp adapter not started");
  }
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body });
  return { status: res.status, json: await res.json() as JsonRpcResponse };
}

async function bootWithMcp(opts: { adapterMcp?: boolean } = {}): Promise<Platform> {
  const fs = new InMemoryFs();
  const platform = await createPlatform({
    fs,
    dataDir: "/data",
    defaultTenant: { id: "default", name: "Default" },
    backendRuntimePort: 0,
    ...(opts.adapterMcp !== undefined ? { adapterMcp: opts.adapterMcp } : {}),
    adapterMcpPort: 0,
    adapterWs: false,
  });
  // Register a business cap so tools/list has something non-platform to surface.
  platform.capabilityRegistry.register("backend-sdk-customer-app", {
    owner: "backend-sdk-customer-app",
    capabilities: [customerReadCard()],
  });
  platforms.push(platform);
  return platform;
}

describe("createPlatform auto-registers the MCP adapter (BI[9] Phase 5)", () => {
  it("CID:agentide-mcp-test-001: by default the platform exposes a started mcpAdapter with a bound port", async () => {
    const platform = await bootWithMcp();
    expect(platform.mcpAdapter).toBeDefined();
    expect(platform.mcpAdapter?.name).toBe("mcp");
    expect(typeof platform.mcpAdapter?.port).toBe("number");
    expect((platform.mcpAdapter?.port ?? 0) > 0).toBe(true);
  });

  it("CID:agentide-mcp-test-002: tools/list via real fetch returns the registered customer.read cap", async () => {
    const platform = await bootWithMcp();
    const { token } = await platform.gateway.issueToken({
      tenantId: "default",
      callerId: "agentide-tester",
      scope: ["*"],
    });
    const res = await rpc(
      platform,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } }),
      `Bearer ${token}`,
    );
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const tools = res.json.result?.tools ?? [];
    expect(tools.map((t) => t.name)).toContain("customer.read");
    const read = tools.find((t) => t.name === "customer.read");
    expect(read?.inputSchema).toEqual({ type: "object", properties: { id: { type: "string" } }, required: ["id"] });
  });

  it("CID:agentide-mcp-test-002b: tools/call a platform cap dispatches through the gateway and returns output", async () => {
    // session.create is a platform cap (no SDK connection needed), so this
    // test exercises the MCP -> kernel wiring without requiring a fake SDK.
    // Dispatch into a real SDK is already covered by backend-runtime.test.ts.
    const platform = await bootWithMcp();
    const { token } = await platform.gateway.issueToken({
      tenantId: "default",
      callerId: "agentide-tester",
      scope: ["*"],
    });
    const res = await rpc(
      platform,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "session.create",
          arguments: { ownerId: "agentide-tester", adapterType: "mcp" },
          _meta: META,
        },
      }),
      `Bearer ${token}`,
    );
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    const sc = res.json.result?.structuredContent as { id?: string } | undefined;
    expect(typeof sc?.id).toBe("string");
  });

  it("CID:agentide-mcp-test-003: platform.stop() releases the MCP port", async () => {
    const platform = await bootWithMcp();
    const port = platform.mcpAdapter?.port;
    expect(typeof port).toBe("number");
    await platform.stop();
    // After stop, the port is closed; a new connect should reject/fail.
    const ok = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" }).then(
      () => true,
      () => false,
    );
    expect(ok).toBe(false);
  });

  it("CID:agentide-mcp-test-004: adapterMcp:false suppresses the adapter and stop() is still safe", async () => {
    const platform = await bootWithMcp({ adapterMcp: false });
    expect(platform.mcpAdapter).toBeUndefined();
    await platform.stop(); // must not throw
  });
});
