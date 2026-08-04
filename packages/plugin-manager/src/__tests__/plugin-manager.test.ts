import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEventBus, type EventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import {
  createPluginManager,
  ERROR_CODES,
  PluginManagerError,
  type Clock,
  type FileSystem,
  type InstallRecord,
} from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  unreadablePaths = new Set<string>();
  failOnWrite = false;

  async readFile(path: string): Promise<string> {
    if (this.unreadablePaths.has(path)) {
      const err = new Error(`EACCES: ${path}`) as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    }
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.failOnWrite) throw new Error("disk full");
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

class FixedClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, _ms: number): number { cb(); return 0; }
  clearTimeout(_h: number): void { /* noop */ }
}

const FIXTURES = new URL("./fixtures/", import.meta.url);

function path(file: string): string {
  return new URL(file, FIXTURES).pathname;
}

async function loadFixtures(fs: InMemoryFs, names: string[]): Promise<void> {
  for (const name of names) {
    fs.files.set(path(name), await readFile(path(name), "utf-8"));
  }
}

async function setup(opts: { fixtures?: string[] } = {}) {
  const fs = new InMemoryFs();
  const clock = new FixedClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    installRecordPath: "/data/installed.json",
  });
  await loadFixtures(fs, opts.fixtures ?? []);
  return { pm, bus, registry, fs, clock };
}

async function captureEvents(bus: EventBus): Promise<{ name: string; payload: unknown }[]> {
  const events: { name: string; payload: unknown }[] = [];
  bus.subscribe("plugin.*", (event) => {
    events.push({ name: event.name, payload: event.payload });
  });
  await Promise.resolve();
  return events;
}

const FIXTURE_LIST = [
  "browser.yaml",
  "logging.yaml",
  "vscode-helper.yaml",
  "collision.yaml",
  "malformed.yaml",
  "no-type.yaml",
  "two-types.yaml",
];

describe("plugin-manager install / list / get", () => {
  it("installs a runtime manifest and returns the install record", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    const record = await pm.install(path("browser.yaml"));
    expect(record.id).toBe("browser");
    expect(record.type).toBe("runtime");
    expect(record.version).toBe("1.0");
    expect(record.source).toBe(path("browser.yaml"));
    expect(record.enabled).toBe(true);
    expect(record.installedAt).toBe(1_700_000_000_000);
    expect(record.lastError).toBeUndefined();
  });

  it("registers the plugin's capabilities with the Capability Registry", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const cards = registry.list();
    const names = cards.map((c) => c.name).sort();
    expect(names).toEqual(["browser.click", "browser.navigate", "browser.screenshot"]);
    const types = cards.map((c) => c.type);
    expect(types.every((t) => t === "runtime")).toBe(true);
  });

  it("persists the install record to disk", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const onDisk = JSON.parse(fs.files.get("/data/installed.json") ?? "[]") as InstallRecord[];
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].id).toBe("browser");
    expect(onDisk[0].version).toBe("1.0");
  });

  it("publishes plugin.installed with the correct payload", async () => {
    const { pm, bus } = await setup({ fixtures: FIXTURE_LIST });
    const events = await captureEvents(bus);
    await pm.install(path("browser.yaml"));
    await Promise.resolve();
    const installed = events.filter((e) => e.name === "plugin.installed");
    expect(installed).toHaveLength(1);
    expect(installed[0].payload).toMatchObject({
      id: "browser",
      type: "runtime",
      version: "1.0",
      source: path("browser.yaml"),
      installedAt: 1_700_000_000_000,
    });
  });

  it("installs a service manifest with type: service", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    const record = await pm.install(path("logging.yaml"));
    expect(record.type).toBe("service");
    expect(record.id).toBe("logging");
    expect(registry.list()).toHaveLength(0);
  });

  it("installs a developer manifest with type: developer", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    const record = await pm.install(path("vscode-helper.yaml"));
    expect(record.type).toBe("developer");
    expect(record.id).toBe("vscode-helper");
    expect(registry.list()).toHaveLength(0);
  });

  it("installs a manifest with no capabilities", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    const record = await pm.install(path("logging.yaml"));
    expect(record.id).toBe("logging");
    expect(registry.list()).toHaveLength(0);
  });
});

