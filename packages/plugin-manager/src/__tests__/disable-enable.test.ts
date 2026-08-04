import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEventBus, type EventBus } from "@spanexx/event-bus";
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

async function setup() {
  const fs = new InMemoryFs();
  fs.files.set(path("browser.yaml"), await readFile(path("browser.yaml"), "utf-8"));
  const clock = new FixedClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    installRecordPath: "/data/installed.json",
  });
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

describe("plugin-manager disable / enable", () => {
  it("disable flips enabled to false", async () => {
    const { pm } = await setup();
    await pm.install(path("browser.yaml"));
    const disabled = await pm.disable("browser");
    expect(disabled.enabled).toBe(false);
    expect(pm.get("browser")?.enabled).toBe(false);
  });

  it("disable publishes plugin.disabled", async () => {
    const { pm, bus } = await setup();
    await pm.install(path("browser.yaml"));
    const events = await captureEvents(bus);
    await pm.disable("browser");
    await Promise.resolve();
    const disabled = events.filter((e) => e.name === "plugin.disabled");
    expect(disabled).toHaveLength(1);
    expect(disabled[0].payload).toMatchObject({ id: "browser" });
  });

  it("disable persists the change to disk", async () => {
    const { pm, fs } = await setup();
    await pm.install(path("browser.yaml"));
    await pm.disable("browser");
    const onDisk = JSON.parse(fs.files.get("/data/installed.json") ?? "[]") as InstallRecord[];
    expect(onDisk[0].enabled).toBe(false);
  });

  it("disable does NOT unregister capabilities", async () => {
    const { pm, registry } = await setup();
    await pm.install(path("browser.yaml"));
    const before = registry.list().length;
    await pm.disable("browser");
    expect(registry.list().length).toBe(before);
  });

  it("disable on already-disabled is a no-op (no event, no save)", async () => {
    const { pm, bus, fs } = await setup();
    await pm.install(path("browser.yaml"));
    await pm.disable("browser");
    const before = fs.files.get("/data/installed.json");
    const events = await captureEvents(bus);
    await pm.disable("browser");
    await Promise.resolve();
    expect(fs.files.get("/data/installed.json")).toBe(before);
    expect(events.filter((e) => e.name === "plugin.disabled")).toHaveLength(0);
  });

  it("disable throws PLUGIN_NOT_INSTALLED for a non-existent id", async () => {
    const { pm } = await setup();
    await expect(pm.disable("missing")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_INSTALLED,
      details: { id: "missing" },
    });
  });

  it("enable flips enabled to true", async () => {
    const { pm } = await setup();
    await pm.install(path("browser.yaml"));
    await pm.disable("browser");
    const enabled = await pm.enable("browser");
    expect(enabled.enabled).toBe(true);
    expect(pm.get("browser")?.enabled).toBe(true);
  });

  it("enable publishes plugin.enabled", async () => {
    const { pm, bus } = await setup();
    await pm.install(path("browser.yaml"));
    await pm.disable("browser");
    const events = await captureEvents(bus);
    await pm.enable("browser");
    await Promise.resolve();
    const enabled = events.filter((e) => e.name === "plugin.enabled");
    expect(enabled).toHaveLength(1);
    expect(enabled[0].payload).toMatchObject({ id: "browser" });
  });

  it("enable on already-enabled is a no-op", async () => {
    const { pm, bus, fs } = await setup();
    await pm.install(path("browser.yaml"));
    const before = fs.files.get("/data/installed.json");
    const events = await captureEvents(bus);
    await pm.enable("browser");
    await Promise.resolve();
    expect(fs.files.get("/data/installed.json")).toBe(before);
    expect(events.filter((e) => e.name === "plugin.enabled")).toHaveLength(0);
  });

  it("enable throws PLUGIN_NOT_INSTALLED for a non-existent id", async () => {
    const { pm } = await setup();
    await expect(pm.enable("missing")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_INSTALLED,
    });
  });
});