/*
 * Code Map: plugin-manager lifecycle methods (install / update / reload / disable / enable / uninstall / startup)
 * Each public method is a free function that takes a PluginManagerContext so the createPluginManager factory stays thin.
 *
 * CID Index:
 * CID:lifecycle-001 -> install
 * CID:lifecycle-002 -> update
 * CID:lifecycle-003 -> reload
 * CID:lifecycle-004 -> disable
 * CID:lifecycle-005 -> enable
 * CID:lifecycle-006 -> awaitCleanupConfirm
 * CID:lifecycle-007 -> uninstall
 * CID:lifecycle-008 -> performStartupReinstall
 *
 * Quick lookup: rg -n "CID:lifecycle-" packages/plugin-manager/src/lifecycle.ts
 */

import { ERROR_CODES, PluginManagerError } from "./errors.js";
import {
  applyManifest,
  buildCapabilityRecords,
  checkCapabilityCollisions,
  pluginCapabilityType,
  pluginOwner,
  readManifestFromSource,
  type PluginManagerContext,
} from "./lifecycle-helpers.js";
import { manifestId, manifestType, validateManifest } from "./manifest.js";
import type { InstallRecord } from "./types.js";

// CID:lifecycle-001 - install
// Purpose: install a plugin from a local manifest file — parse, validate, persist, register, fire event
export async function install(
  ctx: PluginManagerContext,
  source: string,
): Promise<InstallRecord> {
  const manifest = await readManifestFromSource(ctx, source);
  validateManifest(manifest);

  const type = manifestType(manifest);
  const id = manifestId(manifest, type);

  if (ctx.store.has(id)) {
    throw new PluginManagerError(
      ERROR_CODES.ID_ALREADY_INSTALLED,
      `plugin "${id}" is already installed`,
      {
        id,
        suggestedCommand: `plugin.update ${id} --source <new-source>`,
      },
    );
  }

  const owner = pluginOwner(id);
  checkCapabilityCollisions(ctx.capabilityRegistry, owner, manifest.capabilities ?? []);

  const record: InstallRecord = {
    id,
    type,
    version: manifest.version,
    source,
    installedAt: ctx.clock.now(),
    enabled: true,
  };
  ctx.store.set(record);
  try {
    await ctx.store.save();
  } catch (err) {
    ctx.store.delete(id);
    throw err;
  }

  try {
    await ctx.capabilityRegistry.register(owner, {
      owner,
      capabilities: buildCapabilityRecords(manifest, pluginCapabilityType(type), owner),
    });
  } catch (err) {
    ctx.store.delete(id);
    try { await ctx.store.save(); } catch { /* swallow secondary failure */ }
    throw err;
  }

  ctx.events.installed(record);
  return record;
}

// CID:lifecycle-002 - update
// Purpose: swap install record to a new version — same mechanics as install but with expectedId enforced
export async function update(
  ctx: PluginManagerContext,
  id: string,
  source: string,
): Promise<InstallRecord> {
  const existing = ctx.store.get(id);
  if (!existing) {
    throw new PluginManagerError(
      ERROR_CODES.NOT_INSTALLED,
      `plugin "${id}" is not installed`,
      { id },
    );
  }
  const oldVersion = existing.version;
  const updated = await applyManifest(ctx, existing, source, {
    expectedId: id,
    allowVersionRefresh: false,
  });
  ctx.events.updated(id, oldVersion, updated.version, updated.source, ctx.clock.now());
  return updated;
}

// CID:lifecycle-003 - reload
// Purpose: re-read install record's source — refreshes capabilities and (optionally) version; preserves source, installedAt, enabled
export async function reload(
  ctx: PluginManagerContext,
  id: string,
): Promise<InstallRecord> {
  const existing = ctx.store.get(id);
  if (!existing) {
    throw new PluginManagerError(
      ERROR_CODES.NOT_INSTALLED,
      `plugin "${id}" is not installed`,
      { id },
    );
  }
  try {
    const updated = await applyManifest(ctx, existing, existing.source, {
      expectedId: id,
      allowVersionRefresh: true,
    });
    ctx.events.reloaded(id, updated.version, ctx.clock.now());
    return updated;
  } catch (err) {
    const e = err instanceof PluginManagerError ? err : null;
    const failed: InstallRecord = {
      ...existing,
      lastError: {
        code: e?.code ?? ERROR_CODES.MANIFEST_INVALID,
        message: e?.message ?? (err instanceof Error ? err.message : String(err)),
        details: e?.details ?? {},
        at: ctx.clock.now(),
      },
    };
    ctx.store.set(failed);
    try {
      await ctx.store.save();
    } catch {
      /* swallow secondary failure — the original error is what matters */
    }
    throw err;
  }
}

