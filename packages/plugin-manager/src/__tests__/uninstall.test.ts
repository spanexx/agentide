import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEventBus } from "@platform/event-bus";
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

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, due: this.nowValue + delayMs });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advance(ms: number): void {
    const target = this.nowValue + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
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

async function setup(opts: { cleanupTimeoutMs?: number; withBrowser?: boolean } = {}) {
  const fs = new InMemoryFs();
  fs.files.set(path("browser.yaml"), await readFile(path("browser.yaml"), "utf-8"));
  const clock = new TestClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    cleanupTimeoutMs: opts.cleanupTimeoutMs ?? 5000,
    installRecordPath: "/data/installed.json",
  });
  if (opts.withBrowser !== false) await pm.install(path("browser.yaml"));
  return { pm, bus, registry, fs, clock };
}

describe("plugin-manager uninstall", () => {
  it("publishes plugin.cleanup before any side effect", async () => {
    const { pm, bus, fs } = await setup();
    const events: { name: string; at: number }[] = [];
    let cleanupFired = false;
    fs.files.set(path("browser.yaml"), await readFile(path("browser.yaml"), "utf-8"));
    bus.subscribe("plugin.*", (event) => {
      events.push({ name: event.name, at: Date.now() });
      if (event.name === "plugin.cleanup") {
        cleanupFired = true;
        // At the moment cleanup fires, the record should still be present.
        expect(pm.get("browser")).not.toBeNull();
      }
    });
    // Emit the cleanup.confirm ourselves on the next tick to unblock uninstall.
    bus.subscribe("plugin.cleanup", (event) => {
      setTimeout(() => {
        const payload = event.payload as { id: string };
        void bus.publish("plugin.cleanup.confirm", payload);
      }, 0);
    });
    await pm.uninstall("browser");
    expect(cleanupFired).toBe(true);
  });

  it("completes uninstall when the plugin confirms cleanup", async () => {
    const { pm, bus, registry } = await setup();
    bus.subscribe("plugin.cleanup", (event) => {
      const payload = event.payload as { id: string };
      setTimeout(() => {
        void bus.publish("plugin.cleanup.confirm", payload);
      }, 0);
    });
    await pm.uninstall("browser");
    expect(pm.get("browser")).toBeNull();
    expect(registry.list()).toHaveLength(0);
  });

  it("publishes plugin.uninstalled after cleanup", async () => {
    const { pm, bus } = await setup();
    bus.subscribe("plugin.cleanup", (event) => {
      const payload = event.payload as { id: string };
      setTimeout(() => {
        void bus.publish("plugin.cleanup.confirm", payload);
      }, 0);
    });
    const events: string[] = [];
    bus.subscribe("plugin.*", (event) => {
      events.push(event.name);
    });
    await pm.uninstall("browser");
    const cleanupIdx = events.indexOf("plugin.cleanup");
    const uninstalledIdx = events.indexOf("plugin.uninstalled");
    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(uninstalledIdx).toBeGreaterThan(cleanupIdx);
  });

  it("completes uninstall after timeout when the plugin never confirms", async () => {
    const { pm, clock, registry } = await setup({ cleanupTimeoutMs: 50 });
    // Don't subscribe to plugin.cleanup — no confirm will arrive.
    const promise = pm.uninstall("browser");
    // Advance clock past the cleanup timeout.
    clock.advance(60);
    await promise;
    expect(pm.get("browser")).toBeNull();
    expect(registry.list()).toHaveLength(0);
  });

  it("ignores cleanup.confirm with a mismatched id and still times out", async () => {
    const { pm, bus, clock } = await setup({ cleanupTimeoutMs: 50 });
    // Confirm for a different id — should be ignored.
    void bus.publish("plugin.cleanup.confirm", { id: "not-this-plugin" });
    const promise = pm.uninstall("browser");
    clock.advance(60);
    await promise;
    expect(pm.get("browser")).toBeNull();
  });

  it("removes the install record from disk", async () => {
    const { pm, fs, clock } = await setup({ cleanupTimeoutMs: 100 });
    const promise = pm.uninstall("browser");
    clock.advance(150);
    await promise;
    const onDisk = JSON.parse(fs.files.get("/data/installed.json") ?? "[]") as InstallRecord[];
    expect(onDisk).toHaveLength(0);
  });

  it("throws PLUGIN_NOT_INSTALLED for a non-existent id", async () => {
    const { pm } = await setup({ withBrowser: false });
    await expect(pm.uninstall("missing")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_INSTALLED,
      details: { id: "missing" },
    });
  });

  it("respects config.cleanupTimeoutMs", async () => {
    const { pm, clock, bus } = await setup({ cleanupTimeoutMs: 200 });
    // Subscribe but never confirm.
    const promise = pm.uninstall("browser");
    // After 100ms, the timeout has not fired yet — promise not resolved.
    clock.advance(100);
    await Promise.resolve();
    // Use a quick race: if the uninstall already resolved, the timeout was too short.
    let earlyResolve = false;
    promise.then(() => { earlyResolve = true; });
    await Promise.resolve();
    expect(earlyResolve).toBe(false);
    // Now confirm — should unblock immediately.
    void bus.publish("plugin.cleanup.confirm", { id: "browser" });
    await promise;
    expect(pm.get("browser")).toBeNull();
  });
});