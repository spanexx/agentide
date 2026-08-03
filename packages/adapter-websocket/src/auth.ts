/*
 * Code Map: adapter-websocket JWT verification + origin binding
 * - authenticateToken: token verify → origin binding → tenant state, returns TokenClaims or lowercase phrase code
 * - originMatches: re-exported from `@platform/gateway-core/origin` so backend-runtime + adapter-websocket share one primitive
 *
 * CID Index:
 * CID:auth-001 -> authenticateToken
 * CID:auth-002 -> originMatches
 *
 * Quick lookup: rg -n "CID:auth-" packages/adapter-websocket/src/auth.ts
 */

import {
  ERROR_CODES,
  originMatches,
  verifyToken,
  type Clock,
  type TenantRecord,
  type TokenClaims,
} from "@platform/gateway-core";
import { AUTH_ERROR_CODES } from "./types.js";

// CID:auth-002 - originMatches
// Purpose: shared RFC 6125 §6.4.3 single-label wildcard primitive. Canonical
//   implementation lives in `@platform/gateway-core/src/origin.ts`; re-exported
//   here so adapter consumers can wire auth without a direct gateway-core
//   import.
export { originMatches };

export interface AuthContext {
  readonly clock: Clock;
  readonly tokenSecret: Uint8Array;
  readonly origin: string | undefined;
  readonly listTenants: () => readonly TenantRecord[];
}

export type AuthResult =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly code: string };

// CID:auth-001 - authenticateToken
// Purpose: verify the JWT (HS256 via gateway-core), then enforce origin binding
//   + tenant state. The five lowercase phrase codes map 1:1 to auth.error frames
//   on the wire (PRD W2 sub-Q 1 / scenarios 2 + 4).
// Used by: server.ts processAuth
export function authenticateToken(token: string | undefined, context: AuthContext): AuthResult {
  if (token === undefined || token.length === 0) {
    return { ok: false, code: AUTH_ERROR_CODES.TOKEN_MISSING };
  }
  const verified = verifyToken(token, context.clock, context.tokenSecret);
  if (!verified.ok) {
    return {
      ok: false,
      code: verified.code === ERROR_CODES.TOKEN_EXPIRED
        ? AUTH_ERROR_CODES.TOKEN_EXPIRED
        : AUTH_ERROR_CODES.TOKEN_INVALID,
    };
  }
  const expectedOrigins = verified.claims.expectedOrigins ?? [];
  if (!originMatches(context.origin, expectedOrigins)) {
    return { ok: false, code: AUTH_ERROR_CODES.ORIGIN_MISMATCH };
  }
  const tenant = context.listTenants().find((record) => record.id === verified.claims.sub.tenantId);
  if (tenant?.suspended === true) {
    return { ok: false, code: AUTH_ERROR_CODES.TENANT_SUSPENDED };
  }
  return { ok: true, claims: verified.claims };
}
