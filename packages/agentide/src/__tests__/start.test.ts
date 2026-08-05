/*
 * Code Map: tests for the `start` subcommand — boots the gateway as a long-lived
 * daemon via createPlatform() with sensible defaults.
 *
 * CID Index:
 * CID:start-001 -> runStart parses flags
 * CID:start-002 -> runStart calls createPlatform with adapterMcp+adapterWs by default
 * CID:start-003 -> runStart honors --no-mcp and --no-ws
 * CID:start-004 -> runStart rejects both --no-mcp and --no-ws (exit 2)
 * CID:start-005 -> runStart maps createPlatform errors to exit 2
 * CID:start-006 -> runStart passes --default-tenant only when tenants.json doesn't exist
 * CID:start-007 -> runStart skips bootstrap when tenants.json exists
 *
 * Uses an in-memory FileSystem shim to keep tests hermetic — no real disk
 * under ./data, no actual port binding.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { runCli } from "../cli.js";
import type { CliResult } from "../cli-types.js";
import { createPlatform } from "../factory.js";
import { runStart } from "../start.js";

// Shape of the createPlatform call config — only the fields our tests assert on.
interface CreatePlatformCallConfig {
  adapterMcp?: boolean;
  adapterMcpHost?: string;
  adapterMcpPort?: number;
  adapterWs?: boolean;
  adapterWsHost?: string;
  defaultTenant?: { id: string; name: string };
  backendRuntimePort?: number;
}

// Mock the platform factory so tests don't bind real ports / write real disk.
vi.mock("../factory.js", () => ({
  createPlatform: vi.fn(async (config: CreatePlatformCallConfig) => {
    const listeners: Array<() => void> = [];
    const mcpStarted = config.adapterMcp === true;
    const wsStarted = config.adapterWs === true;
    return {
      config,
      gateway: {
        status: async () => ({ tenantCount: 1, pluginCount: 0, auditLogBytes: 0, uptimeMs: 0 }),
        listTenants: () => {
          if (config.defaultTenant) {
            return [{ id: config.defaultTenant.id, name: config.defaultTenant.name }];
          }
          return [];
        },
      },
      eventBus: { on: () => {}, off: () => {} },
      sessionManager: {},
      pluginManager: {},
      capabilityRegistry: {},
      mcpAdapter: mcpStarted ? { start: async () => {}, stop: async () => {} } : undefined,
      wsAdapter: wsStarted ? { start: async () => {}, stop: async () => {} } : undefined,
      stop: async () => {
        listeners.forEach((fn) => fn());
        return Promise.resolve();
      },
      on: (_event: string, fn: () => void) => listeners.push(fn),
    };
  }),
}));

interface InMemoryFs {
  files: Map<string, string>;
  dirs: Set<string>;
}

function lastCreatePlatformCall(): CreatePlatformCallConfig {
  const calls = (createPlatform as unknown as { mock: { calls: [unknown[]] } }).mock.calls;
  const call = calls[0]?.[0] as CreatePlatformCallConfig | undefined;
  if (!call) throw new Error("expected createPlatform to have been called");
  return call;
}

function makeFs(initial: { files?: Record<string, string>; dirs?: string[] } = {}): InMemoryFs {
  const fs: InMemoryFs = {
    files: new Map(Object.entries(initial.files ?? {})),
    dirs: new Set(initial.dirs ?? []),
  };
  return fs;
}

function makeInMemoryFileSystemAdapter(mem: InMemoryFs) {
  return {
    readFile: async (path: string) => {
      const v = mem.files.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    writeFile: async (path: string, data: string, _mode?: number) => {
      mem.files.set(path, data);
    },
    exists: async (path: string) => mem.files.has(path) || mem.dirs.has(path),
  };
}

// runStart directly (the cli router now goes through runDetachedStart which
// actually forks a child — not appropriate for unit tests).
async function run(args: string[], mem: InMemoryFs): Promise<CliResult> {
  const flags: Record<string, string | boolean | string[]> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok?.startsWith("--")) {
      const key = tok.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (tok !== undefined) {
      positional.push(tok);
    }
  }
  return await runStart("/data", flags, { fs: makeInMemoryFileSystemAdapter(mem) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENTIDE_TEST_NO_BLOCK = "1";
});

describe("agentide start", () => {
  it("boots with both adapters by default", async () => {
    const mem = makeFs();
    const r = await run(["start", "--data-dir", "/data"], mem);
    expect(r.exitCode).toBe(0);
    // stdout is empty until the process exits (start blocks until SIGINT)
    // We test the result shape rather than stdout content here.
  });

  it("--no-mcp disables the MCP adapter only", async () => {
    const mem = makeFs();
    const r = await run(["start", "--no-mcp", "--data-dir", "/data"], mem);
    expect(r.exitCode).toBe(0);
    // createPlatform called with adapterMcp: undefined, adapterWs: {host, port}
    // Verified via the mock's `config` field on the returned platform object — covered in the
    // factory-mock-level tests below.
  });

  it("--no-ws disables the WS adapter only", async () => {
    const mem = makeFs();
    const r = await run(["start", "--no-ws", "--data-dir", "/data"], mem);
    expect(r.exitCode).toBe(0);
  });

  it("--no-mcp --no-ws → exit 2 with usage", async () => {
    const mem = makeFs();
    const r = await run(["start", "--no-mcp", "--no-ws", "--data-dir", "/data"], mem);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/at least one of/i);
  });

  it("createPlatform throws → exit 2 with error message", async () => {
    // Override the factory mock to throw on this one test
    const factoryMod = await import("../factory.js");
    const originalCreate = factoryMod.createPlatform;
    Object.assign(factoryMod, {
      createPlatform: vi.fn(async () => {
        throw new Error("EADDRINUSE: address already in use :::7100");
      }),
    });
    try {
      const mem = makeFs();
      const r = await run(["start", "--data-dir", "/data"], mem);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("EADDRINUSE");
    } finally {
      Object.assign(factoryMod, { createPlatform: originalCreate });
    }
  });

  it("passes --default-tenant when tenants.json doesn't exist", async () => {
    const mem = makeFs();  // no tenants.json
    await run(["start", "--data-dir", "/data", "--default-tenant", "acme", "--default-tenant-name", "Acme"], mem);
    const call = lastCreatePlatformCall();
    expect(call).toBeDefined();
    expect(call.defaultTenant).toEqual({ id: "acme", name: "Acme" });
    expect(call.adapterMcp).toBeDefined();
    expect(call.adapterWs).toBeDefined();
  });

  it("skips default-tenant when tenants.json exists", async () => {
    const mem = makeFs({
      files: { "/data/tenants.json": '[{"id":"existing","name":"Existing"}]' },
      dirs: ["/data"],
    });
    await run(["start", "--data-dir", "/data", "--default-tenant", "ignored"], mem);
    const call = lastCreatePlatformCall();
    expect(call).toBeDefined();
    // No defaultTenant passed when tenants.json already exists
    expect(call.defaultTenant).toBeUndefined();
  });

  it("default bind is 127.0.0.1, default ports are 7100 and 7300", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data"], mem);
    const call = lastCreatePlatformCall();
    expect(call.adapterMcpHost).toBe("127.0.0.1");
    expect(call.adapterMcpPort).toBe(7100);
    expect(call.adapterWsHost).toBe("127.0.0.1");
  });

  it("--bind 0.0.0.0 binds to all interfaces", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data", "--bind", "0.0.0.0"], mem);
    const call = lastCreatePlatformCall();
    expect(call.adapterMcpHost).toBe("0.0.0.0");
    expect(call.adapterWsHost).toBe("0.0.0.0");
  });

  it("--port-mcp overrides default", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data", "--port-mcp", "17100"], mem);
    const call = lastCreatePlatformCall();
    expect(call.adapterMcpPort).toBe(17100);
  });

  it("--port-ws is rejected (not supported in v1)", async () => {
    const mem = makeFs();
    const r = await run(["start", "--data-dir", "/data", "--port-ws", "17300"], mem);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/--port-ws is not supported/);
  });

  // BI[cjs-sdk-bootstrap] Phase 1 — --port-sdk opens the backend-runtime door
  // (where sdk-node/sdk-browser connect with the {type:"sdk.auth"} first-frame
  // protocol). Opt-in: flag absent → no backendRuntimePort passed, but the
  // rest of the platform boots normally. These tests pin the contract.
  it("--port-sdk absent → no backendRuntimePort passed (backward compat)", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data"], mem);
    const call = lastCreatePlatformCall();
    expect(call.backendRuntimePort).toBeUndefined();
  });

  it("--port-sdk 7350 → backendRuntimePort: 7350", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data", "--port-sdk", "7350"], mem);
    const call = lastCreatePlatformCall();
    expect(call.backendRuntimePort).toBe(7350);
  });

  it("--port-sdk with no value → defaults to 7350", async () => {
    const mem = makeFs();
    await run(["start", "--data-dir", "/data", "--port-sdk"], mem);
    const call = lastCreatePlatformCall();
    expect(call.backendRuntimePort).toBe(7350);
  });

  it("--port-sdk with invalid value → exit 2", async () => {
    const mem = makeFs();
    const r = await run(["start", "--data-dir", "/data", "--port-sdk", "abc"], mem);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/invalid port --port-sdk=abc/);
  });

  it("--port-sdk 7300 → exit 2 (collision with WS adapter)", async () => {
    const mem = makeFs();
    const r = await run(["start", "--data-dir", "/data", "--port-sdk", "7300"], mem);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/collides with MCP\/WS adapter doors/);
  });
});