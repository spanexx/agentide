/*
 * Code Map: adapter-core readClaims
 * - readClaims(token): decode the (unsigned, kernel-verified) JWT payload and
 *   return the caller's claims. Ported from adapter-mcp decodeScopeFromToken
 *   (CID:translate-003) so doors share one claim reader (A2/A6).
 * - Signature verification stays in the kernel; this only reads the payload.
 * - Any malformed input returns an empty Claims object defensively.
 *
 * CID Index:
 * CID:adapter-core-002 -> readClaims + Claims
 */

/** Permissive payload shape — JWT claims are open-ended (RFC 7519). */
export type ClaimsPayload = Readonly<Record<string, never>>;

export interface Claims {
  /** Caller's scope claim — readonly string list; [] when absent/malformed. */
  readonly scope: readonly string[];
  /** Raw decoded payload (if it parsed as an object). */
  readonly payload: ClaimsPayload;
}

/** Intermediate parse slot — narrowed to ClaimsPayload/object/null after checks. */
type ParsedJson = ClaimsPayload | readonly unknown[] | string | number | boolean | null;

/**
 * Decode a JWT payload segment and return the caller's claims.
 * Defensive by contract: malformed tokens yield empty claims, never throw.
 */
export function readClaims(token: string): Claims {
  const parts = token.split(".");
  if (parts.length < 2) return { scope: [], payload: {} };
  let payloadText: string;
  try {
    payloadText = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
  } catch {
    return { scope: [], payload: {} };
  }
  let parsedRaw: ParsedJson;
  try {
    parsedRaw = JSON.parse(payloadText) as ParsedJson;
  } catch {
    return { scope: [], payload: {} };
  }
  if (!isClaimsPayload(parsedRaw)) {
    return { scope: [], payload: {} };
  }
  const record: ClaimsPayload = parsedRaw;
  const rawScope = (record as Record<string, ParsedJson>)["scope"];
  const scope = Array.isArray(rawScope)
    ? rawScope.filter((s): s is string => typeof s === "string")
    : [];
  return { scope, payload: record };
}

function isClaimsPayload(value: ParsedJson): value is ClaimsPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
