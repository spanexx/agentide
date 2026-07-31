import { describe, expect, it } from "vitest";
import { InstallStore } from "../store.js";
import type { FileSystem, InstallRecord } from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  // Make writeFile fail by toggling this; the store's save() call will throw.
  failOnWrite = false;
  pendingWrites = 0;
  maxConcurrentWrites = 0;

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.failOnWrite) throw new Error("disk full");
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

function record(overrides: Partial<InstallRecord> = {}): InstallRecord {
  return {
    id: "browser",
    type: "runtime",
    version: "1.0",
    source: "./browser.yaml",
    installedAt: 1000,
    enabled: true,
    ...overrides,
  };
}

describe("InstallStore", () => {
  it("starts empty on a missing install-record file", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    expect(store.list()).toEqual([]);
    expect(store.has("browser")).toBe(false);
  });

  it("loads records from a valid file", async () => {
    const fs = new InMemoryFs();
    fs.files.set(
      "/data/installed.json",
      JSON.stringify([record(), record({ id: "git", source: "./git.yaml" })]),
    );
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    expect(store.list()).toHaveLength(2);
    expect(store.get("browser")?.version).toBe("1.0");
    expect(store.get("git")?.source).toBe("./git.yaml");
  });

  it("throws PLUGIN_MANIFEST_INVALID on malformed JSON", async () => {
    const fs = new InMemoryFs();
    fs.files.set("/data/installed.json", "not-json{");
    const store = new InstallStore("/data/installed.json", fs);
    await expect(store.load()).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" });
  });

  it("skips malformed records but loads the rest", async () => {
    const fs = new InMemoryFs();
    const payload = JSON.stringify([
      record(),
      { id: "broken" /* missing fields */ },
      record({ id: "git" }),
    ]);
    fs.files.set("/data/installed.json", payload);
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    expect(store.list()).toHaveLength(2);
    expect(store.has("browser")).toBe(true);
    expect(store.has("git")).toBe(true);
    expect(store.has("broken")).toBe(false);
  });

  it("save() writes a JSON array of records", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record());
    store.set(record({ id: "git", source: "./git.yaml" }));
    await store.save();
    const written = JSON.parse(fs.files.get("/data/installed.json") ?? "[]");
    expect(written).toHaveLength(2);
    expect(written[0].id).toBe("browser");
    expect(written[1].id).toBe("git");
  });

  it("save() is atomic — failed writeFile does not overwrite the existing file", async () => {
    const fs = new InMemoryFs();
    fs.files.set("/data/installed.json", JSON.stringify([record()]));
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record({ id: "git", source: "./git.yaml" }));
    fs.failOnWrite = true;
    await expect(store.save()).rejects.toThrow("disk full");
    // The original file content is unchanged.
    const onDisk = fs.files.get("/data/installed.json");
    expect(JSON.parse(onDisk ?? "[]")).toEqual([record()]);
  });

  it("set() adds a new record and get() returns it", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record());
    expect(store.get("browser")?.version).toBe("1.0");
  });

  it("set() replaces an existing record (same id)", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record());
    store.set(record({ version: "2.0" }));
    expect(store.get("browser")?.version).toBe("2.0");
    expect(store.list()).toHaveLength(1);
  });

  it("delete() removes a record and returns true; subsequent get() returns null", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record());
    expect(store.delete("browser")).toBe(true);
    expect(store.get("browser")).toBeNull();
    expect(store.delete("browser")).toBe(false);
  });

  it("list() returns records in insertion order", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record({ id: "a" }));
    store.set(record({ id: "b" }));
    store.set(record({ id: "c" }));
    expect(store.list().map((r) => r.id)).toEqual(["a", "b", "c"]);
    // Re-setting an existing id does not move it.
    store.set(record({ id: "a", version: "2.0" }));
    expect(store.list().map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(store.get("a")?.version).toBe("2.0");
  });

  it("has() returns true/false correctly", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    expect(store.has("browser")).toBe(false);
    store.set(record());
    expect(store.has("browser")).toBe(true);
  });

  it("concurrent save() calls are serialized (no interleaved file writes)", async () => {
    const fs = new InMemoryFs();
    const store = new InstallStore("/data/installed.json", fs);
    await store.load();
    store.set(record({ id: "a" }));
    store.set(record({ id: "b" }));
    store.set(record({ id: "c" }));
    await Promise.all([store.save(), store.save(), store.save()]);
    expect(fs.maxConcurrentWrites).toBe(1);
  });
});