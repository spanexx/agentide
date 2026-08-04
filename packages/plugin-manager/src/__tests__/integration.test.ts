import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import {
  createPluginManager,
  ERROR_CODES,
  type Clock,
  type FileSystem,
  type InstallRecord,
} from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
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
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  private nextHandle = 0;
  private readonly timers = new Map<number, { callback: () => void; due: number }>();
  now(): number { return this.nowValue; }
  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, due: this.nowValue + delayMs });
    return handle;
  }
  clearTimeout(handle: number): void { this.timers.delete(handle); }
  advance(ms: number): void {
    const target = this.nowValue + ms;
    while (true) {
      const next = [...this.timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.nowValue = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.nowValue = target;
  }
}

const FIXTURES = new URL("./fixtures/", import.meta.url);

function path(file: string): string {
  return new URL(file, FIXTURES).pathname;
}

async function loadFixture(name: string): Promise<string> {
  return readFile(path(name), "utf-8");
}

async function setup(_opts: { cleanupTimeoutMs?: number; installRecordPath?: string } = {}) {
  const fs = new InMemoryFs();
  for (const name of ["browser.yaml", "logging.yaml", "browser-v2.yaml", "malformed.yaml"]) {
    fs.files.set(path(name), await loadFixture(name));
  }
  const clock = new TestClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  return { fs, clock, bus, registry };
}

describe("plugin-manager startup re-install", () => {
  it("completes with no error when install-record file is missing", async () => {
    const { fs, clock, bus, registry } = await setup();
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.list()).toEqual([]);
  });

  it("throws PLUGIN_MANIFEST_INVALID when install-record file is malformed", async () => {
    const { fs, clock, bus, registry } = await setup();
    fs.files.set("/data/installed.json", "not-json{");
    await expect(
      createPluginManager(bus, registry, {
        fs,
        clock,
        installRecordPath: "/data/installed.json",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.MANIFEST_INVALID });
  });

  it("re-installs every record on construction", async () => {
    const { fs, clock, bus, registry } = await setup();
    // Pre-populate the install-record file with a valid record.
    const record: InstallRecord = {
      id: "browser",
      type: "runtime",
      version: "1.0",
      source: path("browser.yaml"),
      installedAt: 1_600_000_000_000,
      enabled: true,
    };
    fs.files.set("/data/installed.json", JSON.stringify([record]));
    const events: string[] = [];
    bus.subscribe("plugin.*", (event) => {
      events.push(event.name);
    });
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.list()).toHaveLength(1);
    expect(pm.get("browser")?.version).toBe("1.0");
    // No plugin.installed should fire on startup.
    expect(events.filter((e) => e === "plugin.installed")).toHaveLength(0);
    // Capabilities should be registered.
    expect(registry.list().map((c) => c.name).sort()).toEqual([
      "browser.click",
      "browser.navigate",
      "browser.screenshot",
    ]);
  });

  it("sets lastError and continues when a record's source is missing", async () => {
    const { fs, clock, bus, registry } = await setup();
    fs.files.delete(path("browser.yaml"));
    fs.files.set("/data/installed.json", JSON.stringify([
      { id: "browser", type: "runtime", version: "1.0", source: path("browser.yaml"), installedAt: 1, enabled: true },
      { id: "logging", type: "service", version: "1.0", source: path("logging.yaml"), installedAt: 1, enabled: true },
    ]));
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.list()).toHaveLength(2);
    expect(pm.get("browser")?.lastError?.code).toBe(ERROR_CODES.SOURCE_NOT_FOUND);
    expect(pm.get("logging")?.lastError).toBeUndefined();
  });

  it("sets lastError and continues when a record's source is invalid", async () => {
    const { fs, clock, bus, registry } = await setup();
    fs.files.set("/data/installed.json", JSON.stringify([
      { id: "browser", type: "runtime", version: "1.0", source: path("malformed.yaml"), installedAt: 1, enabled: true },
    ]));
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.get("browser")?.lastError?.code).toBe(ERROR_CODES.MANIFEST_INVALID);
  });

  it("sets lastError and continues on collision", async () => {
    const { fs, clock, bus, registry } = await setup();
    await registry.register("business-app", {
      owner: "business-app",
      capabilities: [{
        name: "browser.navigate", version: "1.0", type: "business",
        description: "x", permissions: [],
        owner: "business-app",
      }],
    });
    fs.files.set("/data/installed.json", JSON.stringify([
      { id: "browser", type: "runtime", version: "1.0", source: path("browser.yaml"), installedAt: 1, enabled: true },
    ]));
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.get("browser")?.lastError?.code).toBe(ERROR_CODES.CAPABILITY_COLLISION);
  });

  it("persists lastError updates on startup", async () => {
    const { fs, clock, bus, registry } = await setup();
    fs.files.delete(path("browser.yaml"));
    fs.files.set("/data/installed.json", JSON.stringify([
      { id: "browser", type: "runtime", version: "1.0", source: path("browser.yaml"), installedAt: 1, enabled: true },
    ]));
    await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    const onDisk = JSON.parse(fs.files.get("/data/installed.json") ?? "[]") as InstallRecord[];
    expect(onDisk[0].lastError?.code).toBe(ERROR_CODES.SOURCE_NOT_FOUND);
  });

  it("operator can fix the missing source and reload to clear lastError", async () => {
    const { fs, clock, bus, registry } = await setup();
    fs.files.delete(path("browser.yaml"));
    fs.files.set("/data/installed.json", JSON.stringify([
      { id: "browser", type: "runtime", version: "1.0", source: path("browser.yaml"), installedAt: 1, enabled: true },
    ]));
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm.get("browser")?.lastError?.code).toBe(ERROR_CODES.SOURCE_NOT_FOUND);
    // Operator restores the file.
    fs.files.set(path("browser.yaml"), await loadFixture("browser.yaml"));
    const reloaded = await pm.reload("browser");
    expect(reloaded.lastError).toBeUndefined();
  });
});

