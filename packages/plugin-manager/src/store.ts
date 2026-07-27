/*
 * Code Map: Plugin install-record persistence
 * - InstallStore: in-memory map of install records + atomic JSON file persistence
 *   - load: parse the install-record file; tolerate missing file, reject malformed JSON, skip malformed records
 *   - save: serialize the in-memory map to JSON and write atomically (write-temp-then-rename inside fs.writeFile)
 *   - get / has / list: read-only accessors
 *   - set: insert or replace; does NOT save to disk (caller decides when)
 *   - delete: remove a record; returns whether anything was removed
 *
 * CID Index:
 * CID:store-001 -> InstallStore
 * CID:store-002 -> InstallStore.load
 * CID:store-003 -> InstallStore.save
 * CID:store-004 -> InstallStore.get
 * CID:store-005 -> InstallStore.set
 * CID:store-006 -> InstallStore.delete
 * CID:store-007 -> InstallStore.list
 * CID:store-008 -> InstallStore.has
 *
 * Quick lookup: rg -n "CID:store-" packages/plugin-manager/src/store.ts
 */

import { ERROR_CODES, PluginManagerError } from "./errors.js";
import type { FileSystem, InstallRecord, PluginType, YamlValue } from "./types.js";

function isInstallRecordShape(value: YamlValue): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, YamlValue>;
  return (
    typeof r.id === "string" &&
    (r.type === "runtime" || r.type === "service" || r.type === "developer") &&
    typeof r.version === "string" &&
    typeof r.source === "string" &&
    typeof r.installedAt === "number" &&
    typeof r.enabled === "boolean"
  );
}

// CID:store-001 - InstallStore
// Purpose: in-memory map of install records + atomic JSON file persistence
// Uses: FileSystem (injected), PluginManagerError
// Used by: createPluginManager factory
export class InstallStore {
  private readonly records = new Map<string, InstallRecord>();

  constructor(
    private readonly installRecordPath: string,
    private readonly fs: FileSystem,
  ) {}

  // CID:store-002 - load
  // Purpose: read the install-record file from disk; tolerate missing file, reject malformed JSON, skip malformed records
  // Side effects: populates the in-memory map; logs warnings on skipped records
  async load(): Promise<void> {
    if (!(await this.fs.exists(this.installRecordPath))) return;
    let raw: string;
    try {
      raw = await this.fs.readFile(this.installRecordPath);
    } catch {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        `failed to read install-record file at ${this.installRecordPath}`,
        { path: this.installRecordPath },
      );
    }
    let parsed: YamlValue;
    try {
      parsed = JSON.parse(raw) as YamlValue;
    } catch (err) {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        err instanceof Error ? err.message : "install-record file is not valid JSON",
        { path: this.installRecordPath },
      );
    }
    if (!Array.isArray(parsed)) {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        "install-record file must contain a JSON array",
        { path: this.installRecordPath },
      );
    }
    this.records.clear();
    for (const item of parsed) {
      if (!isInstallRecordShape(item)) {
        console.warn(
          `[plugin-manager] skipping malformed install record:`,
          item,
        );
        continue;
      }
      this.records.set((item as InstallRecord).id, item as InstallRecord);
    }
  }

  // CID:store-003 - save
  // Purpose: serialize the in-memory map to JSON and persist atomically (write-temp-then-rename inside fs.writeFile)
  async save(): Promise<void> {
    const payload = JSON.stringify([...this.records.values()], null, 2);
    await this.fs.writeFile(this.installRecordPath, payload);
  }

  // CID:store-004 - get
  get(id: string): InstallRecord | null {
    return this.records.get(id) ?? null;
  }

  // CID:store-005 - set
  // Purpose: insert or replace; does NOT save to disk (caller decides when)
  set(record: InstallRecord): InstallRecord {
    this.records.set(record.id, record);
    return record;
  }

  // CID:store-006 - delete
  // Purpose: remove a record; returns whether anything was removed
  delete(id: string): boolean {
    return this.records.delete(id);
  }

  // CID:store-007 - list
  list(): readonly InstallRecord[] {
    return [...this.records.values()];
  }

  // CID:store-008 - has
  has(id: string): boolean {
    return this.records.has(id);
  }
}

export type { PluginType };