/*
 * Code Map: capability-registry in-memory store
 * All data lives in a Map-of-Maps: owner -> (key -> record).
 *
 * CID Index:
 * CID:store-001 -> Store class
 * CID:store-002 -> Store.getOwnerRecords
 * CID:store-003 -> Store.setOwnerRecords
 * CID:store-004 -> Store.allKeys
 * CID:store-005 -> Store.allCards
 * CID:store-006 -> Store.search
 * CID:store-007 -> Store.describe
 *
 * Quick lookup: rg -n "CID:store-" packages/capability-registry/src/store.ts
 */
import { type CapabilityRecord, type CapabilityCard, type DescribeResult } from "./types.js";
import { deriveTier } from "./validate.js";

function makeKey(name: string, version: string): string {
  return `${name}\x1F${version}`;
}

// CID:store-001 - Store
// Purpose: in-memory owner-partitioned catalog of capability records
// Uses: CapabilityRecord, CapabilityCard, DescribeResult, deriveTier
// Used by: index.ts createCapabilityRegistry factory
export class Store {
  private owners = new Map<string, Map<string, CapabilityRecord>>();

  // CID:store-002 - getOwnerRecords
  getOwnerRecords(owner: string): Map<string, CapabilityRecord> {
    return this.owners.get(owner) ?? new Map();
  }

  // CID:store-003 - setOwnerRecords
  setOwnerRecords(
    owner: string,
    records: Map<string, CapabilityRecord>,
  ): void {
    this.owners.set(owner, records);
  }

  // CID:store-008 - removeByOwner
  // Purpose: drop every record owned by `owner` and return the dropped records
  //   in insertion order. Returns an empty array if `owner` had no entries —
  //   idempotent. Used by the Backend Runtime when an SDK disconnects.
  removeByOwner(owner: string): CapabilityRecord[] {
    const ownerMap = this.owners.get(owner);
    if (!ownerMap) return [];
    const records = [...ownerMap.values()];
    this.owners.delete(owner);
    return records;
  }

  // CID:store-004 - allKeys
  // Purpose: global key lookup for clash detection across owners
  allKeys(): Map<string, { record: CapabilityRecord; owner: string }> {
    const global = new Map<string, { record: CapabilityRecord; owner: string }>();
    for (const [, ownerMap] of this.owners) {
      for (const [key, record] of ownerMap) {
        global.set(key, { record, owner: record.owner });
      }
    }
    return global;
  }

  // CID:store-005 - allCards
  // Purpose: returns CapabilityCard[] for list()
  // BI[7]: each card includes the derived tier field
  allCards(): CapabilityCard[] {
    const cards: CapabilityCard[] = [];
    for (const [, ownerMap] of this.owners) {
      for (const [, record] of ownerMap) {
        cards.push({
          name: record.name,
          version: record.version,
          type: record.type,
          description: record.description,
          tier: deriveTier(record),
        });
      }
    }
    return cards;
  }

  // CID:store-006 - search
  // Purpose: returns matching CapabilityCard[] for search()
  // BI[7]: each card includes the derived tier field
  search(query: string): CapabilityCard[] {
    if (!query) return [];
    const lower = query.toLowerCase();
    const cards: CapabilityCard[] = [];
    for (const [, ownerMap] of this.owners) {
      for (const [, record] of ownerMap) {
        if (
          record.name.toLowerCase().includes(lower) ||
          record.description.toLowerCase().includes(lower)
        ) {
          cards.push({
            name: record.name,
            version: record.version,
            type: record.type,
            description: record.description,
            tier: deriveTier(record),
          });
        }
      }
    }
    return cards;
  }

  // CID:store-007 - describe
  // Purpose: returns DescribeResult for describe() — supports versioned + latest-mode lookup
  describe(name: string, version?: string): DescribeResult {
    if (version) {
      const key = makeKey(name, version);
      for (const [, ownerMap] of this.owners) {
        const record = ownerMap.get(key);
        if (record) {
          return { capability: { ...record }, selectedVersion: version };
        }
      }
      return { capability: null, selectedVersion: null };
    }
    const matches: CapabilityRecord[] = [];
    for (const [, ownerMap] of this.owners) {
      for (const [, record] of ownerMap) {
        if (record.name === name) {
          matches.push(record);
        }
      }
    }
    if (matches.length === 0) {
      return { capability: null, selectedVersion: null };
    }
    if (matches.length === 1) {
      const c = { ...matches[0] };
      return { capability: c, selectedVersion: c.version };
    }
    const sorted = [...matches].sort((a, b) => b.version.localeCompare(a.version));
    const c = { ...sorted[0] };
    return {
      capability: c,
      selectedVersion: c.version,
      note: `auto-selected version ${c.version} from ${matches.length} available`,
    };
  }
}