describe("plugin-manager full lifecycle", () => {
  it("install → reload → disable → enable → update → uninstall round-trip", async () => {
    const { fs, clock, bus, registry } = await setup();
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
      cleanupTimeoutMs: 100,
    });
    const installed = await pm.install(path("browser.yaml"));
    expect(installed.id).toBe("browser");

    const reloaded = await pm.reload("browser");
    expect(reloaded.version).toBe("1.0");

    const disabled = await pm.disable("browser");
    expect(disabled.enabled).toBe(false);

    const enabled = await pm.enable("browser");
    expect(enabled.enabled).toBe(true);

    const updated = await pm.update("browser", path("browser-v2.yaml"));
    expect(updated.version).toBe("2.0");

    // Setup cleanup confirm responder.
    bus.subscribe("plugin.cleanup", (event) => {
      const payload = event.payload as { id: string };
      setTimeout(() => {
        void bus.publish("plugin.cleanup.confirm", payload);
      }, 0);
    });

    await pm.uninstall("browser");
    expect(pm.list()).toHaveLength(0);
    expect(registry.list()).toHaveLength(0);
  });

  it("restart simulation: createPluginManager picks up existing install records", async () => {
    const { fs, clock, bus, registry } = await setup();
    // First lifetime: install browser.
    {
      const pm = await createPluginManager(bus, registry, {
        fs,
        clock,
        installRecordPath: "/data/installed.json",
      });
      await pm.install(path("browser.yaml"));
      expect(fs.files.has("/data/installed.json")).toBe(true);
    }
    // Second lifetime: re-create. Capabilities should be re-registered.
    registry.list().forEach(() => { /* no-op; we want to confirm registry sees them again */ });
    const listAfterFirst = registry.list().length;
    const pm2 = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: "/data/installed.json",
    });
    expect(pm2.list()).toHaveLength(1);
    expect(pm2.get("browser")?.id).toBe("browser");
    // Capabilities registered (re-registered — registry diffs; net result: same).
    expect(registry.list().length).toBe(listAfterFirst);
  });
});