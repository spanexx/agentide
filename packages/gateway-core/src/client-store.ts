/*
 * Code Map: durable file-system store for clients + registration codes.
 * Lives at <dataDir>/clients.json + <dataDir>/registration-codes.json
 * (the same dataDir that already has tenants.json + gateway-secret).
 *
 * CID Index:
 * CID:cs-001 -> FileSystemClientStore
 *
 * Quick lookup: rg -n "CID:cs-" packages/gateway-core/src/client-store.ts
 */

import type { ClientRecord, RegistrationCode, ClientStore } from "./types.js";

export class FileSystemClientStore implements ClientStore {
  constructor(
    private readonly dataDir: string,
    private readonly fs: { readFile: (path: string) => Promise<string>; writeFile: (path: string, data: string, mode?: number) => Promise<void>; exists: (path: string) => Promise<boolean> },
  ) {}

  private get clientsFile(): string { return `${this.dataDir}/clients.json`; }
  private get codesFile(): string { return `${this.dataDir}/registration-codes.json`; }

  async load(): Promise<readonly ClientRecord[]> {
    try {
      const raw = await this.fs.readFile(this.clientsFile);
      const parsed = JSON.parse(raw) as { records: ClientRecord[] };
      return parsed.records ?? [];
    } catch {
      return [];
    }
  }

  async save(records: readonly ClientRecord[]): Promise<void> {
    await this.fs.writeFile(this.clientsFile, JSON.stringify({ records }, null, 2), 0o644);
  }

  async loadCodes(): Promise<readonly RegistrationCode[]> {
    try {
      const raw = await this.fs.readFile(this.codesFile);
      const parsed = JSON.parse(raw) as { codes: RegistrationCode[] };
      return parsed.codes ?? [];
    } catch {
      return [];
    }
  }

  async saveCodes(codes: readonly RegistrationCode[]): Promise<void> {
    await this.fs.writeFile(this.codesFile, JSON.stringify({ codes }, null, 2), 0o644);
  }
}
