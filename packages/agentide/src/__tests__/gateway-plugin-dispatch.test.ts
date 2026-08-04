/*
 * Code Map: BI[8a] Phase 5 — gateway → plugin dispatch end-to-end.
 *
 * Real .mjs handler in a tmpdir, real dynamic-import — proves the production
 * path, not a mock. 8 PRD-TRD scenarios.
 *   CID:phase5-test-001 → createPlatform wiring
 *   CID:phase5-test-002 → 8 scenarios
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform, type Platform } from "../index.js";
import type { FileSystem, YamlValue } from "@spanexx/gateway-core";
import { ERROR_CODES } from "@spanexx/gateway-core";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

let tmpDir: string;
const platforms: Platform[] = [];

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phase5-"));
  // Real .mjs file the production loader will import.
  await writeFile(
    join(tmpDir, "browser-handlers.mjs"),
    `export default {
       "browser.navigate": async (input) => {
         await new Promise((r) => setTimeout(r, 50));
         return { navigated: true, url: input?.url ?? "about:blank" };
       },
       "browser.click": async (input) => ({ clicked: true, selector: input?.selector ?? "body" }),
       "browser.boom": async () => { throw new Error("handler exploded"); },
     };`,
    "utf-8",
  );
});

afterEach(async () => {
  for (const p of platforms.splice(0)) {
    try { await p.stop(); } catch { /* ignore */ }
  }
});

interface Ctx {
  readonly platform: Platform;
  readonly fs: InMemoryFs;
  readonly token: string;
  readonly sessionId: string;
  readonly invokeCap: (name: string, input?: YamlValue) => Promise<{ output?: YamlValue; error?: { code: string; details?: Readonly<Record<string, YamlValue>> } }>;
}

async function boot(): Promise<{ platform: Platform; fs: InMemoryFs }> {
  const fs = new InMemoryFs();
  const platform = await createPlatform({
    fs,
    dataDir: "/data",
    defaultTenant: { id: "default", name: "Default" },
    rateLimit: { capacity: 1000, tokensPerSecond: 1000 },
    handlerTimeoutMs: 5_000,
    // The browser-handlers.mjs fixture has no cleanup-confirm hook, so
    // uninstall would otherwise wait the full PM default of 5000ms.
    cleanupTimeoutMs: 50,
    // BI[9] — keep this suite hermetic; the MCP wiring itself is
    // exercised in mcp-adapter.test.ts.
    adapterMcp: false,
    adapterWs: false,
  });
  platforms.push(platform);
  return { platform, fs };
}

const MANIFEST = (entry: string) => `runtime:
  id: browser
  entry: ${entry}
version: "1.0"
capabilities:
  - browser.navigate
  - browser.click
  - name: browser.boom
    tier: read
`;

const MANIFEST_NO_ENTRY = `runtime:
  id: legacy
version: "1.0"
capabilities:
  - browser.navigate
`;

const MANIFEST_BROKEN = `runtime:
  id: broken
  entry: /nonexistent/does/not/exist.mjs
version: "1.0"
capabilities:
  - browser.navigate
`;

// Install plugin, grant caps a single permission.
async function installAndGrant(
  platform: Platform,
  fs: InMemoryFs,
  opts: {
    readonly manifest: string;
    readonly pluginId: string;
    readonly capNames: readonly string[];
    readonly requiredPermission: string;
  },
): Promise<void> {
  fs.files.set("/data/plugins/browser.yaml", opts.manifest);
  await platform.pluginManager.install("/data/plugins/browser.yaml");
  const records = opts.capNames
    .map((name) => platform.capabilityRegistry.describe(name).capability)
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({
      name: c.name,
      version: c.version,
      type: c.type,
      description: c.description,
      tier: c.tier,
      permissions: [opts.requiredPermission],
      owner: c.owner,
    }));
  await platform.capabilityRegistry.register(`plugin:${opts.pluginId}`, {
    owner: `plugin:${opts.pluginId}`,
    capabilities: records,
  });
}

