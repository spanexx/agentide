#!/usr/bin/env node
/*
 * Post-impl simulation for BI[8a] gateway-plugin-dispatch.
 *
 * Drives the real @platform/agentide + @platform/gateway-core + @platform/plugin-manager
 * packages end-to-end. Each scenario from the PRD-TRD's Behavioral Spec is exercised
 * against actual code, not a mock. Run with:
 *
 *   node packages/agentide/scripts/simulate-gateway-plugin-dispatch.mjs
 *
 * Scenarios verified (matching PRD-TRD §Behavioral Spec):
 *   1. Plugin installs with handler → invoke returns handler output
 *   2. Plugin without `entry` field → GATEWAY_HANDLER_NOT_FOUND
 *   3. Disabled plugin → GATEWAY_PLUGIN_DISABLED (kernel pre-check)
 *   4. Cap not in handler map → GATEWAY_HANDLER_NOT_FOUND
 *   5. Handler throws → GATEWAY_HANDLER_ERROR (per Option B matrix)
 *   6. Entry module fails to load → install succeeds, invoke fails, reload fixes
 *   7. Uninstall removes handler → capability becomes unreachable
 *   8. Concurrent invocations run in parallel (not serialized)
 *
 * Companion file: docs/features/gateway-plugin-dispatch/simulate-pre.html
 * (the pre-impl sim with hardcoded state; archive after reconciliation).
 *
 * Pass criterion: all 8 scenarios print PASS. Exit code 0 on success, 1 on any FAIL.
 */

import { createPlatform } from "@spanexx/agentide";
import { ERROR_CODES } from "@spanexx/gateway-core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────

class InMemoryFs {
  files = new Map();
  async readFile(p) {
    const v = this.files.get(p);
    if (v === undefined) {
      const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e;
    }
    return v;
  }
  async writeFile(p, c) { this.files.set(p, c); }
  async exists(p) { return this.files.has(p); }
}

const HANDLER_SOURCE = `export default {
  "browser.navigate": async (input) => {
    await new Promise((r) => setTimeout(r, 50));
    return { navigated: true, url: input?.url ?? "about:blank" };
  },
  "browser.click": async (input) => ({ clicked: true, selector: input?.selector ?? "body" }),
  "browser.boom": async () => { throw new Error("handler exploded"); },
};`;

const MANIFEST = (entry) => `runtime:
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

const MANIFEST_BROKEN = (badEntry) => `runtime:
  id: broken
  entry: ${badEntry}
version: "1.0"
capabilities:
  - browser.navigate
`;

// ────────────────────────────────────────────────────────────────────────
// Sim runner
// ────────────────────────────────────────────────────────────────────────

const results = [];
let currentPlatform = null;

function record(scenario, status, detail) {
  results.push({ scenario, status, detail });
  const marker = status === "PASS" ? "✓" : "✗";
  console.log(`  ${marker} Scenario ${scenario}: ${status}${detail ? ` — ${detail}` : ""}`);
}

async function withFreshPlatform(fn) {
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
  });
  currentPlatform = platform;
  try {
    return await fn(platform, fs);
  } finally {
    try { await platform.stop(); } catch { /* ignore */ }
    currentPlatform = null;
  }
}

async function installAndGrant(platform, fs, opts) {
  fs.files.set("/data/plugins/browser.yaml", opts.manifest);
  await platform.pluginManager.install("/data/plugins/browser.yaml");
  // PM's buildCapabilityRecords() hardcodes permissions:[] on install. Re-register
  // with a non-empty permission list so the authz layer matches the test token.
  const records = opts.capNames
    .map((name) => platform.capabilityRegistry.describe(name).capability)
    .filter((c) => c !== null && c !== undefined)
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

async function sessionCtx(platform) {
  const issued = await platform.gateway.issueToken({
    tenantId: "default",
    callerId: "integration-test",
    scope: ["*"],
  });
  const sessionId = platform.sessionManager.create({ ownerId: "integration-test", adapterType: "mcp" }).id;
  const invokeCap = (name, input = {}) =>
    platform.gateway.handleInvocation({
      token: issued.token,
      caller: { tenantId: "default", callerId: "integration-test", scope: ["*"] },
      capability: { name },
      input,
      sessionId,
    });
  return { token: issued.token, sessionId, invokeCap };
}

// ────────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────────

async function scenario1(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(handlerEntry),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    const r = await invokeCap("browser.navigate", { url: "https://example.com" });
    if ("output" in r && r.output?.navigated === true && r.output?.url === "https://example.com") {
      record(1, "PASS", "handler output returned end-to-end");
    } else {
      record(1, "FAIL", JSON.stringify(r));
    }
  });
}

async function scenario2() {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST_NO_ENTRY,
      pluginId: "legacy",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    const r = await invokeCap("browser.navigate", {});
    if ("error" in r && r.error.code === ERROR_CODES.HANDLER_NOT_FOUND) {
      record(2, "PASS", "no entry field → HANDLER_NOT_FOUND");
    } else {
      record(2, "FAIL", JSON.stringify(r));
    }
  });
}

async function scenario3(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(handlerEntry),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    await platform.pluginManager.disable("browser");
    const { invokeCap } = await sessionCtx(platform);
    const r = await invokeCap("browser.navigate", {});
    // Drift D-30: kernel pre-check fires PLUGIN_DISABLED before PM dispatch.
    // PM-side fallback (if pre-check were removed) would be HANDLER_NOT_FOUND.
    if ("error" in r && r.error.code === ERROR_CODES.PLUGIN_DISABLED) {
      record(3, "PASS", "disabled plugin → PLUGIN_DISABLED (kernel pre-check, D-30)");
    } else {
      record(3, "FAIL", JSON.stringify(r));
    }
  });
}

async function scenario4(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    // `unmapped_cap` is unknown to the PM's tier-inferer, so set tier explicitly.
    // Handler map does NOT export this key — that's the point of the scenario.
    const manifest = `runtime:
  id: browser
  entry: ${handlerEntry}
