/**
 * CID:origin-001 - originMatches
 *
 * RFC 6125 §6.4.3 single-label wildcard match for `expectedOrigins` JWT claims.
 * Both doors (backend-runtime + adapter-websocket) import the same primitive
 * per the W2 sub-Q 4 REVISED note — typo-squatting property preserved:
 *   - `https://*.acme.com` matches `https://app.acme.com`
 *   - NEVER matches `https://acme.com` (zero-label)
 *   - NEVER matches `https://a.b.acme.com` (multi-label)
 *   - NEVER matches `https://acme.com.evil.com` (literal suffix)
 * `origin === undefined` (Node client without Origin header) bypasses the check.
 *
 * Lives in @platform/origin (not gateway-core) so backend-runtime can consume
 * it without a package cycle (gateway-core depends on backend-runtime).
 * gateway-core re-exports it to keep its public surface stable; adapter-websocket
 * imports it via @platform/gateway-core's re-export.
 */
export function originMatches(origin: string | undefined, expectedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true;
  return expectedOrigins.some((expected) => {
    if (origin === expected) return true;
    const marker = expected.indexOf("*.");
    if (marker < 0 || expected.indexOf("*", marker + 1) >= 0) return false;
    const prefix = expected.slice(0, marker);
    const suffix = expected.slice(marker + 1);
    const markerAtLabelStart = prefix.endsWith("://") || prefix.endsWith(".");
    if (!markerAtLabelStart || !origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
    const label = origin.slice(prefix.length, origin.length - suffix.length);
    return label.length > 0 && !label.includes(".");
  });
}
