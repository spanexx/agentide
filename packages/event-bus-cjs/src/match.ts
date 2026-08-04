/*
 * Code Map: wildcard matching + pattern validation
 * - matches: exported wildcard matcher (pattern ↔ event name)
 * - validatePattern: validate subscription pattern grammar
 * - validateEventName: validate event name grammar
 *
 * CID Index:
 * CID:match-001 -> matches
 * CID:match-002 -> validatePattern
 * CID:match-003 -> validateEventName
 *
 * Quick lookup: rg -n "CID:match-" agentide/packages/event-bus/src/match.ts
 */

/**
 * Wildcard matching:
 *   - exact segment match if no wildcard
 *   - `*` as the final segment matches any remaining depth
 *   - bare `*` matches every event name
 */
// CID:match-001 - matches
// Purpose: public wildcard matcher — both the bus itself (via
//   dispatchToSnapshot) and external callers use it to test whether a
//   subscription pattern would match an event name.
// Uses: string segment splitting; no other helpers.
// Used by: dispatchToSnapshot (index.ts), matches.test.ts.
export function matches(pattern: string, name: string): boolean {
  const pSegs = pattern.split(".");
  const nSegs = name.split(".");

  // If last segment is `*`, treat as prefix wildcard
  if (pSegs.length > 0 && pSegs[pSegs.length - 1] === "*") {
    const prefix = pSegs.slice(0, -1);
    if (prefix.length > nSegs.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== nSegs[i]) return false;
    }
    return true;
  }

  // Exact match
  if (pSegs.length !== nSegs.length) return false;
  for (let i = 0; i < pSegs.length; i++) {
    if (pSegs[i] !== nSegs[i]) return false;
  }
  return true;
}

// CID:match-002 - validatePattern
// Purpose: validate subscription pattern grammar at subscribe time.
//   Rejects empty patterns, embedded `*` in non-final segments,
//   and empty segments (consecutive dots).
// Uses: string segment splitting; no other helpers.
// Used by: createEventBus subscribe path (index.ts).
export function validatePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("Invalid subscription pattern: must be non-empty string.");
  }
  const segments = pattern.split(".");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "*") {
      if (i !== segments.length - 1) {
        throw new Error(
          `"*" is only valid as the final segment of a pattern. Got "${pattern}".`,
        );
      }
      continue;
    }
    if (seg.includes("*")) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (* must be its own segment).`,
      );
    }
    if (seg.length === 0) {
      throw new Error(
        `Invalid wildcard grammar in pattern "${pattern}" (empty segment).`,
      );
    }
  }
}

// CID:match-003 - validateEventName
// Purpose: validate event name grammar at publish time. Rejects empty
//   names and names with empty segments (consecutive dots).
// Uses: string segment splitting; no other helpers.
// Used by: createEventBus publish and dispatchInternal paths (index.ts).
export function validateEventName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Invalid event name: must be non-empty string.");
  }
  if (name.includes("..")) {
    throw new Error(`Invalid event name "${name}" (empty segment).`);
  }
}
