/*
 * Code Map: capability-registry public types
 * - CapabilityType: union of valid capability kinds
 * - CapabilityRecord: full discovery record for one capability
 * - CapabilityCard: compact card for list/search results
 * - DescribeResult: return type for describe()
 * - UpdatedRecord: previous+current pair for updated capabilities
 * - RegisterResult: return type for register()
 * - CapabilityRegisteredPayload: event payload for capability.registered
 * - CapabilityUpdatedPayload: event payload for capability.updated
 * - CapabilityRemovedPayload: event payload for capability.removed
 * - CapabilityRegistry: public interface with register, list, search, describe
 *
 * CID Index:
 * CID:types-001 -> CapabilityType
 * CID:types-002 -> CapabilityRecord
 * CID:types-003 -> CapabilityCard
 * CID:types-004 -> DescribeResult
 * CID:types-005 -> UpdatedRecord
 * CID:types-006 -> RegisterResult
 * CID:types-007 -> CapabilityRegisteredPayload
 * CID:types-008 -> CapabilityUpdatedPayload
 * CID:types-009 -> CapabilityRemovedPayload
 * CID:types-010 -> CapabilityRegistry
 *
 * Quick lookup: rg -n "CID:types-" packages/capability-registry/src/types.ts
 */

// CID:types-001 - CapabilityType
export type CapabilityType = "business" | "platform" | "runtime";

// CID:types-001a - CapabilityTier
// Purpose: risk tier for a capability — drives scope semantics and catalog filtering
// Values: "read" (observe), "act" (mutate, reversible), "destructive" (irreversible), "write" (legacy platform tier)
export type CapabilityTier = "read" | "act" | "destructive" | "write";

export const RUNTIME_TIERS: readonly CapabilityTier[] = ["read", "act", "destructive"];
export const PLATFORM_TIERS: readonly CapabilityTier[] = ["read", "write"];
export const ALL_TIERS: readonly CapabilityTier[] = ["read", "act", "destructive", "write"];

// CID:types-002 - CapabilityRecord
// Purpose: full discovery record for one capability in the catalog
export interface CapabilityRecord {
  readonly name: string;
  readonly version: string;
  readonly type: CapabilityType;
  readonly description: string;
  readonly inputSchema?: Readonly<object>;
  readonly outputSchema?: Readonly<object>;
  readonly permissions: readonly string[];
  readonly owner: string;
  readonly tier?: CapabilityTier | null;
}

// CID:types-003 - CapabilityCard
// Purpose: compact card returned by list() and search results
export interface CapabilityCard {
  readonly name: string;
  readonly version: string;
  readonly type: CapabilityType;
  readonly description: string;
  readonly tier: CapabilityTier | null;
}

// CID:types-004 - DescribeResult
// Purpose: return type for describe() with capability + version resolution info
export interface DescribeResult {
  readonly capability: CapabilityRecord | null;
  readonly selectedVersion: string | null;
  readonly note?: string;
}

// CID:types-005 - UpdatedRecord
// Purpose: carries both previous and current record for an updated capability
export interface UpdatedRecord {
  readonly previous: CapabilityRecord;
  readonly current: CapabilityRecord;
}

// CID:types-006 - RegisterResult
// Purpose: diff returned by register() — what was added, updated (with both old+new), and removed
export interface RegisterResult {
  readonly added: readonly CapabilityRecord[];
  readonly updated: readonly UpdatedRecord[];
  readonly removed: readonly CapabilityRecord[];
}

// CID:types-007 - CapabilityRegisteredPayload
// Purpose: event payload for capability.registered
export interface CapabilityRegisteredPayload {
  readonly capability: CapabilityRecord;
}

// CID:types-008 - CapabilityUpdatedPayload
// Purpose: event payload for capability.updated — carries previous + current state
export interface CapabilityUpdatedPayload {
  readonly previous: CapabilityRecord;
  readonly current: CapabilityRecord;
}

// CID:types-009 - CapabilityRemovedPayload
// Purpose: event payload for capability.removed
export interface CapabilityRemovedPayload {
  readonly capability: CapabilityRecord;
}

// CID:types-010 - CapabilityRegistry
// Purpose: public contract every caller relies on — exactly 4 methods
export interface CapabilityRegistry {
  register(
    owner: string,
    manifest: { owner: string; capabilities: readonly CapabilityRecord[] },
  ): Promise<RegisterResult>;
  removeByOwner(owner: string): Promise<readonly CapabilityRecord[]>;
  list(): readonly CapabilityCard[];
  search(query: string): readonly CapabilityCard[];
  describe(name: string, version?: string): DescribeResult;
}
