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

import { originMatches, type Clock, type TenantRecord, type TokenClaims } from "@spanexx/gateway-core";
import { createAuthPolicy } from "@spanexx/adapter-core";
import { AUTH_ERROR_CODES } from "./types.js";

// CID:auth-002 - originMatches
// Purpose: shared RFC 6125 §6.4.3 single-label wildcard primitive. Canonical
//   implementation lives in `@platform/origin`; re-exported via
//   @platform/gateway-core here so adapter consumers can wire auth without a
//   direct gateway-core import. backend-runtime consumes the same primitive
//   directly from @platform/origin (no package cycle).
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
//
// A2 migration: the verification pipeline now lives in @spanexx/adapter-core
// (createAuthPolicy, early mode — verify once at open, identity cached in the
// door's ConnectionRecord). This file keeps the wire phrases (AUTH_ERROR_CODES
// are lowercase door bytes) and maps the canonical policy reasons to them.
const authPolicy = createAuthPolicy({ mode: "early" });

export function authenticateToken(token: string | undefined, context: AuthContext): AuthResult {
  const result = authPolicy.authenticate(token, {
    clock: context.clock,
    tokenSecret: context.tokenSecret,
    origin: context.origin,
    listTenants: context.listTenants,
  });
  if (result.ok) return { ok: true, claims: result.claims };
  return { ok: false, code: AUTH_ERROR_CODES[result.reason] };
}