// CID:lifecycle-004 - disable
// Purpose: flip enabled flag to false; persist; fire plugin.disabled (no-op if already disabled)
export async function disable(
  ctx: PluginManagerContext,
  id: string,
): Promise<InstallRecord> {
  const existing = ctx.store.get(id);
  if (!existing) {
    throw new PluginManagerError(
      ERROR_CODES.NOT_INSTALLED,
      `plugin "${id}" is not installed`,
      { id },
    );
  }
  if (existing.enabled === false) return existing;
  const updated: InstallRecord = { ...existing, enabled: false };
  ctx.store.set(updated);
  await ctx.store.save();
  ctx.events.disabled(id, ctx.clock.now());
  return updated;
}

// CID:lifecycle-005 - enable
// Purpose: flip enabled flag to true; persist; fire plugin.enabled (no-op if already enabled)
export async function enable(
  ctx: PluginManagerContext,
  id: string,
): Promise<InstallRecord> {
  const existing = ctx.store.get(id);
  if (!existing) {
    throw new PluginManagerError(
      ERROR_CODES.NOT_INSTALLED,
      `plugin "${id}" is not installed`,
      { id },
    );
  }
  if (existing.enabled === true) return existing;
  const updated: InstallRecord = { ...existing, enabled: true };
  ctx.store.set(updated);
  await ctx.store.save();
  ctx.events.enabled(id, ctx.clock.now());
  return updated;
}

// CID:lifecycle-006 - awaitCleanupConfirm
// Purpose: transient subscribe on plugin.cleanup.confirm matching {id}; resolve true on confirm or false on timeout
export function awaitCleanupConfirm(
  ctx: PluginManagerContext,
  id: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const sub = ctx.eventBus.subscribe<{ id: string }>("plugin.cleanup.confirm", (event) => {
      if (done) return;
      if (event.payload.id === id) {
        done = true;
        ctx.clock.clearTimeout(handle);
        sub.unsubscribe();
        resolve(true);
      }
    });
    const handle = ctx.clock.setTimeout(() => {
      if (done) return;
      done = true;
      sub.unsubscribe();
      resolve(false);
    }, timeoutMs);
  });
}

// CID:lifecycle-007 - uninstall
// Purpose: fire plugin.cleanup, wait for confirm OR timeout, deregister capabilities, remove install record, fire plugin.uninstalled
export async function uninstall(
  ctx: PluginManagerContext,
  id: string,
): Promise<void> {
  const existing = ctx.store.get(id);
  if (!existing) {
    throw new PluginManagerError(
      ERROR_CODES.NOT_INSTALLED,
      `plugin "${id}" is not installed`,
      { id },
    );
  }
  ctx.events.cleanup(id);
  const confirmed = await awaitCleanupConfirm(ctx, id, ctx.cleanupTimeoutMs);
  if (!confirmed) {
    console.warn(
      `[plugin-manager] cleanup confirmation timed out for plugin "${id}" — uninstall proceeds anyway`,
    );
  }
  const owner = pluginOwner(id);
  await ctx.capabilityRegistry.register(owner, { owner, capabilities: [] });
  ctx.store.delete(id);
  await ctx.store.save();
  ctx.events.uninstalled(id, ctx.clock.now());
}

// CID:lifecycle-008 - performStartupReinstall
// Purpose: factory bootstrap — load persisted install records and re-register their capabilities; record lastError on failures; do NOT fire plugin.installed on startup
export async function performStartupReinstall(ctx: PluginManagerContext): Promise<void> {
  await ctx.store.load();
  for (const existing of ctx.store.list()) {
    try {
      await applyManifest(ctx, existing, existing.source, {
        expectedId: existing.id,
        allowVersionRefresh: true,
      });
    } catch (err) {
      const e = err instanceof PluginManagerError ? err : null;
      const failed: InstallRecord = {
        ...existing,
        lastError: {
          code: e?.code ?? ERROR_CODES.MANIFEST_INVALID,
          message: e?.message ?? (err instanceof Error ? err.message : String(err)),
          details: e?.details ?? {},
          at: ctx.clock.now(),
        },
      };
      ctx.store.set(failed);
      try {
        await ctx.store.save();
      } catch {
        /* swallow secondary failure */
      }
    }
  }
}