/*
 * Code Map: capability-registry public API
 * createCapabilityRegistry is the single entry point.
 *
 * CID Index:
 * CID:index-001 -> createCapabilityRegistry
 *
 * Quick lookup: rg -n "CID:index-" packages/capability-registry/src/index.ts
 */
import { type EventBus } from "@spanexx/event-bus";
import {
  type CapabilityCard,
  type CapabilityRegistry,
  type CapabilityRecord,
  type DescribeResult,
  type RegisterResult,
  type UpdatedRecord,
} from "./types.js";
import { Store } from "./store.js";
import { validateRecord } from "./validate.js";

export * from "./types.js";
export { deriveTier } from "./validate.js";

function makeKey(name: string, version: string): string {
  return `${name}\x1F${version}`;
}

// CID:index-001 - createCapabilityRegistry
// Purpose: single entry point — creates a CapabilityRegistry wired to an EventBus
// Uses: EventBus, Store, validateRecord, CapabilityRecord, RegisterResult, UpdatedRecord
// Used by: @platform users who need capability registration and discovery
export function createCapabilityRegistry(eventBus: EventBus): CapabilityRegistry {
  const store = new Store();

  return {
    async register(
      owner: string,
      manifest: { owner: string; capabilities: readonly CapabilityRecord[] },
    ): Promise<RegisterResult> {
      if (owner !== manifest.owner) {
        throw new Error("owner mismatch: function parameter does not match manifest.owner");
      }

      for (let i = 0; i < manifest.capabilities.length; i++) {
        const err = validateRecord(manifest.capabilities[i], i);
        if (err) throw new Error(err);
      }

      const global = store.allKeys();
      for (const c of manifest.capabilities) {
        const key = makeKey(c.name, c.version);
        const existing = global.get(key);
        if (existing && existing.owner !== owner) {
          throw new Error(
            `Clash on ${c.name}@${c.version}: already owned by ${existing.owner}`,
          );
        }
      }

      const oldMap = new Map(store.getOwnerRecords(owner));
      const newMap = new Map<string, CapabilityRecord>();
      const added: CapabilityRecord[] = [];
      const updated: UpdatedRecord[] = [];
      const removed: CapabilityRecord[] = [];

      for (const c of manifest.capabilities) {
        const key = makeKey(c.name, c.version);
        const record = { ...c, owner };
        newMap.set(key, record);
        const old = oldMap.get(key);
        if (!old) {
          added.push(record);
          await eventBus.publish("capability.registered", { capability: record });
        } else if (JSON.stringify(old) !== JSON.stringify(record)) {
          const u: UpdatedRecord = { previous: old, current: record };
          updated.push(u);
          await eventBus.publish("capability.updated", u);
        }
        oldMap.delete(key);
      }

      for (const [, record] of oldMap) {
        removed.push(record);
        await eventBus.publish("capability.removed", { capability: record });
      }

      store.setOwnerRecords(owner, newMap);

      return { added, updated, removed };
    },

    list(): readonly CapabilityCard[] {
      return store.allCards();
    },

    search(query: string): readonly CapabilityCard[] {
      return store.search(query);
    },

    describe(name: string, version?: string): DescribeResult {
      return store.describe(name, version);
    },

    async removeByOwner(owner: string): Promise<readonly CapabilityRecord[]> {
      const removed = store.removeByOwner(owner);
      for (const record of removed) {
        await eventBus.publish("capability.removed", { capability: record });
      }
      return removed;
    },
  };
}
