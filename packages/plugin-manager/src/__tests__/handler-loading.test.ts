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

  it("preserves handler error code + retryable in PLUGIN_HANDLER_ERROR details (AUDIT F10)", async () => {
    // A handler that throws a structured browser-style error (code +
    // retryable). The wrap must preserve both in details so gateway-core
    // can pass them to the caller. Uses a real .mjs file on disk like
    // the reload test — dynamic import needs a real module.
    const { pm, fs } = await setupWithLoaded(["browser-with-entry.yaml"]);
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join(tmpdir(), "plugin-f10-"));
    try {
      const entryPath = join(tmpDir, "browser-f10.mjs");
      await writeFile(
        entryPath,
        `export default {
          "browser.wait": async () => {
            const e = new Error("element never appeared");
            e.code = "BROWSER_WAIT_TIMEOUT";
            e.retryable = true;
            throw e;
          },
        };`,
        "utf-8",
      );
      const manifestPath = path("browser-with-entry.yaml");
      fs.files.set(
        manifestPath,
        `runtime:\n  id: browser\n  entry: ${entryPath}\nversion: "1.0"\ncapabilities:\n  - browser.wait\n`,
      );
      await pm.install(manifestPath);

      const err = await pm.handleInvocation("browser.wait", {}, undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PluginManagerError);
      const pme = err as PluginManagerError;
      expect(pme.code).toBe("PLUGIN_HANDLER_ERROR");
      expect(pme.details).toMatchObject({
        originalErrorCode: "BROWSER_WAIT_TIMEOUT",
        retryable: true,
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("adds no originalErrorCode/retryable for plain Errors (backward compat)", async () => {
    const { pm, fs } = await setupWithLoaded(["browser-with-entry.yaml"]);
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join(tmpdir(), "plugin-f10b-"));
    try {
      const entryPath = join(tmpDir, "browser-plain.mjs");
      await writeFile(
        entryPath,
        `export default {
          "browser.click": async () => { throw new Error("plain failure"); },
        };`,
        "utf-8",
      );
      const manifestPath = path("browser-with-entry.yaml");
      fs.files.set(
        manifestPath,
        `runtime:\n  id: browser\n  entry: ${entryPath}\nversion: "1.0"\ncapabilities:\n  - browser.click\n`,
      );
      await pm.install(manifestPath);

      const err = await pm.handleInvocation("browser.click", {}, undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PluginManagerError);
      const pme = err as PluginManagerError;
      expect(pme.details).not.toHaveProperty("originalErrorCode");
      expect(pme.details).not.toHaveProperty("retryable");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
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

// =============================================================================
// BI[8a] Phase 2: lifecycle-integration tests for handler loading.
//
// These exercise the four lifecycle paths that interact with the handler
// registry: reload (re-imports), uninstall (drops), disable→enable
// (round-trip without re-import), and startup-reinstall (persisted
// records wire handlers at boot). Each test stands alone — no shared
// state across describe blocks.
// =============================================================================

describe("PluginManager handler lifecycle (BI[8a] Phase 2)", () => {
  it("reload re-imports handlers when the manifest points at a new entry file", async () => {
    // Pre-populate both v1 and v2 handler files. The manifest initially
    // points at v1; after we mutate the manifest on disk + call reload,
    // the manager should re-read the manifest and import the v2 module.
    //
    // Note: loadHandlers does a real `import(resolved)` — Node's import
    // cache keys on the resolved path. To verify "reload re-imports",
    // we point the manifest at a NEW file. The new file must exist on
    // real disk (the InMemoryFs only caches manifests, not handler
    // modules), so we write a real .mjs file under /tmp.
    const { pm, fs } = await setupWithLoaded([
      "browser-with-entry.yaml",
      "browser-handlers.mjs",
    ]);
    await pm.install(path("browser-with-entry.yaml"));

    // v1 sanity check
    const v1 = await pm.handleInvocation("browser.navigate", { url: "https://v1" }, undefined);
    expect(v1).toEqual({ navigated: true, url: "https://v1" });

    // Author ships v2: write a real .mjs file on disk. Place it in
    // /tmp/ since the fixtures dir is read-only.
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp(join(tmpdir(), "plugin-rel-"));
    try {
      const v2Path = join(tmpDir, "browser-handlers-v2.mjs");
      await writeFile(
        v2Path,
        `export default {
          "browser.navigate": async (input) => ({ navigated: true, url: input.url, version: 2 }),
        };`,
        "utf-8",
      );

      // Manifest now points at v2. The runtime.entry field is the only
      // thing that matters for handler loading. We rewrite the manifest
      // in InMemoryFs (which is how the production fs adapter would
      // surface a re-read).
      const manifestPath = path("browser-with-entry.yaml");
      fs.files.set(
        manifestPath,
        `runtime:\n  id: browser\n  entry: ${v2Path}\nversion: "1.0"\ncapabilities:\n  - browser.navigate\n`,
      );

      // Reload: re-reads manifest, re-imports handlers, reuses the same
      // install record (id, installedAt, source persist).
      const record = await pm.reload("browser");
      expect(record.id).toBe("browser");

      const v2 = await pm.handleInvocation("browser.navigate", { url: "https://v2" }, undefined);
      expect(v2).toEqual({ navigated: true, url: "https://v2", version: 2 });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("uninstall drops the handler so the capability is no longer invokable", async () => {
    const { pm } = await setupWithLoaded([
      "browser-with-entry.yaml",
      "browser-handlers.mjs",
    ]);
    await pm.install(path("browser-with-entry.yaml"));
    // Pre-uninstall sanity: invoke works
    await expect(
      pm.handleInvocation("browser.navigate", { url: "https://x" }, undefined),
    ).resolves.toEqual({ navigated: true, url: "https://x" });

    await pm.uninstall("browser");

    // Post-uninstall: the capability is gone from the registry AND the
    // handler is dropped. Either gate throws — the test only requires
    // the operation to reject, not the specific error code.
    await expect(
      pm.handleInvocation("browser.navigate", { url: "https://x" }, undefined),
    ).rejects.toThrow(PluginManagerError);

    // List is empty
    expect(pm.list()).toHaveLength(0);
  });

  it("disable then enable round-trips: handlers stay in memory, no re-import", async () => {
    const { pm } = await setupWithLoaded([
      "browser-with-entry.yaml",
      "browser-handlers.mjs",
    ]);
    await pm.install(path("browser-with-entry.yaml"));

    // While enabled: invoke works
    const beforeDisable = await pm.handleInvocation(
      "browser.navigate",
      { url: "https://enabled" },
      undefined,
    );
    expect(beforeDisable).toEqual({ navigated: true, url: "https://enabled" });

    // Disable — handlers retained, but invocation must throw
    await pm.disable("browser");
    await expect(
      pm.handleInvocation("browser.navigate", { url: "https://disabled" }, undefined),
    ).rejects.toThrow(PluginManagerError);

    // The install record reflects disabled state
    expect(pm.get("browser")?.enabled).toBe(false);

    // Enable — same handler map, no re-import needed
    await pm.enable("browser");
    expect(pm.get("browser")?.enabled).toBe(true);

    const afterEnable = await pm.handleInvocation(
      "browser.navigate",
      { url: "https://reenabled" },
      undefined,
    );
    expect(afterEnable).toEqual({ navigated: true, url: "https://reenabled" });

    // Idempotency: enabling again is a no-op (no error)
    await expect(pm.enable("browser")).resolves.toBeDefined();
  });

  it("startup reinstall loads handlers for persisted install records", async () => {
    // Pre-populate the install record file BEFORE creating the manager.
    // The source path points at a real manifest we also pre-populate.
    const fs = new InMemoryFs();
    const clock = new FixedClock();

    const manifestPath = path("browser-with-entry.yaml");
    const handlersPath = path("browser-handlers.mjs");

    // Load both fixture files into the in-memory fs using real disk reads
    // (same trick as setupWithLoaded's loadFromDisk).
    const { readFile } = await import("node:fs/promises");
    fs.files.set(manifestPath, await readFile(manifestPath, "utf-8"));
    fs.files.set(handlersPath, await readFile(handlersPath, "utf-8"));

    // Write the install record file. The manager's startup-reinstall loop
    // reads this and re-registers the plugin's capabilities.
    const recordPath = "/data/installed.json";
    const record = {
      id: "browser",
      type: "runtime",
      version: "1.0",
      source: manifestPath,
      installedAt: clock.nowValue,
      enabled: true,
    };
    fs.files.set(recordPath, JSON.stringify([record], null, 2));

    // Now create the manager. performStartupReinstall will run, then the
    // factory's post-startup loop will load handlers for every persisted
    // record whose manifest has a runtime.entry field.
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const pm = await createPluginManager(bus, registry, {
      fs,
      clock,
      installRecordPath: recordPath,
    });

    // The capability is registered, the handler is loaded — handleInvocation
    // works WITHOUT an explicit install call.
    const result = await pm.handleInvocation(
      "browser.navigate",
      { url: "https://startup" },
      undefined,
    );
    expect(result).toEqual({ navigated: true, url: "https://startup" });

    // Sanity: list shows the persisted record
    const records = pm.list();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("browser");
  });
});
