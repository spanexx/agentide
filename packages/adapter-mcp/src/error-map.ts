/*
 * Code Map: MCP error table for the shared adapter-core converter (A5)
 * - MCP_ERROR_TABLE: gateway code → JSON-RPC error (-32001..-32006),
 *   matching the pre-migration PRD-TRD table byte-for-byte.
 * - mcpErrorConverter: the shared converter (createErrorConverter) built with
 *   this table — used by the adapter-core pipeline path (Phase 4).
 * - gatewayErrorToJsonRpc: COMPAT shim preserving the pre-migration signature
 *   (code, message, capabilityName?) so the unedited test suite + translate.ts
 *   keep working — zero-delta rule. It delegates to mcpErrorConverter.
 *
 * HANDLER_TIMEOUT is deliberately NOT in the table: callTool intercepts it
 * before conversion (isError:true result, PRD §Success response); if it ever
 * reaches the converter, the shared default renders `-32006 <code>: <msg>`
 * exactly like the old switch's fallback.
 *
 * CID Index:
 * CID:error-map-001 -> JsonRpcError
 * CID:error-map-002 -> gatewayErrorToJsonRpc (compat shim)
 * CID:error-map-003 -> MCP_ERROR_TABLE
 *
 * Quick lookup: rg -n "CID:error-map-" packages/adapter-mcp/src/error-map.ts
 */

import { ERROR_CODES } from "@spanexx/errors";
import {
  createErrorConverter,
  type ErrorTable,
  type GatewayErrorDetailValue,
} from "@spanexx/adapter-core";

// CID:error-map-001 - JsonRpcError
// Purpose: JSON-RPC 2.0 error envelope produced by the adapter.
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
}

const NOT_FOUND_DETAIL = "capability";

// CID:error-map-003 - MCP_ERROR_TABLE
// Purpose: the door's code table (A5: tables stay door-local). Outputs are
//   byte-identical to the pre-migration switch in gatewayErrorToJsonRpc.
export const MCP_ERROR_TABLE: ErrorTable = {
  [ERROR_CODES.AUTH_FAILED]: { code: -32001, message: "GATEWAY_AUTH_FAILED" },
  [ERROR_CODES.TOKEN_INVALID]: { code: -32001, message: "GATEWAY_AUTH_FAILED" },
  [ERROR_CODES.TOKEN_EXPIRED]: { code: -32001, message: "GATEWAY_AUTH_FAILED" },
  [ERROR_CODES.CAPABILITY_NOT_FOUND]: (payload) => ({
    code: -32001,
    message: `capability '${String((payload.details ?? {})[NOT_FOUND_DETAIL] ?? "unknown")}' not found`,
  }),
  [ERROR_CODES.INSUFFICIENT_SCOPE]: { code: -32002, message: "GATEWAY_INSUFFICIENT_SCOPE" },
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: (payload) => ({ code: -32003, message: payload.message }),
  [ERROR_CODES.PLUGIN_DISABLED]: (payload) => ({ code: -32004, message: payload.message }),
  [ERROR_CODES.SDK_UNREACHABLE]: (payload) => ({ code: -32005, message: payload.message }),
  [ERROR_CODES.INTERNAL_ERROR]: (payload) => ({ code: -32006, message: payload.message }),
  [ERROR_CODES.HANDLER_ERROR]: (payload) => ({ code: -32006, message: payload.message }),
};

// Shared converter instance with the door's table (Phase 4 pipeline path).
export const mcpErrorConverter = createErrorConverter({ table: MCP_ERROR_TABLE });

// CID:error-map-002 - gatewayErrorToJsonRpc (compat shim)
// Purpose: same signature + output as pre-migration; delegates to the shared
//   converter. The capability name rides in details so the table can render
//   the CAPABILITY_NOT_FOUND message verbatim.
export function gatewayErrorToJsonRpc(
  code: string,
  kernelMessage: string,
  capabilityName?: string,
): JsonRpcError {
  const details: Readonly<Record<string, GatewayErrorDetailValue>> =
    capabilityName === undefined ? {} : { [NOT_FOUND_DETAIL]: capabilityName };
  const converted = mcpErrorConverter({ code, message: kernelMessage, details, retryable: false });
  return { code: converted.code as number, message: converted.message };
}
