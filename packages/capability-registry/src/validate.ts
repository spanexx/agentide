/*
 * Code Map: capability-registry input validation
 * Rejects malformed records before they reach the store.
 *
 * CID Index:
 * CID:validate-001 -> validateRecord
 *
 * Quick lookup: rg -n "CID:validate-" packages/capability-registry/src/validate.ts
 */
import { type CapabilityRecord, type CapabilityType } from "./types.js";

const VALID_TYPES: CapabilityType[] = ["business", "platform", "runtime"];

// CID:validate-001 - validateRecord
// Purpose: validates a single CapabilityRecord; returns error message string or null on success
// Uses: CapabilityRecord, CapabilityType
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
  return null;
}