// Mint token, create session, return a one-arg invokeCap() closure that
// binds the token + session. The plugin manager's buildCapabilityRecords()
// hardcodes permissions:[] on every plugin-installed cap, so callers must
// run installAndGrant() first to give the cap a non-empty permission list
// that the authz layer can match. (Authz layer is out of scope for BI[8a] —
// this is a dispatch wiring test, not an authz test.)
async function sessionCtx(platform: Platform): Promise<{
  readonly token: string;
  readonly sessionId: string;
  readonly invokeCap: Ctx["invokeCap"];
}> {
  const issued = await platform.gateway.issueToken({
    tenantId: "default",
    callerId: "integration-test",
    scope: ["*"],
  });
  const sessionId = platform.sessionManager.create({ ownerId: "integration-test", adapterType: "mcp" }).id;
  const invokeCap = (name: string, input: YamlValue = {}) =>
    platform.gateway.handleInvocation({
      token: issued.token,
      caller: { tenantId: "default", callerId: "integration-test", scope: ["*"] },
      capability: { name },
      input,
      sessionId,
    });
  return { token: issued.token, sessionId, invokeCap };
}

// Combined helper for the common "install + grant + mint + invoke" path.
async function setupBrowser(
  platform: Platform,
  fs: InMemoryFs,
  opts: {
    readonly manifest: string;
    readonly pluginId: string;
    readonly capNames: readonly string[];
    readonly requiredPermission: string;
  },
): Promise<Ctx> {
  await installAndGrant(platform, fs, opts);
  const { token, sessionId, invokeCap } = await sessionCtx(platform);
  return { platform, fs, token, sessionId, invokeCap };
}

