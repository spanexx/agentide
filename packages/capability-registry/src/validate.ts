/*
 * Code Map: capability-registry input validation
 * Rejects malformed records before they reach the store.
 *
 * CID Index:
 * CID:validate-001 -> validateRecord
 *
 * Quick lookup: rg -n "CID:validate-" packages/capability-registry/src/validate.ts
 */
import { type CapabilityRecord, type CapabilityType, RUNTIME_TIERS, PLATFORM_TIERS, ALL_TIERS, type CapabilityTier } from "./types.js";

const VALID_TYPES: CapabilityType[] = ["business", "platform", "runtime"];

// CID:validate-001 - validateRecord
// Purpose: validates a single CapabilityRecord; returns error message string or null on success
// Tier rules (BI[7] permission-tiering):
//   - runtime: tier REQUIRED, one of read|act|destructive (no "write" for runtime)
//   - platform: tier OPTIONAL; derived from permissions[0] last segment if missing
//   - business: tier MUST be null/undefined
// Uses: CapabilityRecord, CapabilityType, RUNTIME_TIERS, PLATFORM_TIERS, ALL_TIERS
// Used by: index.ts register()
export function validateRecord(
  record: CapabilityRecord,
  index: number,
): string | null {
  if (!record.name || typeof record.name !== "string") {
    return `capability[${index}]: name is required`;
  }
  if (!record.name.includes(".")) {
    return `capability[${index}]: name "${record.name}" must contain a dot (domain.action)`;
  }
  if (!record.version || typeof record.version !== "string") {
    return `capability[${index}]: version is required`;
  }
  if (!VALID_TYPES.includes(record.type as CapabilityType)) {
    return `capability[${index}]: invalid type "${record.type}"; must be business, platform, or runtime`;
  }
  if (!record.description || typeof record.description !== "string") {
    return `capability[${index}]: description is required`;
  }
  if (
    !Array.isArray(record.permissions) ||
    !record.permissions.every((p) => typeof p === "string")
  ) {
    return `capability[${index}]: permissions must be an array of strings`;
  }
  if (
    record.inputSchema !== undefined &&
    (typeof record.inputSchema !== "object" || record.inputSchema === null)
  ) {
    return `capability[${index}]: inputSchema must be an object if present`;
  }
  if (
    record.outputSchema !== undefined &&
    (typeof record.outputSchema !== "object" || record.outputSchema === null)
  ) {
    return `capability[${index}]: outputSchema must be an object if present`;
  }

  // Tier validation (BI[7] permission-tiering)
  if (record.type === "business") {
    if (record.tier !== undefined && record.tier !== null) {
      return `capability[${index}]: business caps must have tier=null (got "${record.tier}")`;
    }
  } else if (record.type === "runtime") {
    if (record.tier === undefined || record.tier === null) {
      return `capability[${index}]: runtime cap "${record.name}" requires a tier (one of read|act|destructive)`;
    }
    if (!RUNTIME_TIERS.includes(record.tier)) {
      return `capability[${index}]: runtime cap "${record.name}" has invalid tier "${record.tier}" (must be read|act|destructive)`;
    }
  } else if (record.type === "platform") {
    if (record.tier !== undefined && record.tier !== null) {
      if (!PLATFORM_TIERS.includes(record.tier)) {
        return `capability[${index}]: platform cap "${record.name}" has invalid tier "${record.tier}" (must be read|write)`;
      }
    }
  }

  return null;
}

// CID:validate-002 - deriveTier
// Purpose: compute a capability's tier when not explicitly set.
// Rules (BI[7] permission-tiering):
//   - business: null (no tier)
//   - runtime: must be explicit; null means "caller forgot" — caller throws TIER_REQUIRED
//   - platform: derive from permissions[0]'s last segment if it's a known tier, else null
// Uses: CapabilityRecord, ALL_TIERS
// Used by: store.ts and tests; the index.ts register() path passes derived values through store.setOwnerRecords
export function deriveTier(record: CapabilityRecord): CapabilityTier | null {
  if (record.type === "business") return null;
  if (record.type === "runtime") return record.tier ?? null;
  // platform
  if (record.tier !== undefined && record.tier !== null) return record.tier;
  if (record.permissions.length === 0) return null;
  const lastSegment = record.permissions[0]!.split(".").pop() ?? "";
  return (ALL_TIERS as readonly string[]).includes(lastSegment)
    ? (lastSegment as CapabilityTier)
    : null;
}
