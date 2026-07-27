/*
 * Code Map: tenant record persistence
 * - TenantStore: in-memory Map of (id → TenantRecord) + atomic JSON file persistence
 *
 * CID Index:
 * CID:tenant-store-001 -> TenantStore
 *
 * Quick lookup: rg -n "CID:tenant-store-" packages/gateway-core/src/tenant-store.ts
 */

import { ERROR_CODES, GatewayError } from "./errors.js";
import type { FileSystem, TenantRecord, YamlValue } from "./types.js";

// CID:tenant-store-001 - TenantStore
// Purpose: in-memory tenant records + atomic JSON persistence; insertion-ordered; validates on load
// Used by: createGateway() factory (loads on boot) + tenant lifecycle methods (create/suspend/delete)
// Used in tests by: 11 cases above covering load/save/round-trip, malformed JSON, insertion order
export class TenantStore {
  private readonly records = new Map<string, TenantRecord>();

  constructor(
    private readonly tenantsPath: string,
    private readonly fs: FileSystem,
  ) {}

  async load(): Promise<void> {
    if (!(await this.fs.exists(this.tenantsPath))) return;
    let raw: string;
    try {
      raw = await this.fs.readFile(this.tenantsPath);
    } catch {
      throw new GatewayError(
        ERROR_CODES.INVALID_REQUEST,
        `failed to read tenants file at ${this.tenantsPath}`,
        { path: this.tenantsPath },
      );
    }
    let parsed: YamlValue;
    try {
      parsed = JSON.parse(raw) as YamlValue;
    } catch (err) {
      throw new GatewayError(
        ERROR_CODES.INVALID_REQUEST,
        err instanceof Error ? err.message : "tenants file is not valid JSON",
        { path: this.tenantsPath },
      );
    }
    if (!Array.isArray(parsed)) {
      throw new GatewayError(
        ERROR_CODES.INVALID_REQUEST,
        "tenants file must contain a JSON array",
        { path: this.tenantsPath },
      );
    }
    this.records.clear();
    for (const item of parsed as readonly TenantRecord[]) {
      const t = item;
      if (
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        typeof t.createdAt === "number" &&
        typeof t.suspended === "boolean"
      ) {
        this.records.set(t.id, t);
      } else {
        console.warn(`[gateway-core] skipping malformed tenant record:`, t);
      }
    }
  }

  async save(): Promise<void> {
    const payload = JSON.stringify([...this.records.values()], null, 2);
    await this.fs.writeFile(this.tenantsPath, payload);
  }

  get(id: string): TenantRecord | null {
    return this.records.get(id) ?? null;
  }

  /**
   * Insert or replace. Does NOT save to disk; caller decides when to save.
   * Replacing an existing id preserves its insertion-order position (see test).
   */
  set(record: TenantRecord): TenantRecord {
    this.records.set(record.id, record);
    return record;
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  list(): readonly TenantRecord[] {
    return [...this.records.values()];
  }
}