describe("plugin-manager install — error paths", () => {
  it("throws PLUGIN_SOURCE_NOT_FOUND for a missing source file", async () => {
    const { pm } = await setup();
    await expect(pm.install("/no/such/file.yaml")).rejects.toMatchObject({
      code: ERROR_CODES.SOURCE_NOT_FOUND,
      details: { source: "/no/such/file.yaml" },
    });
  });

  it("throws PLUGIN_SOURCE_UNREADABLE for an unreadable source file", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    fs.unreadablePaths.add(path("browser.yaml"));
    await expect(pm.install(path("browser.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.SOURCE_UNREADABLE,
    });
  });

  it("throws PLUGIN_MANIFEST_INVALID for malformed YAML (with line/column)", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    try {
      await pm.install(path("malformed.yaml"));
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginManagerError);
      const e = err as PluginManagerError;
      expect(e.code).toBe(ERROR_CODES.MANIFEST_INVALID);
      expect(e.details.line).toEqual(expect.any(Number));
      expect(e.details.column).toEqual(expect.any(Number));
    }
  });

  it("throws PLUGIN_TYPE_MISSING for a manifest with no type key", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await expect(pm.install(path("no-type.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.TYPE_MISSING,
    });
  });

  it("throws PLUGIN_TYPE_AMBIGUOUS for a manifest with two type keys", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await expect(pm.install(path("two-types.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.TYPE_AMBIGUOUS,
    });
  });

  it("throws PLUGIN_ID_ALREADY_INSTALLED for a second install of the same id", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    await expect(pm.install(path("browser.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.ID_ALREADY_INSTALLED,
      details: { id: "browser" },
    });
  });

  it("throws PLUGIN_CAPABILITY_COLLISION when a capability is already registered by another owner", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    await registry.register("business-app", {
      owner: "business-app",
      capabilities: [{
        name: "customer.read",
        version: "1.0",
        type: "business",
        description: "read customer data",
        permissions: [],
        owner: "business-app",
      }],
    });
    await expect(pm.install(path("collision.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.CAPABILITY_COLLISION,
      details: { capability: "customer.read", existingOwner: "business-app" },
    });
  });

  it("does NOT persist the install record when collision is detected", async () => {
    const { pm, registry, fs } = await setup({ fixtures: FIXTURE_LIST });
    await registry.register("business-app", {
      owner: "business-app",
      capabilities: [{
        name: "customer.read",
        version: "1.0",
        type: "business",
        description: "read customer data",
        permissions: [],
        owner: "business-app",
      }],
    });
    await expect(pm.install(path("collision.yaml"))).rejects.toThrow();
    expect(fs.files.has("/data/installed.json")).toBe(false);
    expect(pm.list()).toHaveLength(0);
  });

  it("does NOT register any capabilities when validation fails", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    await expect(pm.install(path("malformed.yaml"))).rejects.toThrow();
    expect(registry.list()).toHaveLength(0);
  });
});

describe("plugin-manager list / get", () => {
  it("list() returns an empty array when nothing is installed", async () => {
    const { pm } = await setup();
    expect(pm.list()).toEqual([]);
  });

  it("list() returns all installed records", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    await pm.install(path("logging.yaml"));
    const list = pm.list();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.id).sort()).toEqual(["browser", "logging"]);
  });

  it("get(id) returns the record for an installed plugin", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    expect(pm.get("browser")?.id).toBe("browser");
  });

  it("get(id) returns null for a non-installed plugin", async () => {
    const { pm } = await setup();
    expect(pm.get("missing")).toBeNull();
  });
});

describe("plugin-manager installFromRegistry", () => {
  it("throws PLUGIN_MARKETPLACE_UNAVAILABLE for any id (stub)", async () => {
    const { pm } = await setup();
    await expect(pm.installFromRegistry("anything")).rejects.toMatchObject({
      code: ERROR_CODES.MARKETPLACE_UNAVAILABLE,
    });
  });

  it("does NOT modify any state when stub throws", async () => {
    const { pm, fs } = await setup();
    await expect(pm.installFromRegistry("anything")).rejects.toThrow();
    expect(fs.files.has("/data/installed.json")).toBe(false);
    expect(pm.list()).toHaveLength(0);
  });
});