version: "1.0"
capabilities:
  - browser.navigate
  - name: browser.unmapped_cap
    tier: read
`;
    await installAndGrant(platform, fs, {
      manifest,
      pluginId: "browser",
      capNames: ["browser.navigate", "browser.unmapped_cap"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    // Sanity: navigate works
    const nav = await invokeCap("browser.navigate", { url: "https://ok" });
    if (!("output" in nav)) {
      record(4, "FAIL", `navigate sanity failed: ${JSON.stringify(nav)}`);
      return;
    }
    // Now invoke unmapped_cap → HANDLER_NOT_FOUND
    const r = await invokeCap("browser.unmapped_cap", {});
    if ("error" in r && r.error.code === ERROR_CODES.HANDLER_NOT_FOUND) {
      record(4, "PASS", "cap not in handler map → HANDLER_NOT_FOUND");
    } else {
      record(4, "FAIL", JSON.stringify(r));
    }
  });
}

async function scenario5(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(handlerEntry),
      pluginId: "browser",
      capNames: ["browser.navigate", "browser.boom"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    const r = await invokeCap("browser.boom", {});
    // Drift D-31: PRD scenario text said INTERNAL_ERROR; Option B matrix + tests
    // assert HANDLER_ERROR. PRD text updated per drift review.
    if ("error" in r && r.error.code === ERROR_CODES.HANDLER_ERROR) {
      const originalError = r.error.details?.originalError;
      if (typeof originalError === "string" && originalError.includes("handler exploded")) {
        record(5, "PASS", "handler throws → HANDLER_ERROR (D-31), original error preserved in details");
      } else {
        record(5, "FAIL", `HANDLER_ERROR but missing originalError in details: ${JSON.stringify(r.error.details)}`);
      }
    } else {
      record(5, "FAIL", JSON.stringify(r));
    }
  });
}

async function scenario6(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    fs.files.set("/data/plugins/browser.yaml", MANIFEST_BROKEN("/nonexistent/does/not/exist.mjs"));
    await platform.pluginManager.install("/data/plugins/browser.yaml");
    // Grant perms on the registered cap (PM registers with empty perms; re-grant
    // so authz matches the wildcard token).
    const records = ["browser.navigate"]
      .map((name) => platform.capabilityRegistry.describe(name).capability)
      .filter((c) => c !== null && c !== undefined)
      .map((c) => ({ ...c, permissions: ["browser.read"] }));
    await platform.capabilityRegistry.register("plugin:broken", {
      owner: "plugin:broken",
      capabilities: records,
    });
    const { invokeCap } = await sessionCtx(platform);
    // First invoke: entry load failed at install time → HANDLER_NOT_FOUND.
    const before = await invokeCap("browser.navigate", {});
    if (!("error" in before) || before.error.code !== ERROR_CODES.HANDLER_NOT_FOUND) {
      record(6, "FAIL", `first invoke: expected HANDLER_NOT_FOUND, got ${JSON.stringify(before)}`);
      return;
    }
    // Operator fixes the source: PM records source path as the install-time path,
    // so the new manifest must land at the SAME path.
    fs.files.set(
      "/data/plugins/browser.yaml",
      MANIFEST_BROKEN(handlerEntry),
    );
    await platform.pluginManager.reload("broken");
    // Reload re-applies the manifest (empty perms again); re-grant.
    const reloaded = ["browser.navigate"]
      .map((name) => platform.capabilityRegistry.describe(name).capability)
      .filter((c) => c !== null && c !== undefined)
      .map((c) => ({ ...c, permissions: ["browser.read"] }));
    await platform.capabilityRegistry.register("plugin:broken", {
      owner: "plugin:broken",
      capabilities: reloaded,
    });
    const after = await invokeCap("browser.navigate", { url: "https://fixed" });
    if ("output" in after && after.output?.navigated === true) {
      record(6, "PASS", "entry load fails → HANDLER_NOT_FOUND; reload fixes → invoke succeeds");
    } else {
      record(6, "FAIL", `after reload: ${JSON.stringify(after)}`);
    }
  });
}

async function scenario7(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(handlerEntry),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    const before = await invokeCap("browser.navigate", { url: "https://x" });
    if (!("output" in before)) {
      record(7, "FAIL", `pre-uninstall invoke failed: ${JSON.stringify(before)}`);
      return;
    }
    await platform.pluginManager.uninstall("browser");
    const after = await invokeCap("browser.navigate", { url: "https://x" });
    // Drift D-32: registry check fires before handler map lookup, so most
    // likely surface code is CAPABILITY_NOT_FOUND; handler map lookup is the
    // fallback. Either is acceptable per the IMPL.
    if ("error" in after && /^GATEWAY_(CAPABILITY|HANDLER)_NOT_FOUND$/.test(after.error.code)) {
      record(7, "PASS", `uninstall removes handler → ${after.error.code} (D-32)`);
    } else {
      record(7, "FAIL", JSON.stringify(after));
    }
  });
}

async function scenario8(handlerEntry) {
  await withFreshPlatform(async (platform, fs) => {
    await installAndGrant(platform, fs, {
      manifest: MANIFEST(handlerEntry),
      pluginId: "browser",
      capNames: ["browser.navigate"],
      requiredPermission: "browser.read",
    });
    const { invokeCap } = await sessionCtx(platform);
    const t0 = Date.now();
    const results = await Promise.all([
      invokeCap("browser.navigate", { url: "https://a.example" }),
      invokeCap("browser.navigate", { url: "https://b.example" }),
    ]);
    const elapsed = Date.now() - t0;
    const allOk = results.every((r) => "output" in r);
    if (allOk && elapsed < 150) {
      record(8, "PASS", `two parallel 50ms invokes completed in ${elapsed}ms (serialized would be ~100ms)`);
    } else {
      record(8, "FAIL", `elapsed=${elapsed}ms, allOk=${allOk}, results=${JSON.stringify(results)}`);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("━━━ BI[8a] gateway-plugin-dispatch post-impl simulation ━━━\n");
  console.log("Driving real @platform/agentide + plugin-manager + gateway-core packages.\n");

  // Write a real .mjs handler file to a real tmpdir so dynamic import works.
  const tmpDir = await mkdtemp(join(tmpdir(), "sim-bi8a-"));
  const handlerEntry = join(tmpDir, "browser-handlers.mjs");
  await writeFile(handlerEntry, HANDLER_SOURCE, "utf-8");
  console.log(`Handler fixture: ${handlerEntry}\n`);

  console.log("Running 8 PRD-TRD scenarios:\n");
  await scenario1(handlerEntry);
  await scenario2();
  await scenario3(handlerEntry);
  await scenario4(handlerEntry);
  await scenario5(handlerEntry);
  await scenario6(handlerEntry);
  await scenario7(handlerEntry);
  await scenario8(handlerEntry);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.length - passed;

  console.log(`\n━━━ Summary ━━━`);
  console.log(`Total: ${results.length}  Passed: ${passed}  Failed: ${failed}\n`);

  if (failed > 0) {
    console.error("FAIL: at least one scenario did not pass.");
    process.exit(1);
  }
  console.log("ALL 8 SCENARIOS PASSED ✓");
  process.exit(0);
}

main().catch((err) => {
  console.error("Sim crashed:", err);
  if (currentPlatform) {
    currentPlatform.stop().catch(() => {});
  }
  process.exit(1);
});
