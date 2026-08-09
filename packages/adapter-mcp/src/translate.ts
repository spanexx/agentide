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
import { createAdapterPipeline, createCapabilityLookup, readClaims, type ResponseChannelSink } from "@spanexx/adapter-core";
import { gatewayErrorToJsonRpc, mcpErrorConverter, type JsonRpcError } from "./error-map.js";

export { gatewayErrorToJsonRpc, type JsonRpcError } from "./error-map.js";
export { getRequestCtx } from "./server.js";

// CID:translate-001 - META_* keys
// Purpose: the _meta fields the adapter requires (PRD Scenario 6) and the
//   agentide session id channel.
export const META_PROTOCOL_KEY = "io.modelcontextprotocol/protocolVersion";
export const META_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
export const META_SESSION_ID_KEY = "dev.agentide/sessionId";

// CID:translate-002 - validateMeta
// Purpose: true when both _meta keys are present and non-null.
// D-124 (2026-08-09): NO LONGER a hard gate — real MCP clients (Zed, the
//   official SDK) send _meta only in initialize, never on tools requests, so
//   the handlers accept missing _meta (see index.ts). Kept exported for
//   callers/tests that still want to inspect the value.
// Used by: tests
// Retained by: translate.test.ts (pure-function pins)
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

// CID:translate-005 - listTools
// Purpose: build the MCP tool catalog for one caller: capability.list filtered
//   by the caller's scope, enriched per-card via capability.describe.
//   - describe denied (capability.describe is gated on platform.capability.read,
//     which business-scoped callers lack) -> card kept with a generic schema so
//     the catalog stays visible per BI[7]; authz is still enforced at call time.
//   - describe returns ok but no capability record -> card skipped defensively.
// Uses: readClaims + gatewayErrorToJsonRpc (list path, zero-delta — preserves
//   the capability-name interpolation in the CAPABILITY_NOT_FOUND error so the
//   error message stays "capability 'capability.list' not found"); createCapabilityLookup
//   (describe path only — the lookup's kernel-shape-aware descriptor extractor
//   replaces the local extractCapability).
// Used by: index.ts tools/list handler, tests

export async function listTools(gateway: Gateway, token: string): Promise<ListToolsOutcome> {
  // List path: direct gateway call (zero-delta — preserves CAPABILITY_NOT_FOUND
  // message including the capability-name interpolation, which the shared
  // converter loses because it operates on the converted DoorError, not the
  // raw kernel payload).
  const list = await gateway.handleInvocation({
    token,
    capability: { name: "capability.list" },
    input: { scope: readClaims(token).scope },
  });
  if ("error" in list) {
    return { ok: false, error: gatewayErrorToJsonRpc(list.error.code, list.error.message, "capability.list") };
  }
  // Describe path: through the shared lookup (kernel shape, no nesting assumed
  // by the door).
  const lookup = createCapabilityLookup({ gateway, errors: mcpErrorConverter });
  const cards = Array.isArray(list.output) ? extractCards(list.output) : [];
  const tools: McpTool[] = [];
  for (const card of cards) {
    const describe = await lookup.describe(card.name, token);
    if (!describe.ok) {
      // Restricted caller: keep the kernel-filtered card with a generic schema.
      tools.push({
        name: card.name,
        description: card.description,
        inputSchema: { type: "object" },
        annotations: { tier: card.tier },
      });
      continue;
    }
    const descriptor = describe.value;
    if (descriptor.name === "") continue; // no record (kernel: capability null) -> skip
    const inputSchema =
      descriptor.inputSchema !== null && !Array.isArray(descriptor.inputSchema)
        ? descriptor.inputSchema
        : { type: "object" };
    tools.push({
      name: card.name,
      description: card.description,
      inputSchema,
      annotations: { tier: card.tier },
    });
  }
  return { ok: true, tools };
}

