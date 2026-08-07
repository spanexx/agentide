/*
 * Code Map: REST error table for the shared adapter-core converter (A5/A9)
 * - REST_ERROR_TABLE: gateway code → HTTP status — the locked Q4 map
 *   (token-* → 401, scope-* → 403, session/invalid → 400, not-found → 404,
 *   rate → 429, runtime → 500). Every entry passes the GatewayErrorPayload
 *   body through VERBATIM: REST renders the envelope as-is
 *   ({code, message, details, retryable}), the table only resolves the
 *   HTTP status (A9 Q4 lock — retryable stays in the body, never the status).
 * - restErrorConverter: the shared converter (createErrorConverter) built
 *   with this table. Unmapped codes fall in the runtime family (500) with
 *   the payload verbatim — the door never invents a code or rewrites a message.
 *
 * CID Index:
 * CID:adapter-rest-errors-001 -> RestErrorPayload
 * CID:adapter-rest-errors-002 -> REST_ERROR_TABLE
 * CID:adapter-rest-errors-003 -> restErrorConverter
 */

import { ERROR_CODES } from "@spanexx/errors";
import type { GatewayErrorPayload } from "@spanexx/errors";
import { createErrorConverter, type DoorError, type ErrorTable } from "@spanexx/adapter-core";

// CID:adapter-rest-errors-001 - RestErrorPayload
// Purpose: door-facing error output — the HTTP status resolved by the locked
//   table plus the GatewayErrorPayload fields VERBATIM (the wire body).
export interface RestErrorPayload extends DoorError {
  /** HTTP status from the locked Q4 table. */
  readonly status: number;
  /** Verbatim from the kernel payload — never rewritten by the door. */
  readonly retryable: boolean;
}

// Verbatim passthrough + status. The body fields (code/message/details/
// retryable) are NEVER translated — REST renders the shared envelope as-is.
const entry = (status: number) => (payload: GatewayErrorPayload): RestErrorPayload => ({
  code: payload.code,
  message: payload.message,
  details: payload.details,
  retryable: payload.retryable,
  status,
});

// CID:adapter-rest-errors-002 - REST_ERROR_TABLE
// Purpose: the door's code table (A5: tables stay door-local). 18 entries —
//   the full ERROR_CODES catalog, one row per locked family.
export const REST_ERROR_TABLE: ErrorTable = {
  // auth family → 401
  [ERROR_CODES.TOKEN_INVALID]: entry(401),
  [ERROR_CODES.TOKEN_EXPIRED]: entry(401),
  [ERROR_CODES.AUTH_FAILED]: entry(401),
  // authz family → 403
  [ERROR_CODES.INSUFFICIENT_SCOPE]: entry(403),
  [ERROR_CODES.UNAUTHORIZED_OPERATION]: entry(403),
  [ERROR_CODES.TENANT_MISMATCH]: entry(403),
  // request family → 400
  [ERROR_CODES.SESSION_REQUIRED]: entry(400),
  [ERROR_CODES.INVALID_REQUEST]: entry(400),
  // not-found family → 404
  [ERROR_CODES.CAPABILITY_NOT_FOUND]: entry(404),
  [ERROR_CODES.HANDLER_NOT_FOUND]: entry(404),
  [ERROR_CODES.PLUGIN_NOT_INSTALLED]: entry(404),
  // rate family → 429
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: entry(429),
  // runtime family → 500
  [ERROR_CODES.SDK_UNREACHABLE]: entry(500),
  [ERROR_CODES.HANDLER_TIMEOUT]: entry(500),
  [ERROR_CODES.PLUGIN_DISABLED]: entry(500),
  [ERROR_CODES.MANAGER_UNAVAILABLE]: entry(500),
  [ERROR_CODES.HANDLER_ERROR]: entry(500),
  [ERROR_CODES.INTERNAL_ERROR]: entry(500),
};

// Unmapped codes → runtime family: 500, body verbatim (matches the Q4 lock).
const DEFAULT_REST_ERROR = (payload: GatewayErrorPayload): RestErrorPayload => ({
  code: payload.code,
  message: payload.message,
  details: payload.details,
  retryable: payload.retryable,
  status: 500,
});

// CID:adapter-rest-errors-003 - restErrorConverter
// Purpose: the shared converter (A5) built with the door's table — used by
//   the adapter-core pipeline path (Phase 3 invoke.ts) and the server
//   (Phase 5). The narrowing cast is honest: every table entry and the
//   default DO return RestErrorPayload; the generic ErrorConverter type
//   erases the door-local `status` field.
export const restErrorConverter = createErrorConverter({
  table: REST_ERROR_TABLE,
  defaultError: DEFAULT_REST_ERROR,
}) as (payload: GatewayErrorPayload) => RestErrorPayload;
