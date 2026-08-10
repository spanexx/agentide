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
import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import { callTool, getRequestCtx, listTools, META_SESSION_ID_KEY } from "./translate.js";
import { withAutoMintSession } from "@spanexx/adapter-core";
import { startMcpHttpServer, type McpHttpServerHandle } from "./server.js";
import type { McpAdapter, McpAdapterConfig } from "./types.js";

// Wire-level JSON-RPC codes that are not in the SDK's ErrorCode enum.
// -32001..-32006 are the agentide-specific codes defined in PRD-TRD §API Contracts.
const WIRE_AUTH_FAILED = -32001;
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
//
// D-123 (2026-08-09): the MCP SDK's Server keeps PROTOCOL state (initialized)
//   across connections — a single shared Server + stateless transport served
//   only the FIRST connection; every later connection (or reconnect) failed
//   with -32603 (silently swallowed by server.ts's catch). Fix: create a FRESH
//   Server + transport per HTTP request (stateless sessions, no carryover).
export function createMcpAdapter(gateway: Gateway, config: McpAdapterConfig = {}): McpAdapter {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  let handle: McpHttpServerHandle | null = null;

  return {
    name: "mcp",
    async start(): Promise<void> {
      if (handle !== null) return;
      // D-123: per-request server factory — the handler closure is cheap to
      // rebuild and the SDK Server is NOT reusable across connections.
      handle = await startMcpHttpServer(
        { host, port, oauth: config.oauth, createServer: () => createSessionServer(gateway) },
      );
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

// CID:index-003 - createSessionServer (D-123)
// Purpose: build ONE fresh low-level MCP Server with the tools handlers wired
//   to the gateway. Called per HTTP request (stateless protocol state). The
//   low-level `Server` only has a default -32601 for unknown methods; for
//   tools/list and tools/call we register handlers that read the per-request
//   context (bearer token) from AsyncLocalStorage.
export function createSessionServer(gateway: Gateway): McpServer {
  const server = new McpServer(
    { name: "agentide-mcp-adapter", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const ctx = getRequestCtx();
    const token = ctx?.token ?? "";
    if (token.length === 0) {
      // PRD Scenario 8: missing bearer maps to -32001 GATEWAY_AUTH_FAILED.
      throw new WireError(WIRE_AUTH_FAILED, AUTH_FAILED_MESSAGE);
    }
    // D-124 (2026-08-09): the _meta gate was dropped — real MCP clients
    // (Zed, official SDK) send _meta only in initialize, never on tools
    // requests, so requiring it rejected every real client with -32602.
    const outcome = await listTools(gateway, token);
    if (!outcome.ok) {
      throw new WireError(outcome.error.code, outcome.error.message);
    }
    // D-127 (mcp-tools-refresh): the result carries the catalog fingerprint so
    // clients can detect tool-list changes and re-fetch (see PRD-TRD).
    return { tools: outcome.tools, catalogVersion: outcome.catalogVersion };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const ctx = getRequestCtx();
    const token = ctx?.token ?? "";
    if (token.length === 0) {
      throw new WireError(WIRE_AUTH_FAILED, AUTH_FAILED_MESSAGE);
    }
    const params = request.params;
    // D-124: session id is still honored when a client sends it; _meta is
    // otherwise optional (real clients never include it on tools/call).
    const rawSessionId = params._meta === undefined ? undefined : params._meta[META_SESSION_ID_KEY];
    const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
    const outcome = await callTool(gateway, {
      token,
      name: params.name,
      args: (params.arguments ?? {}) as YamlValue,
      sessionId,
    });
    // D-126 (2026-08-09): session-required capabilities (business caps) are
    // auto-minted when the client didn't supply a session — the session-
    // manager GRILL locks per-request short sessions, transparent to the
    // client (the CLI does the same via D-79). Retry ONCE with a minted
    // session; the minted session is destroyed best-effort afterwards.
    let autoMinted = false;
    let effectiveOutcome = outcome;
    if (
      !outcome.ok &&
      sessionId === undefined &&
      typeof outcome.error.code === "number" &&
      outcome.error.code === -32006 &&
      String(outcome.error.message).includes("GATEWAY_SESSION_REQUIRED")
    ) {
      try {
        effectiveOutcome = await withAutoMintSession(
          gateway,
          token,
          (minted) => callTool(gateway, { token, name: params.name, args: (params.arguments ?? {}) as YamlValue, sessionId: minted }),
          { adapterType: "mcp" },
        );
        autoMinted = true;
      } catch (err) {
        // Mint failure: surface the ORIGINAL session-required error (the
        // client asked for the cap; minting is our convenience, not theirs).
        effectiveOutcome = outcome;
      }
    }
    const result = autoMinted ? effectiveOutcome : outcome;
    if (!result.ok) {
      // Preserve the wire code (e.g. -32001 GATEWAY_AUTH_FAILED, -32002
      // INSUFFICIENT_SCOPE) produced by gatewayErrorToJsonRpc.
      throw new WireError(result.error.code, result.error.message);
    }
    const { content, structuredContent, isError } = result.result;
    return { content: [...content], structuredContent, isError } as CallToolResult;
  });
  return server;
}

export type { McpAdapter, McpAdapterConfig } from "./types.js";