function extractCards(output: readonly YamlValue[]): readonly { name: string; description: string; tier: string | null }[] {
  const cards: { name: string; description: string; tier: string | null }[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Readonly<Record<string, YamlValue>>;
    const name = rec["name"];
    const description = rec["description"];
    if (typeof name !== "string" || typeof description !== "string") continue;
    const tier = rec["tier"];
    cards.push({ name, description, tier: typeof tier === "string" ? tier : null });
  }
  return cards;
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
// Uses: gatewayErrorToJsonRpc (error path), createAdapterPipeline (Phase 4).
// Used by: index.ts tools/call handler, tests

interface McpCallToolSinkResult {
  readonly ok: true;
  readonly output: YamlValue;
}
interface McpCallToolSinkError {
  readonly ok: false;
  readonly code: string | number;
  readonly message: string;
}

// MCP single-result strategy: collect the one emitResult / emitError into a
// buffer so callTool can shape the CallToolResult after pipeline.invoke returns.
// No stream mode for MCP (kernel is single-shot); emitChunk/emitEvent dropped.
function mcpCallToolSink(capabilityName: string): ResponseChannelSink & {
  result: McpCallToolSinkResult | McpCallToolSinkError | undefined;
} {
  let captured:
    | (McpCallToolSinkResult | McpCallToolSinkError)
    | undefined;
  const sink: ResponseChannelSink & {
    result: typeof captured;
  } = {
    result: undefined,
    emitChunk() {
      /* MCP has no streaming mode — drop */
    },
    emitEvent() {
      /* MCP does not forward events — drop */
    },
    emitResult(output: YamlValue) {
      captured = { ok: true, output };
    },
    emitError(err: { readonly code: string | number; readonly message: string; readonly details?: Readonly<Record<string, YamlValue>> }) {
      // CAPABILITY_NOT_FOUND: the shared converter emits
      //   { code: -32001, message: "capability 'unknown' not found" } when the
      //   kernel didn't include a capability detail. The MCP door owns this
      //   interpolation (matches the pre-migration gatewayErrorToJsonRpc
      //   formatting: capability '<name>' not found).
      if (
        err.code === -32001 &&
        err.message.startsWith("capability 'unknown' not found")
      ) {
        captured = {
          ok: false,
          code: err.code,
          message: `capability '${capabilityName}' not found`,
        };
        return;
      }
      // HANDLER_TIMEOUT: the table preserves the kernel code; the door renders
      // an isError:true result instead of a JSON-RPC error (matches the
      // pre-migration callTool special path).
      if (
        typeof err.code === "string" &&
        err.code === ERROR_CODES.HANDLER_TIMEOUT
      ) {
        captured = {
          ok: false,
          code: err.code,
          message: err.message,
        };
        return;
      }
      captured = { ok: false, code: err.code, message: err.message };
    },
  };
  return new Proxy(sink, {
    get(target, prop) {
      if (prop === "result") return captured;
      return Reflect.get(target, prop);
    },
  });
}

export async function callTool(
  gateway: Gateway,
  opts: {
    readonly token: string;
    readonly name: string;
    readonly args: YamlValue;
    readonly sessionId: string | undefined;
  },
): Promise<CallToolOutcome> {
  const sink = mcpCallToolSink(opts.name);
  const pipeline = createAdapterPipeline({
    gateway,
    errors: mcpErrorConverter,
    response: (_correlationId: string) => sink,
  });
  await pipeline.invoke({
    correlationId: `ct-${opts.name}`,
    token: opts.token,
    name: opts.name,
    input: opts.args,
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
  });
  const captured = sink.result;
  if (captured === undefined) {
    // No emit reached the sink — pipeline produced nothing (impossible on
    // current kernel, but be defensive). Match pre-migration timeout shape.
    return {
      ok: true,
      result: { content: [{ type: "text", text: "" }], isError: true },
    };
  }
  if (!captured.ok) {
    if (captured.code === ERROR_CODES.HANDLER_TIMEOUT) {
      return {
        ok: true,
        result: {
          content: [{ type: "text", text: captured.message }],
          isError: true,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: Number(captured.code),
        message: captured.message,
      } as JsonRpcError,
    };
  }
  return {
    ok: true,
    result: {
      content: [{ type: "text", text: JSON.stringify(captured.output) }],
      structuredContent: captured.output,
    },
  };
}
