/*
 * Code Map: HS256 JWT verify (mirror of @platform/gateway-core/src/auth.ts)
 * - verifyToken: parses a JWT, verifies HS256 signature with timing-safe compare,
 *   checks exp against injected clock; returns discriminated union
 *
 * Local copy to keep backend-runtime's runtime independent of gateway-core's
 * runtime (gateway-core will start depending on backend-runtime in Phase 5).
 * Logic MUST stay in sync with packages/gateway-core/src/auth.ts verifyToken.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Clock } from "./types.js";

export type VerifyResult =
  | { readonly ok: true; readonly claims: { readonly sub: { readonly tenantId: string; readonly callerId: string } } }
  | { readonly ok: false; readonly code: "TOKEN_INVALID" | "TOKEN_EXPIRED" };

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function verifyToken(token: string, clock: Clock, secret: Uint8Array): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  const [header, payload, signature] = parts;

  let headerObj: { alg?: string; typ?: string };
  try {
    headerObj = JSON.parse(base64urlDecode(header).toString("utf-8"));
  } catch {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  if (headerObj.alg !== "HS256") {
    return { ok: false, code: "TOKEN_INVALID" };
  }

  const expectedSignature = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  let actualSignature: Buffer;
  try {
    actualSignature = base64urlDecode(signature);
  } catch {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  if (expectedSignature.length !== actualSignature.length) {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    return { ok: false, code: "TOKEN_INVALID" };
  }

  let claims: { sub?: { tenantId?: string; callerId?: string }; exp?: number };
  try {
    claims = JSON.parse(base64urlDecode(payload).toString("utf-8"));
  } catch {
    return { ok: false, code: "TOKEN_INVALID" };
  }
  if (typeof claims.exp !== "number" || claims.exp <= clock.now()) {
    return { ok: false, code: "TOKEN_EXPIRED" };
  }
  if (!claims.sub || typeof claims.sub.tenantId !== "string" || typeof claims.sub.callerId !== "string") {
    return { ok: false, code: "TOKEN_INVALID" };
  }

  return { ok: true, claims: { sub: { tenantId: claims.sub.tenantId, callerId: claims.sub.callerId } } };
}