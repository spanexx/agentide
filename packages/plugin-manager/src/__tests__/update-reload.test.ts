import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEventBus, type EventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import {
  createPluginManager,
  ERROR_CODES,
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

async function setup(opts: { fixtures?: string[]; clockNow?: number } = {}) {
  const fs = new InMemoryFs();
  const clock = new FixedClock();
  if (opts.clockNow !== undefined) clock.nowValue = opts.clockNow;
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
  "browser-v2.yaml",
  "logging.yaml",
  "vscode-helper.yaml",
  "collision.yaml",
  "malformed.yaml",
  "no-type.yaml",
  "two-types.yaml",
];

describe("plugin-manager update", () => {
  it("swaps the install record to the new version", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const updated = await pm.update("browser", path("browser-v2.yaml"));
    expect(updated.version).toBe("2.0");
    expect(updated.source).toBe(path("browser-v2.yaml"));
    expect(updated.id).toBe("browser");
  });

  it("re-registers capabilities via the registry's diffing", async () => {
    const { pm, registry } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const before = registry.list().map((c) => c.name).sort();
    expect(before).toEqual(["browser.click", "browser.navigate", "browser.screenshot"]);
    await pm.update("browser", path("browser-v2.yaml"));
    const after = registry.list().map((c) => c.name).sort();
    expect(after).toContain("browser.evaluate");
    expect(after.length).toBeGreaterThanOrEqual(4);
  });

  it("publishes plugin.updated with oldVersion and newVersion", async () => {
    const { pm, bus } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const events = await captureEvents(bus);
    await pm.update("browser", path("browser-v2.yaml"));
    await Promise.resolve();
    const updated = events.filter((e) => e.name === "plugin.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].payload).toMatchObject({
      id: "browser",
      oldVersion: "1.0",
      newVersion: "2.0",
      source: path("browser-v2.yaml"),
    });
  });

  it("preserves installedAt on update", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST, clockNow: 1_700_000_000_000 });
    const installed = await pm.install(path("browser.yaml"));
    const updated = await pm.update("browser", path("browser-v2.yaml"));
    expect(updated.installedAt).toBe(installed.installedAt);
  });

  it("throws PLUGIN_NOT_INSTALLED for a non-existent id", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await expect(pm.update("missing", path("browser-v2.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.NOT_INSTALLED,
      details: { id: "missing" },
    });
  });

  it("throws PLUGIN_MANIFEST_INVALID when the new manifest id differs", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    // Use the collision fixture (id = "my-plugin") — different id than "browser".
    await expect(pm.update("browser", path("collision.yaml"))).rejects.toMatchObject({
      code: ERROR_CODES.MANIFEST_INVALID,
      details: { expected: "browser", got: "my-plugin" },
    });
  });

  it("throws PLUGIN_CAPABILITY_COLLISION when a new capability is owned by another owner", async () => {
    const { pm, fs, registry } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
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
    const v2Path = "/tmp/browser-collision-v2.yaml";
    fs.files.set(v2Path, [
      "runtime:",
      "  id: browser",
      "version: \"2.0\"",
      "capabilities:",
      "  - browser.navigate",
      "  - browser.click",
      "  - customer.read",
    ].join("\n"));
    await expect(pm.update("browser", v2Path)).rejects.toMatchObject({
      code: ERROR_CODES.CAPABILITY_COLLISION,
      details: { capability: "customer.read", existingOwner: "business-app" },
    });
  });

  it("preserves the install record on collision during update", async () => {
    const { pm, fs, registry } = await setup({ fixtures: FIXTURE_LIST });
    const installed = await pm.install(path("browser.yaml"));
    await registry.register("business-app", {
      owner: "business-app",
      capabilities: [{
        name: "customer.read", version: "1.0", type: "business",
        description: "x", permissions: [],
        owner: "business-app",
      }],
    });
    const v2Path = "/tmp/browser-bad-v2.yaml";
    fs.files.set(v2Path, [
      "runtime:",
      "  id: browser",
      "version: \"2.0\"",
      "capabilities:",
      "  - browser.navigate",
      "  - browser.click",
      "  - browser.screenshot",
      "  - browser.evaluate",
      "  - customer.read",
    ].join("\n"));
    await expect(pm.update("browser", v2Path)).rejects.toMatchObject({
      code: ERROR_CODES.CAPABILITY_COLLISION,
    });
    const list = pm.list();
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("1.0");
    expect(list[0].installedAt).toBe(installed.installedAt);
  });
});

