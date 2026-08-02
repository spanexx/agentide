/*
 * Code Map: MCP adapter factory
 * - createMcpAdapter: builds the McpAdapter handle (start/stop + port accessor)
 *   wiring the low-level MCP Server handlers to the gateway kernel.
 *
 * Phase 4 real implementation: the Server is the low-level MCP `Server` (not
 *   `McpServer`, which intercepts unknown tool calls with -32602 invalid params
 *   — that would mask PRD Scenario 4's "not found" mapping). Handlers read
 *   the bearer token from AsyncLocalStorage (set by startMcpHttpServer from
 *   the Authorization header) and the sessionId from `_meta.dev.agentide/sessionId`.
 *
 * Wire errors: we throw `WireError` (plain Error + numeric code) instead of the
 * SDK's McpError, because McpError prefixes messages with "MCP error <code>: "
 * (SDK dist/esm/types.js) and the PRD asserts the messages verbatim
 * (e.g. "GATEWAY_INSUFFICIENT_SCOPE"). The protocol layer serializes
 * `error.code` / `error.message` as-is for any thrown Error (shared/protocol.js).
 *
 * CID Index:
 * CID:index-001 -> createMcpAdapter
 *
 * Quick lookup: rg -n "CID:index-" packages/adapter-mcp/src/index.ts
 */

import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Gateway, YamlValue } from "@platform/gateway-core";
import { callTool, getRequestCtx, listTools, META_SESSION_ID_KEY, validateMeta } from "./translate.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "./server.js";
import type { McpAdapter, McpAdapterConfig } from "./types.js";

// Wire-level JSON-RPC codes that are not in the SDK's ErrorCode enum.
// -32001..-32006 are the agentide-specific codes defined in PRD-TRD §API Contracts.
const WIRE_AUTH_FAILED = -32001;
const WIRE_INVALID_PARAMS = -32602;
const AUTH_FAILED_MESSAGE = "GATEWAY_AUTH_FAILED";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7100;

// CID:index-002 - WireError
// Purpose: JSON-RPC error thrown by adapter handlers. Carries the wire code and
//   the exact wire message; the SDK protocol layer serializes both verbatim.
class WireError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "WireError";
  }
}

// CID:index-001 - createMcpAdapter
// Purpose: factory — wires the gateway reference + config into a running MCP
//   adapter handle. Listens on config.host/port (port 0 = OS-assigned for tests).
//   start() is idempotent: subsequent calls are no-ops; stop() releases the port
//   and transport and is itself idempotent.
// Uses: McpServer (low-level) + startMcpHttpServer; translate.ts for kernel call
// Used by: @platform/agentide createPlatform() (Phase 5), tests, boot scripts
export function createMcpAdapter(gateway: Gateway, config: McpAdapterConfig = {}): McpAdapter {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  let handle: McpHttpServerHandle | null = null;

  return {
    name: "mcp",
    async start(): Promise<void> {
      if (handle !== null) return;
      const server = new McpServer(
        { name: "agentide-mcp-adapter", version: "0.0.0" },
        { capabilities: { tools: {} } },
      );
      // The low-level `Server` only has a default -32601 for unknown methods
      // (handled by the SDK). For tools/list and tools/call we register handlers
      // that read the per-request context (bearer token) from AsyncLocalStorage.
      server.setRequestHandler(ListToolsRequestSchema, async (request) => {
        const ctx = getRequestCtx();
        const token = ctx?.token ?? "";
        if (token.length === 0) {
          // PRD Scenario 8: missing bearer maps to -32001 GATEWAY_AUTH_FAILED.
          throw new WireError(WIRE_AUTH_FAILED, AUTH_FAILED_MESSAGE);
        }
        if (!validateMeta(request.params?._meta as Readonly<Record<string, YamlValue>> | undefined)) {
          throw new WireError(
            WIRE_INVALID_PARAMS,
            "Missing required _meta.io.modelcontextprotocol/protocolVersion or clientCapabilities",
          );
        }
        const outcome = await listTools(gateway, token);
        if (!outcome.ok) {
          throw new WireError(outcome.error.code, outcome.error.message);
        }
        return { tools: outcome.tools };
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const ctx = getRequestCtx();
        const token = ctx?.token ?? "";
        if (token.length === 0) {
          throw new WireError(WIRE_AUTH_FAILED, AUTH_FAILED_MESSAGE);
        }
        const params = request.params;
        if (!validateMeta(params._meta as Readonly<Record<string, YamlValue>> | undefined)) {
          throw new WireError(
            WIRE_INVALID_PARAMS,
            "Missing required _meta.io.modelcontextprotocol/protocolVersion or clientCapabilities",
          );
        }
        // Session id: read from _meta when present, undefined otherwise.
        const rawSessionId = params._meta === undefined ? undefined : params._meta[META_SESSION_ID_KEY];
        const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
        const outcome = await callTool(gateway, {
          token,
          name: params.name,
          args: (params.arguments ?? {}) as YamlValue,
          sessionId,
        });
        if (!outcome.ok) {
          // Preserve the wire code (e.g. -32001 GATEWAY_AUTH_FAILED, -32002
          // INSUFFICIENT_SCOPE) produced by gatewayErrorToJsonRpc.
          throw new WireError(outcome.error.code, outcome.error.message);
        }
        const { content, structuredContent, isError } = outcome.result;
        return { content: [...content], structuredContent, isError } as CallToolResult;
      });

      handle = await startMcpHttpServer(server, { host, port });
    },
    async stop(): Promise<void> {
      if (handle === null) return;
      const h = handle;
      handle = null;
      await h.stop();
    },
    get port(): number | null {
      return handle?.port ?? null;
    },
  } as McpAdapter;
}

export type { McpAdapter, McpAdapterConfig } from "./types.js";
