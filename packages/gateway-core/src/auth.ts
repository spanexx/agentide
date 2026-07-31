/*
 * Code Map: HS256 JWT sign + verify for gateway-core
 * - issueToken: builds a JWT string from TokenClaims; HS256 only
 * - verifyToken: parses + verifies signature + checks exp; returns discriminated union
 *
 * CID Index:
 * CID:auth-001 -> issueToken
 * CID:auth-002 -> verifyToken
 *
 * Quick lookup: rg -n "CID:auth-" packages/gateway-core/src/auth.ts
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Clock, TokenClaims } from "./types.js";
import { GatewayError } from "./errors.js";
import { ERROR_CODES } from "./errors.js";

export type VerifyResult =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly code: string };

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64url");
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

// CID:auth-001 - issueToken
// Purpose: build a 3-part HS256 JWT string from TokenClaims; deterministic header, signed payload, deterministic signature
// Used by: Gateway.issueToken() and the agentide CLI (agentide token issue)
// Used in tests by: round-trip with verifyToken
export function issueToken(claims: TokenClaims, secret: Uint8Array, _clock: Clock): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

// CID:auth-002 - verifyToken
// Purpose: parse JWT, verify HS256 signature with timing-safe compare, check exp against injected clock; reject expired/invalid/tampered
// Used by: handleInvocation pipeline (every request begins with token verify)
// Used in tests by: 8 cases above covering round-trip, tamper, expiry, malformed, algorithm confusion
export interface VerifyOptions {
  readonly leewayMs?: number;
}

export function verifyToken(token: string, clock: Clock, secret: Uint8Array, options: VerifyOptions = {}): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }
  const [header, payload, signature] = parts;

  // Algorithm confusion guard: only HS256 accepted.
  let headerObj: { alg?: string; typ?: string };
  try {
    headerObj = JSON.parse(base64urlDecode(header).toString("utf-8"));
  } catch {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }
  if (headerObj.alg !== "HS256") {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }

  // Timing-safe signature verification.
  const expectedSignature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  let actualSignature: Buffer;
  try {
    actualSignature = base64urlDecode(signature);
  } catch {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }
  if (expectedSignature.length !== actualSignature.length) {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }
  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }

  // Payload parse + expiry check.
  let claims: TokenClaims;
  try {
    claims = JSON.parse(base64urlDecode(payload).toString("utf-8")) as TokenClaims;
  } catch {
    return { ok: false, code: ERROR_CODES.TOKEN_INVALID };
  }
  if (typeof claims.exp !== "number" || claims.exp + (options.leewayMs ?? 0) <= clock.now()) {
    return { ok: false, code: ERROR_CODES.TOKEN_EXPIRED };
  }

  return { ok: true, claims };
}

/**
 * Generate a 32-byte secret for HS256 signing. Used by Gateway factory on first
 * run to bootstrap the gateway-secret file. Production callers should
 * persist this to disk with mode 0600.
 */
export function generateSecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

// Suppress unused-import warning for GatewayError; it's re-exported via index.
void GatewayError;