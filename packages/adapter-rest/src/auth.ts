/*
 * Code Map: REST bearer-token extractor (Phase 3)
 * - extractBearer: parses the `Authorization` header. Case-insensitive
 *   `^Bearer\s+(.+)$` — mirrors packages/adapter-mcp/src/server.ts:44-48
 *   (the precedent the IMPL Phase 3 references).
 * - Returns null when the header is missing or doesn't match — the door
 *   renders a 401 TOKEN_INVALID body in that case (PRD Scenario 3).
 *
 * CID Index:
 * CID:adapter-rest-auth-001 -> extractBearer
 */

const BEARER_REGEX = /^Bearer\s+(.+)$/i;

// CID:adapter-rest-auth-001 - extractBearer
// Purpose: pull the JWT out of the Authorization header verbatim — the kernel
//   verifies it per call (A8 lazy auth).
// Used by: invoke.ts (Phase 3 POST /invoke handler).
export function extractBearer(authHeader: string | null | undefined): string | null {
  if (authHeader === null || authHeader === undefined) return null;
  const m = BEARER_REGEX.exec(authHeader);
  return m?.[1] ?? null;
}