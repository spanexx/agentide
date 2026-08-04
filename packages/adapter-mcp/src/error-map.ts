/*
 * Code Map: kernel error -> JSON-RPC error translation
 * - JsonRpcError: error envelope handed to the MCP protocol layer
 * - gatewayErrorToJsonRpc: maps GATEWAY_* codes to the PRD-TRD error table
 *   (-32001..-32006). HANDLER_TIMEOUT is deliberately NOT mapped here —
 *   callTool turns it into an isError:true result instead (PRD §Success response).
 *
 * CID Index:
 * CID:error-map-001 -> JsonRpcError
 * CID:error-map-002 -> gatewayErrorToJsonRpc
 *
 * Quick lookup: rg -n "CID:error-map-" packages/adapter-mcp/src/error-map.ts
 */

import { ERROR_CODES } from "@spanexx/errors";

// CID:error-map-001 - JsonRpcError
// Purpose: JSON-RPC 2.0 error envelope produced by the adapter.
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
}

// CID:error-map-002 - gatewayErrorToJsonRpc
// Purpose: map a canonical kernel error code to the wire-facing JSON-RPC error.
//   Wire messages are owned by the adapter (PRD asserts them verbatim); the
//   full kernel message is logged server-side for operators.
// Uses: callTool/listTools on {error} responses
// Used by: translate.ts, tests
export function gatewayErrorToJsonRpc(
  code: string,
  kernelMessage: string,
  capabilityName?: string,
): JsonRpcError {
  switch (code) {
    case ERROR_CODES.AUTH_FAILED:
    case ERROR_CODES.TOKEN_INVALID:
    case ERROR_CODES.TOKEN_EXPIRED:
      return { code: -32001, message: "GATEWAY_AUTH_FAILED" };
    case ERROR_CODES.CAPABILITY_NOT_FOUND:
      return { code: -32001, message: `capability '${capabilityName ?? "unknown"}' not found` };
    case ERROR_CODES.INSUFFICIENT_SCOPE:
      return { code: -32002, message: "GATEWAY_INSUFFICIENT_SCOPE" };
    case ERROR_CODES.RATE_LIMIT_EXCEEDED:
      return { code: -32003, message: kernelMessage };
    case ERROR_CODES.PLUGIN_DISABLED:
      return { code: -32004, message: kernelMessage };
    case ERROR_CODES.SDK_UNREACHABLE:
      return { code: -32005, message: kernelMessage };
    case ERROR_CODES.INTERNAL_ERROR:
    case ERROR_CODES.HANDLER_ERROR:
      return { code: -32006, message: kernelMessage };
    default:
      // Fallback for any code the adapter does not translate explicitly
      // (SESSION_REQUIRED, TENANT_MISMATCH, INVALID_REQUEST, MANAGER_UNAVAILABLE,
      //  PLUGIN_NOT_INSTALLED, UNAUTHORIZED_OPERATION, HANDLER_NOT_FOUND, ...).
      return { code: -32006, message: `${code}: ${kernelMessage}` };
  }
}
