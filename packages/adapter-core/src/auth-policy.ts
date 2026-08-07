/*
 * Code Map: adapter-core auth policy (A2)
 * - createAuthPolicy({mode}): shared token verification pipeline.
 *   mode: "early" verifies once at open (identity cached by the DOOR in its
 *   connection record — e.g. WS ConnectionRecord.token/claims). "lazy" is the
 *   knob for doors that defer verification to first invoke; v1 behavior is
 *   identical for both (deferred verification ships with a consumer that
 *   needs it).
 * - Returns canonical failure reasons (TOKEN_MISSING | TOKEN_EXPIRED |
 *   TOKEN_INVALID | ORIGIN_MISMATCH | TENANT_SUSPENDED); the door maps these
 *   to its own wire phrases (WS AUTH_ERROR_CODES are lowercase door bytes —
 *   A5 keeps door tables door-local).
 * - Auth-failure behavior is FROZEN (A2): same checks, same order, same
 *   verdicts as the pre-migration WS authenticateToken.
 *
 * CID Index:
 * CID:adapter-core-005 -> createAuthPolicy + AuthPolicy + AuthFailure
 */

import {
  ERROR_CODES,
  originMatches,
  verifyToken,
  type Clock,
  type TenantRecord,
  type TokenClaims,
} from "@spanexx/gateway-core";

export type AuthPolicyMode = "early" | "lazy";

// Canonical failure reasons — 1:1 with the frozen pre-migration verdicts.
export type AuthFailure =
  | "TOKEN_MISSING"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "ORIGIN_MISMATCH"
  | "TENANT_SUSPENDED";

export interface AuthPolicyContext {
  readonly clock: Clock;
  readonly tokenSecret: Uint8Array;
  readonly origin: string | undefined;
  readonly listTenants: () => readonly TenantRecord[];
}

export type AuthPolicyResult =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly reason: AuthFailure };

export interface AuthPolicy {
  readonly mode: AuthPolicyMode;
  authenticate(token: string | undefined, context: AuthPolicyContext): AuthPolicyResult;
}

export interface AuthPolicyOptions {
  readonly mode?: AuthPolicyMode;
}

// CID:adapter-core-005 - createAuthPolicy
// Purpose: the shared verification pipeline (A2). Order is frozen: missing →
//   verify (expired|invalid) → origin binding → tenant suspension. The door
//   translates `reason` to its wire vocabulary and owns connection-level
//   identity caching (early mode caches at open in the door's record).
export function createAuthPolicy(options: AuthPolicyOptions = {}): AuthPolicy {
  const mode: AuthPolicyMode = options.mode ?? "early";
  return {
    mode,
    authenticate(token, context): AuthPolicyResult {
      if (token === undefined || token.length === 0) {
        return { ok: false, reason: "TOKEN_MISSING" };
      }
      const verified = verifyToken(token, context.clock, context.tokenSecret);
      if (!verified.ok) {
        return {
          ok: false,
          reason: verified.code === ERROR_CODES.TOKEN_EXPIRED ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
        };
      }
      const expectedOrigins = verified.claims.expectedOrigins ?? [];
      if (!originMatches(context.origin, expectedOrigins)) {
        return { ok: false, reason: "ORIGIN_MISMATCH" };
      }
      const tenant = context.listTenants().find((record) => record.id === verified.claims.sub.tenantId);
      if (tenant?.suspended === true) {
        return { ok: false, reason: "TENANT_SUSPENDED" };
      }
      return { ok: true, claims: verified.claims };
    },
  };
}
