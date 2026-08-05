import { describe, it, expect } from "vitest";
import { FileSystemClientStore } from "../client-store.js";

describe("FileSystemClientStore", () => {
  it("returns empty lists when the files don't exist", async () => {
    const fs = { readFile: async () => { throw new Error("ENOENT"); }, writeFile: async () => {}, exists: async () => false };
    const store = new FileSystemClientStore("/data", fs);
    expect(await store.load()).toEqual([]);
    expect(await store.loadCodes()).toEqual([]);
  });
  it("persists and reloads records", async () => {
    const stored: Record<string, string> = {};
    const fs = {
      readFile: async (p: string) => stored[p] ?? (() => { throw new Error("ENOENT"); })(),
      writeFile: async (p: string, data: string) => { stored[p] = data; },
      exists: async (p: string) => p in stored,
    };
    const store = new FileSystemClientStore("/data", fs);
    const rec = { id: "cli_1", tenantId: "acme", name: "a", hashedSecret: "sha256:x", defaultScope: ["*"] as readonly string[], revoked: false, createdAt: 1, lastUsedAt: null, lastRotatedAt: null, gracePeriodEndsAt: null };
    await store.save([rec]);
    expect(await store.load()).toEqual([rec]);
  });
  it("persists and reloads registration codes", async () => {
    const stored: Record<string, string> = {};
    const fs = {
      readFile: async (p: string) => stored[p] ?? (() => { throw new Error("ENOENT"); })(),
      writeFile: async (p: string, data: string) => { stored[p] = data; },
      exists: async (p: string) => p in stored,
    };
    const store = new FileSystemClientStore("/data", fs);
    const c = { code: "rc_1", tenantId: "acme", defaultScope: ["*"] as readonly string[], expiresAt: 1, consumed: false };
    await store.saveCodes([c]);
    expect(await store.loadCodes()).toEqual([c]);
  });
  it("uses /clients.json and /registration-codes.json paths", async () => {
    const writes: string[] = [];
    const fs = {
      readFile: async () => { throw new Error("ENOENT"); },
      writeFile: async (p: string, data: string) => { writes.push(`${p}::${data}`); },
      exists: async () => false,
    };
    const store = new FileSystemClientStore("/data", fs);
    await store.save([]);
    await store.saveCodes([]);
    expect(writes[0]?.startsWith("/data/clients.json")).toBe(true);
    expect(writes[1]?.startsWith("/data/registration-codes.json")).toBe(true);
  });
});