describe("plugin-manager reload", () => {
  it("re-reads the install record's source", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    // Edit the source file in place — change version
    fs.files.set(path("browser.yaml"), await readFile(path("browser-v2.yaml"), "utf-8"));
    const reloaded = await pm.reload("browser");
    expect(reloaded.version).toBe("2.0");
    expect(reloaded.source).toBe(path("browser.yaml"));
  });

  it("with manifest version unchanged, leaves the version field alone", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    // Edit the source file but keep version "1.0"
    const edited = [
      "runtime:",
      "  id: browser",
      "version: \"1.0\"",
      "capabilities:",
      "  - browser.navigate",
      "  - browser.click",
    ].join("\n");
    fs.files.set(path("browser.yaml"), edited);
    const reloaded = await pm.reload("browser");
    expect(reloaded.version).toBe("1.0");
  });

  it("preserves installedAt, enabled, and source", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    const installed = await pm.install(path("browser.yaml"));
    await pm.disable("browser");
    fs.files.set(path("browser.yaml"), await readFile(path("browser-v2.yaml"), "utf-8"));
    const reloaded = await pm.reload("browser");
    expect(reloaded.installedAt).toBe(installed.installedAt);
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.source).toBe(installed.source);
  });

  it("rolls back the install record when registry.register throws during update", async () => {
    const { fs, clock } = await setup({ fixtures: FIXTURE_LIST });
    // Build a registry proxy whose register() succeeds for install but fails for update.
    const realBus = createEventBus();
    const realRegistry = createCapabilityRegistry(realBus);
    let registerCalls = 0;
    const failingRegistry = new Proxy(realRegistry, {
      get(target, prop, receiver) {
        if (prop === "register") {
          return async (...args: Parameters<typeof target.register>) => {
            registerCalls += 1;
            if (registerCalls > 1) {
              throw new Error("simulated registry failure");
            }
            return Reflect.apply(target.register, target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const failingPm = await createPluginManager(realBus, failingRegistry, {
      fs,
      clock,
      installRecordPath: "/data/installed-rollback.json",
    });
    const installed = await failingPm.install(path("browser.yaml"));
    await expect(
      failingPm.update("browser", path("browser-v2.yaml")),
    ).rejects.toThrow("simulated registry failure");
    const after = failingPm.list();
    expect(after).toHaveLength(1);
    expect(after[0].version).toBe(installed.version);
    expect(after[0].installedAt).toBe(installed.installedAt);
  });

  it("publishes plugin.reloaded", async () => {
    const { pm, bus } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    const events = await captureEvents(bus);
    await pm.reload("browser");
    await Promise.resolve();
    const reloaded = events.filter((e) => e.name === "plugin.reloaded");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].payload).toMatchObject({ id: "browser", version: "1.0" });
  });

  it("throws PLUGIN_SOURCE_NOT_FOUND and sets lastError when source is missing", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    fs.files.delete(path("browser.yaml"));
    await expect(pm.reload("browser")).rejects.toMatchObject({
      code: ERROR_CODES.SOURCE_NOT_FOUND,
    });
    const list = pm.list();
    expect(list).toHaveLength(1);
    expect(list[0].lastError?.code).toBe(ERROR_CODES.SOURCE_NOT_FOUND);
    expect(list[0].version).toBe("1.0");
  });

  it("sets lastError and preserves record when manifest becomes invalid", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    fs.files.set(path("browser.yaml"), await readFile(path("malformed.yaml"), "utf-8"));
    await expect(pm.reload("browser")).rejects.toMatchObject({
      code: ERROR_CODES.MANIFEST_INVALID,
    });
    const list = pm.list();
    expect(list).toHaveLength(1);
    expect(list[0].lastError?.code).toBe(ERROR_CODES.MANIFEST_INVALID);
    expect(list[0].version).toBe("1.0");
  });

  it("sets lastError and preserves record on collision", async () => {
    const { pm, fs, registry } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    await registry.register("business-app", {
      owner: "business-app",
      capabilities: [{
        name: "customer.read", version: "1.0", type: "business",
        description: "x", permissions: [],
        owner: "business-app",
      }],
    });
    fs.files.set(path("browser.yaml"), [
      "runtime:",
      "  id: browser",
      "version: \"1.0\"",
      "capabilities:",
      "  - customer.read",
    ].join("\n"));
    await expect(pm.reload("browser")).rejects.toMatchObject({
      code: ERROR_CODES.CAPABILITY_COLLISION,
    });
    const list = pm.list();
    expect(list).toHaveLength(1);
    expect(list[0].lastError?.code).toBe(ERROR_CODES.CAPABILITY_COLLISION);
    expect(list[0].version).toBe("1.0");
  });

  it("clears lastError on a successful reload", async () => {
    const { pm, fs } = await setup({ fixtures: FIXTURE_LIST });
    await pm.install(path("browser.yaml"));
    fs.files.delete(path("browser.yaml"));
    await expect(pm.reload("browser")).rejects.toThrow();
    expect(pm.get("browser")?.lastError?.code).toBe(ERROR_CODES.SOURCE_NOT_FOUND);
    // Restore the file and reload again.
    fs.files.set(path("browser.yaml"), await readFile(path("browser.yaml"), "utf-8"));
    const reloaded = await pm.reload("browser");
    expect(reloaded.lastError).toBeUndefined();
  });

  it("throws PLUGIN_NOT_INSTALLED for a non-existent id", async () => {
    const { pm } = await setup({ fixtures: FIXTURE_LIST });
    await expect(pm.reload("missing")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_INSTALLED,
    });
  });
});