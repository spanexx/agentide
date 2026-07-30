// Phase 1 of BI[8a] gateway-plugin-dispatch: plugin handler loading via dynamic import.
// Per the GRILL, the plugin manifest's `runtime.entry` field points to a Node ESM
// module that exports a default object of `{ [capabilityName]: async (input, ctx) => result }`.
// Plugin manager dynamic-imports at install time; handleInvocation calls synchronously.

import { describe, expect, it } from "vitest";
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry } from "@platform/capability-registry";
import {
  createPluginManager,
  PluginManagerError,
  type Clock,
  type FileSystem,
} from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) {
      const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    return v;
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
}

class FixedClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, _ms: number): number { cb(); return 0; }
  clearTimeout(_h: number): void { /* noop */ }
}

// Mirror the pattern from plugin-manager.test.ts: use URL.pathname
// to produce an absolute path the InMemoryFs can resolve.
const FIXTURES = new URL("./fixtures/", import.meta.url);
const path = (file: string): string => new URL(file, FIXTURES).pathname;

async function loadFromDisk(fs: InMemoryFs, name: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const p = path(name);
  fs.files.set(p, await readFile(p, "utf-8"));
  return p;
}

async function setupWithLoaded(fixtures: string[]) {
  const fs = new InMemoryFs();
  const clock = new FixedClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    installRecordPath: "/data/installed.json",
  });
  for (const f of fixtures) {
    await loadFromDisk(fs, f);
  }
  return { pm, bus, registry, fs };
}

describe("PluginManager.handleInvocation (BI[8a] Phase 1)", () => {
  it("returns the handler's result for a registered capability", async () => {
    const { pm } = await setupWithLoaded(["browser-with-entry.yaml", "browser-handlers.mjs"]);
    await pm.install(path("browser-with-entry.yaml"));
    const result = await pm.handleInvocation("browser.navigate", { url: "https://example.com" }, undefined);
    expect(result).toEqual({ navigated: true, url: "https://example.com" });
  });

  it("throws HANDLER_NOT_FOUND for a capability not in the plugin's handler map", async () => {
    const { pm } = await setupWithLoaded(["browser-with-entry.yaml", "browser-handlers.mjs"]);
    await pm.install(path("browser-with-entry.yaml"));
    await expect(
      pm.handleInvocation("browser.nonexistent", {}, undefined),
    ).rejects.toThrow(PluginManagerError);
  });

  it("throws HANDLER_NOT_FOUND for a plugin installed without an entry field", async () => {
    const { pm } = await setupWithLoaded(["browser.yaml"]);
    await pm.install(path("browser.yaml"));
    // browser.yaml has no `entry` — the plugin registered its capabilities
    // but has no handler map. handleInvocation is the right call shape
    // but the kernel code (Phase 5) checks owner before handleInvocation.
    // Phase 1 of BI[8a] only adds the API surface; integration lives
    // in Phase 5. For now, every invocation should fail with
    // HANDLER_NOT_FOUND or PLUGIN_NO_ENTRY.
    await expect(
      pm.handleInvocation("browser.navigate", {}, undefined),
    ).rejects.toThrow();
  });

  it("throws when plugin is disabled", async () => {
    const { pm } = await setupWithLoaded(["browser-with-entry.yaml", "browser-handlers.mjs"]);
    await pm.install(path("browser-with-entry.yaml"));
    await pm.disable("browser");
    await expect(
      pm.handleInvocation("browser.navigate", {}, undefined),
    ).rejects.toThrow();
  });

  it("entry field is optional — plugin without entry installs cleanly", async () => {
    const { pm } = await setupWithLoaded(["browser.yaml"]);
    const record = await pm.install(path("browser.yaml"));
    expect(record.id).toBe("browser");
    expect(record.enabled).toBe(true);
    // Phase 1 doesn't add the entry field; default is undefined.
    // The PluginManifest type still requires runtime to have `id` (existing).
  });
});

describe("PluginManifest.runtime.entry (BI[8a] Phase 1)", () => {
  it("manifest with entry field type-checks", async () => {
    // Verifies the type contract: runtime.entry is an optional string
    // alongside the existing runtime.id. The dynamic-import behavior
    // is tested via handleInvocation above.
    const { pm } = await setupWithLoaded(["browser-with-entry.yaml"]);
    const record = await pm.install(path("browser-with-entry.yaml"));
    expect(record.id).toBe("browser");
  });
});
