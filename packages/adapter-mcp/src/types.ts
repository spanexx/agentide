/*
 * Code Map: adapter-mcp public types
 * - McpAdapterConfig: factory config (port/host defaults 7100/127.0.0.1)
 * - McpAdapter: Adapter conformance + bound-port accessor
 * - RequestCtx: per-request auth context (token from Authorization header)
 *
 * CID Index:
 * CID:types-001 -> McpAdapterConfig
 * CID:types-002 -> McpAdapter
 * CID:types-003 -> RequestCtx
 *
 * Quick lookup: rg -n "CID:types-" packages/adapter-mcp/src/types.ts
 */

import type { OAuthTokenHandler } from "@spanexx/gateway-core";

// CID:types-001 - McpAdapterConfig
// Purpose: factory config for createMcpAdapter; port/host defaults applied
//   by the factory when fields are absent. `oauth` enables the POST /oauth/token
//   route (BI[29] Phase 4) when the gateway exposes its OAuthTokenHandler.
export interface McpAdapterConfig {
  readonly port?: number; // default 7100
  readonly host?: string; // default "127.0.0.1"
  readonly oauth?: OAuthTokenHandler;
}

// CID:types-002 - McpAdapter
// Purpose: the MCP adapter handle. Conforms to the kernel Adapter interface
//   (gateway-core) and additionally exposes the bound port — useful when
//   port 0 (OS-assigned) is used by tests.
export interface McpAdapter {
  readonly name: "mcp";
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number | null;
}

// CID:types-003 - RequestCtx
// Purpose: per-request context stashed in AsyncLocalStorage so MCP handler
//   callbacks can read the caller's bearer token (Authorization header).
//   The sessionId is resolved by the handlers from `_meta.dev.agentide/sessionId`
//   inside the request body (validated there).
export interface RequestCtx {
  readonly token: string | null;
}
