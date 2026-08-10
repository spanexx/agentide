/*
 * Test harness for the MCP adapter scenario tests: real gateway kernel +
 * real HTTP drive of createMcpAdapter. Shared by scenarios.test.ts so the
 * spec files stay under the repo's 350-line limit.
 */

import { createMcpAdapter, type McpAdapter } from "../index.js";
import { createGateway, issueToken } from "@spanexx/gateway-core";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry, type CapabilityRecord, type CapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager, type SessionManager } from "@spanexx/session-manager";
import { createPluginManager, type PluginManager } from "@spanexx/plugin-manager";
import type { BackendRuntime, BackendValue } from "@spanexx/backend-runtime";
import type { Clock, FileSystem } from "@spanexx/gateway-core";

export const JSON_RPC_ACCEPT = "application/json, text/event-stream";

export const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

export class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void { /* no-op */ }
  advance(ms: number): void { this.nowValue += ms; }
}

export class SystemClock implements Clock {
  now(): number { return Date.now(); }
  setTimeout(callback: () => void, delayMs: number): number {
    return setTimeout(callback, delayMs) as unknown as number;
  }
  clearTimeout(handle: number): void { clearTimeout(handle); }
}

export class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

export function makeToken(scope: readonly string[]): string {
  return issueToken(
    {
      sub: { tenantId: "default", callerId: "agentide-tester" },
      scope: [...scope],
      iat: 1_700_000_000_000,
      exp: 1_700_000_003_600,
    },
    TEST_SECRET,
    new FakeClock(),
  );
}

export function customerReadCard(): CapabilityRecord {
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

export function customerDeleteCard(): CapabilityRecord {
  return {
    name: "customer.delete",
    version: "1.0.0",
    type: "business",
    description: "Delete a customer",
    permissions: ["customer.delete"],
    owner: "backend-sdk-customer-app",
  };
}

export interface FakeSdk extends BackendRuntime {
  readonly dispatched: Array<{ owner: string; capability: string; input: BackendValue; sessionId: string | undefined }>;
}

export function makeFakeSdk(): FakeSdk {
  const dispatched: Array<{ owner: string; capability: string; input: BackendValue; sessionId: string | undefined }> = [];
  return {
    dispatched,
    async start() { /* no-op */ },
    async stop() { /* no-op */ },
    async dispatchInvocation(owner, capability, input, sessionId): Promise<BackendValue> {
      dispatched.push({ owner, capability: capability.name, input, sessionId });
      if (capability.name === "customer.read") {
        return { id: (input as { id: string }).id, name: "Ada Lovelace" };
      }
      return { ok: true };
    },
    connectionCount(): number { return 1; },
    address() { return { port: 0, host: "127.0.0.1" }; },
  };
}

export interface NeverSdk extends BackendRuntime {
  readonly pending: Promise<never>[];
}
export function makeNeverSdk(): NeverSdk {
  return {
    pending: [new Promise<never>(() => { /* never resolves */ })],
    async start() { /* no-op */ },
    async stop() { /* no-op */ },
    async dispatchInvocation(): Promise<BackendValue> {
      return new Promise<BackendValue>(() => { /* never resolves */ });
    },
    connectionCount(): number { return 1; },
    address() { return { port: 0, host: "127.0.0.1" }; },
  };
}

export interface Harness {
  adapter: McpAdapter;
  sm: SessionManager;
  fakeSdk: FakeSdk;
  createSession: () => Promise<string>;
  stop: () => Promise<void>;
}

export const META = {
  "io.modelcontextprotocol/protocolVersion": "2025-11-25",
  "io.modelcontextprotocol/clientCapabilities": { tools: {} },
};

export interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly result?: {
    tools?: Array<{ name: string; description: string; inputSchema: object; annotations: { tier: string | null } }>;
    catalogVersion?: string; // D-127 (mcp-tools-refresh)
    content?: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  readonly error?: { code: number; message: string };
}

export async function rpc(
  adapter: McpAdapter,
  body: string,
  auth: string | null = null,
): Promise<{ status: number; json: JsonRpcResponse }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: JSON_RPC_ACCEPT };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`http://127.0.0.1:${adapter.port}/mcp`, { method: "POST", headers, body });
  return { status: res.status, json: await res.json() as JsonRpcResponse };
}

const tracked: McpAdapter[] = [];

export function track(adapter: McpAdapter): void {
  tracked.push(adapter);
}

export async function stopAllTracked(): Promise<void> {
  while (tracked.length > 0) {
    const a = tracked.pop();
    await a?.stop();
  }
}

export async function start(opts: { backendRuntime?: BackendRuntime; handlerTimeoutMs?: number } = {}): Promise<Harness> {
  const fs = new InMemoryFs();
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry: CapabilityRegistry = createCapabilityRegistry(bus);
  const sm: SessionManager = createSessionManager(bus, { clock });
  const pm: PluginManager = await createPluginManager(bus, registry, { fs, clock, installRecordPath: "/data/installed-plugins.json" });
  registry.register("backend-sdk-customer-app", {
    owner: "backend-sdk-customer-app",
    capabilities: [customerReadCard(), customerDeleteCard()],
  });
  const fakeSdk = (opts.backendRuntime ?? makeFakeSdk()) as FakeSdk;
  const gateway = await createGateway(bus, registry, sm, pm, {
    fs,
    clock,
    auditLogPath: "/data/audit.log",
    tenantsPath: "/data/tenants.json",
    secretPath: "/data/gateway-secret",
    backendRuntime: opts.backendRuntime ?? fakeSdk,
    ...(opts.handlerTimeoutMs !== undefined ? { handlerTimeoutMs: opts.handlerTimeoutMs } : {}),
  });
  await gateway.createTenant({ id: "default", name: "Default Test Tenant" });
  const adapter = createMcpAdapter(gateway, { host: "127.0.0.1", port: 0 });
  await adapter.start();
  track(adapter);
  return {
    adapter,
    sm,
    fakeSdk,
    createSession: async () => {
      const s = sm.create({ ownerId: "agentide-tester", adapterType: "mcp" });
      return s.id;
    },
    stop: async () => {
      await adapter.stop();
    },
  };
}
