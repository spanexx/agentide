/*
 * Code Map: MCP <-> canonical invocation translation (pure logic, no I/O)
 * - validateMeta: _meta presence gate (PRD Scenario 6, -32602)
 * - decodeScopeFromToken: JWT payload scope for capability.list tier filtering (BI[7])
 * - listTools: capability.list + per-card capability.describe -> MCP Tool[]
 * - callTool: canonical invocation -> MCP CallToolResult (timeout => isError result)
 *
 * All functions are pure: the Gateway reference is passed in, so this module
 * is fully unit-testable with a mock.
 *
 * CID Index:
 * CID:translate-001 -> META_* keys (PRD _meta contract)
 * CID:translate-002 -> validateMeta
 * CID:translate-003 -> decodeScopeFromToken
 * CID:translate-004 -> McpTool / ListToolsOutcome
 * CID:translate-005 -> listTools
 * CID:translate-006 -> CallToolResultShape / CallToolOutcome
 * CID:translate-007 -> callTool
 *
 * Quick lookup: rg -n "CID:translate-" packages/adapter-mcp/src/translate.ts
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import { ERROR_CODES } from "@spanexx/errors";
import { readClaims } from "@spanexx/adapter-core";
import { gatewayErrorToJsonRpc, type JsonRpcError } from "./error-map.js";

export { gatewayErrorToJsonRpc, type JsonRpcError } from "./error-map.js";
export { getRequestCtx } from "./server.js";

// CID:translate-001 - META_* keys
// Purpose: the _meta fields the adapter requires (PRD Scenario 6) and the
//   agentide session id channel.
export const META_PROTOCOL_KEY = "io.modelcontextprotocol/protocolVersion";
export const META_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
export const META_SESSION_ID_KEY = "dev.agentide/sessionId";

// CID:translate-002 - validateMeta
// Purpose: both required _meta keys must be present and non-null.
// Uses: handlers before listTools/callTool
// Used by: index.ts handlers, tests
export function validateMeta(meta: Readonly<Record<string, YamlValue>> | undefined): boolean {
  if (meta === undefined) return false;
  const protocol = meta[META_PROTOCOL_KEY];
  const capabilities = meta[META_CAPABILITIES_KEY];
  return protocol !== undefined && protocol !== null && capabilities !== undefined && capabilities !== null;
}

// CID:translate-003 - decodeScopeFromToken (compat shim)
// Purpose: shared claim reader. Implementation moved to @spanexx/adapter-core's
//   readClaims (A6 lock; identical base64url payload parse + [] defensiveness).
//   Kept as a thin export ONLY so the pre-migration test suite (which imports
//   it by name) stays untouched — zero-delta rule; new code calls readClaims
//   directly.
export function decodeScopeFromToken(token: string): readonly string[] {
  return readClaims(token).scope;
}

// CID:translate-004 - McpTool / ListToolsOutcome
// Purpose: wire-facing tool shape. `annotations.tier` carries the registry
//   tier (PRD Scenario 1) — the SDK transport serializes results as-is.
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<object>;
  readonly annotations: { readonly tier: string | null };
}

export type ListToolsOutcome =
  | { readonly ok: true; readonly tools: readonly McpTool[] }
  | { readonly ok: false; readonly error: JsonRpcError };

interface CardShape {
  readonly name: string;
  readonly description: string;
  readonly tier: string | null;
}

interface DescribeCapability {
  readonly inputSchema: Readonly<object> | undefined;
}

function extractCards(output: YamlValue): readonly CardShape[] {
  if (!Array.isArray(output)) return [];
  const cards: CardShape[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Readonly<Record<string, YamlValue>>;
    const name = rec["name"];
    const description = rec["description"];
    if (typeof name !== "string" || typeof description !== "string") continue;
    const tier = rec["tier"];
    cards.push({ name, description, tier: typeof tier === "string" ? tier : null });
  }
  return cards;
}

function extractCapability(output: YamlValue): DescribeCapability | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return null;
  const rec = output as Readonly<Record<string, YamlValue>>;
  const capability = rec["capability"];
  if (typeof capability !== "object" || capability === null || Array.isArray(capability)) return null;
  const capRec = capability as Readonly<Record<string, YamlValue>>;
  const inputSchema = capRec["inputSchema"];
  return {
    inputSchema:
      typeof inputSchema === "object" && inputSchema !== null && !Array.isArray(inputSchema)
        ? (inputSchema as Readonly<object>)
        : undefined,
  };
}

// CID:translate-005 - listTools
// Purpose: build the MCP tool catalog for one caller: capability.list filtered
//   by the caller's scope, enriched per-card via capability.describe.
//   - describe denied (capability.describe is gated on platform.capability.read,
//     which business-scoped callers lack) -> card kept with a generic schema so
//     the catalog stays visible per BI[7]; authz is still enforced at call time.
//   - describe returns ok but no capability record -> card skipped defensively.
// Uses: decodeScopeFromToken, gatewayErrorToJsonRpc
// Used by: index.ts tools/list handler, tests
export async function listTools(gateway: Gateway, token: string): Promise<ListToolsOutcome> {
  const list = await gateway.handleInvocation({
    token,
    capability: { name: "capability.list" },
    input: { scope: readClaims(token).scope },
  });
  if ("error" in list) {
    return { ok: false, error: gatewayErrorToJsonRpc(list.error.code, list.error.message, "capability.list") };
  }
  const cards = extractCards(list.output);
  const tools: McpTool[] = [];
  for (const card of cards) {
    const describe = await gateway.handleInvocation({
      token,
      capability: { name: "capability.describe" },
      input: { name: card.name },
    });
    let inputSchema: Readonly<object> = { type: "object" };
    if ("error" in describe) {
      // Restricted caller: keep the kernel-filtered card with a generic schema.
      tools.push({
        name: card.name,
        description: card.description,
        inputSchema,
        annotations: { tier: card.tier },
      });
      continue;
    }
    const capability = extractCapability(describe.output);
    if (capability === null) continue;
    inputSchema = capability.inputSchema ?? { type: "object" };
    tools.push({
      name: card.name,
      description: card.description,
      inputSchema,
      annotations: { tier: card.tier },
    });
  }
  return { ok: true, tools };
}

// CID:translate-006 - CallToolResultShape / CallToolOutcome
// Purpose: MCP CallToolResult equivalent — text content + structured content
//   (PRD §Success response); isError only for the timeout path.
export interface CallToolResultShape {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: YamlValue;
  readonly isError?: boolean;
}

export type CallToolOutcome =
  | { readonly ok: true; readonly result: CallToolResultShape }
  | { readonly ok: false; readonly error: JsonRpcError };

// CID:translate-007 - callTool
// Purpose: translate one MCP tools/call into a canonical invocation and back.
//   HANDLER_TIMEOUT becomes an isError:true result (not a JSON-RPC error),
//   per PRD-TRD §Success response.
// Uses: gatewayErrorToJsonRpc
// Used by: index.ts tools/call handler, tests
export async function callTool(
  gateway: Gateway,
  opts: {
    readonly token: string;
    readonly name: string;
    readonly args: YamlValue;
    readonly sessionId: string | undefined;
  },
): Promise<CallToolOutcome> {
  const invocation = {
    token: opts.token,
    capability: { name: opts.name },
    input: opts.args,
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
  };
  const resp = await gateway.handleInvocation(invocation);
  if ("error" in resp) {
    if (resp.error.code === ERROR_CODES.HANDLER_TIMEOUT) {
      return {
        ok: true,
        result: {
          content: [{ type: "text", text: resp.error.message }],
          isError: true,
        },
      };
    }
    return { ok: false, error: gatewayErrorToJsonRpc(resp.error.code, resp.error.message, opts.name) };
  }
  return {
    ok: true,
    result: {
      content: [{ type: "text", text: JSON.stringify(resp.output) }],
      structuredContent: resp.output,
    },
  };
}
