import { describe, expect, it } from "vitest";
import { TenantStore } from "../tenant-store.js";
import { GatewayError, ERROR_CODES } from "../index.js";
import type { FileSystem } from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  pendingWrites = 0;
  maxConcurrentWrites = 0;
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.pendingWrites += 1;
    this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.pendingWrites);
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.files.set(path, content);
    this.pendingWrites -= 1;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

describe("TenantStore", () => {
  it("starts empty when file does not exist", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    expect(store.list()).toEqual([]);
  });

  it("loads tenants from a valid file", async () => {
    const fs = new InMemoryFs();
    fs.files.set("/data/tenants.json", JSON.stringify([
      { id: "acme", name: "Acme", createdAt: 1, suspended: false },
      { id: "beta", name: "Beta Inc", createdAt: 2, suspended: true },
    ]));
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    expect(store.list()).toHaveLength(2);
    expect(store.get("acme")?.name).toBe("Acme");
    expect(store.get("beta")?.suspended).toBe(true);
  });

  it("throws GATEWAY_INVALID_REQUEST on malformed JSON", async () => {
    const fs = new InMemoryFs();
    fs.files.set("/data/tenants.json", "not-json{");
    const store = new TenantStore("/data/tenants.json", fs);
    await expect(store.load()).rejects.toThrow(GatewayError);
    try {
      await store.load();
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).code).toBe(ERROR_CODES.INVALID_REQUEST);
    }
  });

  it("throws GATEWAY_INVALID_REQUEST on JSON that is not an array", async () => {
    const fs = new InMemoryFs();
    fs.files.set("/data/tenants.json", JSON.stringify({ not: "an array" }));
    const store = new TenantStore("/data/tenants.json", fs);
    await expect(store.load()).rejects.toMatchObject({ code: ERROR_CODES.INVALID_REQUEST });
  });

  it("set() inserts a new record; get() returns it", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "acme", name: "Acme", createdAt: 1000, suspended: false });
    expect(store.get("acme")?.name).toBe("Acme");
  });

  it("set() replaces an existing record with the same id", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "acme", name: "Acme", createdAt: 1000, suspended: false });
    store.set({ id: "acme", name: "Acme 2.0", createdAt: 1000, suspended: false });
    expect(store.list()).toHaveLength(1);
    expect(store.get("acme")?.name).toBe("Acme 2.0");
  });

  it("delete() removes a record; returns whether anything was removed", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "acme", name: "Acme", createdAt: 1, suspended: false });
    expect(store.delete("acme")).toBe(true);
    expect(store.get("acme")).toBeNull();
    expect(store.delete("acme")).toBe(false);
  });

  it("list() returns records in insertion order", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "a", name: "A", createdAt: 1, suspended: false });
    store.set({ id: "b", name: "B", createdAt: 2, suspended: false });
    store.set({ id: "c", name: "C", createdAt: 3, suspended: false });
    expect(store.list().map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("save() persists all records as a JSON array", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "acme", name: "Acme", createdAt: 1, suspended: false });
    store.set({ id: "beta", name: "Beta", createdAt: 2, suspended: false });
    await store.save();
    const written = JSON.parse(fs.files.get("/data/tenants.json") ?? "[]");
    expect(written).toHaveLength(2);
    expect(written.map((t: { id: string }) => t.id)).toEqual(["acme", "beta"]);
  });

  it("save() preserves insertion order via round-trip", async () => {
    const fs = new InMemoryFs();
    const store1 = new TenantStore("/data/tenants.json", fs);
    await store1.load();
    store1.set({ id: "first", name: "First", createdAt: 1, suspended: false });
    store1.set({ id: "second", name: "Second", createdAt: 2, suspended: false });
    await store1.save();
    const store2 = new TenantStore("/data/tenants.json", fs);
    await store2.load();
    expect(store2.list().map((t) => t.id)).toEqual(["first", "second"]);
  });

  it("set() replaces do not move the record to the end (insertion order is preserved)", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "a", name: "A", createdAt: 1, suspended: false });
    store.set({ id: "b", name: "B", createdAt: 2, suspended: false });
    store.set({ id: "a", name: "A2", createdAt: 1, suspended: false });
    expect(store.list().map((t) => t.id)).toEqual(["a", "b"]);
    expect(store.get("a")?.name).toBe("A2");
  });

  it("concurrent save() calls are serialized (no interleaved file writes)", async () => {
    const fs = new InMemoryFs();
    const store = new TenantStore("/data/tenants.json", fs);
    await store.load();
    store.set({ id: "a", name: "A", createdAt: 1, suspended: false });
    await Promise.all([store.save(), store.save(), store.save()]);
    expect(fs.maxConcurrentWrites).toBe(1);
  });
});