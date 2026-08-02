/*
 * Code Map: shared platform errors
 * - ERROR_CODES: 18 stable GATEWAY_* string identifiers (single source of truth)
 * - GatewayError: Error subclass with code/message/details/retryable
 *
 * Lives in its own package so both gateway-core and backend-runtime can
 * depend on it without a circular dep (backend-runtime maps SDK errors
 * to gateway errors; gateway-core consumes them).
 *
 * CID Index:
 * CID:errors-001 -> ERROR_CODES
 * CID:errors-002 -> GatewayError
 * CID:errors-003 -> GatewayErrorPayload
 *
 * Quick lookup: rg -n "CID:errors-" packages/errors/src/index.ts
 */

export interface GatewayErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, GatewayErrorDetailValue>>;
  readonly retryable: boolean;
}

export type GatewayErrorDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly GatewayErrorDetailValue[]
  | { readonly [key: string]: GatewayErrorDetailValue };

// CID:errors-001 - ERROR_CODES
// Purpose: 18 stable string identifiers used across every Gateway failure path; consumers (MCP adapters, dashboards, CI scripts) match on these codes
export const ERROR_CODES = {
  AUTH_FAILED: "GATEWAY_AUTH_FAILED",
  TOKEN_INVALID: "GATEWAY_TOKEN_INVALID",
  TOKEN_EXPIRED: "GATEWAY_TOKEN_EXPIRED",
  INSUFFICIENT_SCOPE: "GATEWAY_INSUFFICIENT_SCOPE",
  UNAUTHORIZED_OPERATION: "GATEWAY_UNAUTHORIZED_OPERATION",
  SESSION_REQUIRED: "GATEWAY_SESSION_REQUIRED",
  RATE_LIMIT_EXCEEDED: "GATEWAY_RATE_LIMIT_EXCEEDED",
  CAPABILITY_NOT_FOUND: "GATEWAY_CAPABILITY_NOT_FOUND",
  PLUGIN_NOT_INSTALLED: "GATEWAY_PLUGIN_NOT_INSTALLED",
  PLUGIN_DISABLED: "GATEWAY_PLUGIN_DISABLED",
  SDK_UNREACHABLE: "GATEWAY_SDK_UNREACHABLE",
  MANAGER_UNAVAILABLE: "GATEWAY_MANAGER_UNAVAILABLE",
  HANDLER_TIMEOUT: "GATEWAY_HANDLER_TIMEOUT",
  HANDLER_NOT_FOUND: "GATEWAY_HANDLER_NOT_FOUND",
  HANDLER_ERROR: "GATEWAY_HANDLER_ERROR",
  INTERNAL_ERROR: "GATEWAY_INTERNAL_ERROR",
  TENANT_MISMATCH: "GATEWAY_TENANT_MISMATCH",
  INVALID_REQUEST: "GATEWAY_INVALID_REQUEST",
} as const;

// CID:errors-002 - GatewayError
// Purpose: Error subclass with structured code/message/details/retryable; the kernel throws this on every failure path; consumers match on `.code`
export class GatewayError extends Error implements GatewayErrorPayload {
  public readonly code: string;
  public readonly details: Readonly<Record<string, GatewayErrorDetailValue>>;
  public readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, GatewayErrorDetailValue>> = {},
    retryable: boolean = false,
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}
