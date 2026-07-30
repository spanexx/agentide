/*
 * Code Map: JWT test helpers (HS256)
 * - mintToken: build a JWT string for a (tenantId, callerId, scope) — mirrors
 *   packages/gateway-core/src/auth.ts issueToken signature. Local copy
 *   keeps backend-runtime's tests independent of @platform/gateway-core's
 *   runtime (gateway-core will depend on backend-runtime starting Phase 5;
 *   creating the inverse dev-dep would be circular).
 * - secretFrom: derive a 32-byte Uint8Array from a string seed for deterministic tests
 */

import { createHmac } from "node:crypto";
import type { Clock } from "../types.js";

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function secretFrom(seed: string): Uint8Array {
  // Deterministic 32-byte secret derived from a string seed.
  // Tests use the same seed on both sides (sign + verify) so signatures match.
  const hmac = createHmac("sha256", seed).update("backend-runtime-test-secret").digest();
  return new Uint8Array(hmac.subarray(0, 32));
}

export function mintToken(
  claims: { tenantId: string; callerId: string; scope?: string[]; iat?: number; exp?: number },
  secret: Uint8Array,
  clock: Clock,
): string {
  const iat = claims.iat ?? clock.now();
  const exp = claims.exp ?? clock.now() + 3600_000; // 1h default
  const payload = {
    sub: { tenantId: claims.tenantId, callerId: claims.callerId },
    scope: claims.scope ?? [],
    iat,
    exp,
  };
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payloadEnc = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${payloadEnc}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}