// =============================================================================
// CID:phase5-test-001 - createPlatform wiring for plugin dispatch
// =============================================================================
describe("createPlatform wires plugin dispatch end-to-end (BI[8a] Phase 5)", () => {
  // 1. Happy path: installed plugin handler returns output.
  it("Scenario 1: plugin installs with handler, invoke returns result", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST(join(tmpDir, "browser-handlers.mjs")),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const r = await ctx.invokeCap("browser.navigate", { url: "https://example.com" });
    expect(r).toMatchObject({ output: { navigated: true, url: "https://example.com" } });
  });

  // 2. Plugin without `entry` field: handler map is empty, dispatch fails.
  it("Scenario 2: plugin without entry field → GATEWAY_HANDLER_NOT_FOUND", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST_NO_ENTRY,
      pluginId: "legacy",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const r = await ctx.invokeCap("browser.navigate", {});
    expect(r).toMatchObject({ error: { code: ERROR_CODES.HANDLER_NOT_FOUND } });
  });

  // 3. Disabled plugin: kernel's pre-check throws PLUGIN_DISABLED before
  // dispatching. (The IMPL Option B matrix maps PM errors to GATEWAY_* codes;
  // PLUGIN_DISABLED is surfaced directly because the kernel pre-check catches
  // it first.)
  it("Scenario 3: disabled plugin → GATEWAY_PLUGIN_DISABLED", async () => {
    const { platform, fs } = await boot();
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(join(tmpDir, "browser-handlers.mjs")),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    await platform.pluginManager.disable("browser");
    const { invokeCap } = await sessionCtx(platform);
    const r = await invokeCap("browser.navigate", {});
    expect(r).toMatchObject({ error: { code: ERROR_CODES.PLUGIN_DISABLED } });
  });

  // 4. Cap declared in manifest but not exported by entry module.
  it("Scenario 4: cap not in handler map → GATEWAY_HANDLER_NOT_FOUND", async () => {
    const { platform, fs } = await boot();
    // `unmapped_cap` is unknown to the PM's tier-inferer, so set tier
    // explicitly. Handler map does not export this key — that's the point.
    const manifest = `runtime:
  id: browser
  entry: ${join(tmpDir, "browser-handlers.mjs")}
version: "1.0"
capabilities:
  - browser.navigate
  - name: browser.unmapped_cap
    tier: read
`;
    const ctx = await setupBrowser(platform, fs, {
      manifest,
      pluginId: "browser",
      capNames: ["browser.navigate", "browser.unmapped_cap"],
      requiredPermission: "browser.read",
    });
    expect(await ctx.invokeCap("browser.navigate", { url: "https://ok" })).toHaveProperty("output");
    const r = await ctx.invokeCap("browser.unmapped_cap", {});
    expect(r).toMatchObject({ error: { code: ERROR_CODES.HANDLER_NOT_FOUND } });
  });

  // 5. Handler throws → GATEWAY_HANDLER_ERROR (original error preserved).
  it("Scenario 5: handler throws → GATEWAY_HANDLER_ERROR", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST(join(tmpDir, "browser-handlers.mjs")),
      pluginId: "browser",
      capNames: ["browser.navigate", "browser.boom"],
      requiredPermission: "browser.read",
    });
    const r = await ctx.invokeCap("browser.boom", {});
    expect(r).toMatchObject({ error: { code: ERROR_CODES.HANDLER_ERROR } });
    const { originalError } = (r.error?.details ?? {}) as { originalError?: string };
    expect(originalError).toContain("handler exploded");
  });

  // 6. Entry load fails; operator fixes + reloads.
  it("Scenario 6: entry load fails until reload → HANDLER_NOT_FOUND", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST_BROKEN,
      pluginId: "broken",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    // Install succeeded (manifest was valid; PM records the load failure
    // silently). First invoke fails with HANDLER_NOT_FOUND.
    const before = await ctx.invokeCap("browser.navigate", {});
    expect(before).toMatchObject({ error: { code: ERROR_CODES.HANDLER_NOT_FOUND } });
    // Operator fixes the file: the install recorded the source as
    // `/data/plugins/browser.yaml`, so the new content must land at that
    // same path (or the PM's reload will re-read the old manifest).
    // id stays "broken"; the entry now points at the real handler module.
    fs.files.set(
      "/data/plugins/browser.yaml",
      `runtime:
  id: broken
  entry: ${join(tmpDir, "browser-handlers.mjs")}
version: "1.0"
capabilities:
  - browser.navigate
`,
    );
    await platform.pluginManager.reload("broken");
    // Reload re-applies the manifest (empty perms); re-grant so authz passes.
    const records = ["browser.navigate"]
      .map((name) => platform.capabilityRegistry.describe(name).capability)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({ ...c, permissions: ["browser.read"] }));
    await platform.capabilityRegistry.register("plugin:broken", { owner: "plugin:broken", capabilities: records });
    const after = await ctx.invokeCap("browser.navigate", { url: "https://fixed" });
    expect(after).toMatchObject({ output: { navigated: true, url: "https://fixed" } });
  });

  // 7. Uninstall removes the cap from the registry; subsequent invoke
  // resolves at the registry check (CAPABILITY_NOT_FOUND) since the cap is
  // gone. Either CAPABILITY_NOT_FOUND or HANDLER_NOT_FOUND is acceptable
  // per the IMPL — both correctly signal "this cap is not callable".
  it("Scenario 7: uninstall removes handler, capability becomes unreachable", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST(join(tmpDir, "browser-handlers.mjs")),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const before = await ctx.invokeCap("browser.navigate", { url: "https://x" });
    expect(before).toHaveProperty("output");
    await platform.pluginManager.uninstall("browser");
    const after = await ctx.invokeCap("browser.navigate", { url: "https://x" });
    expect(after).toMatchObject({ error: { code: expect.stringMatching(/GATEWAY_(CAPABILITY|HANDLER)_NOT_FOUND/) } });
  });

  // 8. Two parallel invokes of the 50ms handler must finish in <150ms.
  it("Scenario 8: parallel invocations run concurrently (not serialized)", async () => {
    const { platform, fs } = await boot();
    const ctx = await setupBrowser(platform, fs, {
      manifest: MANIFEST(join(tmpDir, "browser-handlers.mjs")),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const t0 = Date.now();
    const results = await Promise.all([
      ctx.invokeCap("browser.navigate", { url: "https://a.example" }),
      ctx.invokeCap("browser.navigate", { url: "https://b.example" }),
    ]);
    expect(Date.now() - t0).toBeLessThan(150);
    for (const r of results) expect(r).toHaveProperty("output");
  });
});
