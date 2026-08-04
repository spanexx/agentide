/*
 * Code Map: shared helpers used by every plugin-manager lifecycle method
 * - PluginManagerContext: shared deps (store, events, clock, fs, yaml, capability registry, event bus, cleanup timeout)
 * - pluginOwner / pluginCapabilityType / buildCapabilityRecords / checkCapabilityCollisions: small helpers
 * - readManifestFromSource: parse + wrap YAML/fs errors
 * - applyManifest: shared parse + validate + persist + register pipeline (update, reload, startup)
 *
 * CID Index:
 * CID:helpers-001 -> pluginOwner
 * CID:helpers-002 -> pluginCapabilityType
 * CID:helpers-003 -> buildCapabilityRecords
 * CID:helpers-004 -> checkCapabilityCollisions
 * CID:helpers-005 -> readManifestFromSource
 * CID:helpers-006 -> applyManifest
 *
 * Quick lookup: rg -n "CID:helpers-" packages/plugin-manager/src/lifecycle-helpers.ts
 */

import type { CapabilityRecord, CapabilityRegistry, CapabilityTier, CapabilityType } from "@spanexx/capability-registry";
import type { EventBus } from "@spanexx/event-bus";
import { ERROR_CODES, PluginManagerError } from "./errors.js";
import type { EventPublisher } from "./events.js";
import { manifestId, manifestType, parseManifest, validateManifest } from "./manifest.js";
import { tierFromConvention } from "./tier-convention.js";
import type { InstallStore } from "./store.js";
import type {
  Clock,
  FileSystem,
  InstallRecord,
  ManifestCapability,
  PluginManifest,
  PluginType,
  YamlParser,
} from "./types.js";

export interface PluginManagerContext {
  readonly store: InstallStore;
  readonly events: EventPublisher;
  readonly eventBus: EventBus;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly fs: FileSystem;
  readonly yaml: YamlParser;
  readonly clock: Clock;
  readonly cleanupTimeoutMs: number;
}

// CID:helpers-001 - pluginOwner
export function pluginOwner(id: string): string {
  return `plugin:${id}`;
}

// CID:helpers-002 - pluginCapabilityType
// Purpose: maps a plugin type to the CapabilityType registered against the Capability Registry
export function pluginCapabilityType(type: PluginType): CapabilityType {
  if (type === "runtime") return "runtime";
  return "platform";
}

// CID:helpers-003 - buildCapabilityRecords
// Purpose: turns the manifest's capability name list into CapabilityRecord[]
//   with permissions and tier derived per BI[7] Decision 6 (hybrid):
//   - explicit `tier:` if the manifest entry is `{name, tier}` object
//   - else tierFromConvention(name) — verb lookup in READ/ACT/DESTRUCTIVE lists
//   - throws TIER_REQUIRED if both are absent (e.g. "browser.screenshot")
// Used by: lifecycle install/update/reload paths
export function buildCapabilityRecords(
  manifest: PluginManifest,
  capType: CapabilityType,
  owner: string,
): readonly CapabilityRecord[] {
  const fallbackDescription = manifest.metadata?.description ?? "";
  return (manifest.capabilities ?? []).map((entry: ManifestCapability) => {
    const name = typeof entry === "string" ? entry : entry.name;
    const explicitTier: CapabilityTier | null =
      typeof entry === "string" ? null : entry.tier;
    const inferred = tierFromConvention(name);
    const tier = explicitTier ?? inferred;
    if (tier === null) {
      throw new PluginManagerError(
        ERROR_CODES.TIER_REQUIRED,
        `capability "${name}" requires an explicit tier — verb not in convention (READ/ACT/DESTRUCTIVE)`,
        { capability: name },
      );
    }
    return {
      name,
      version: manifest.version,
      type: capType,
      description: fallbackDescription || name,
      permissions: [],
      owner,
      tier,
    };
  });
}

// CID:helpers-004 - checkCapabilityCollisions
// Purpose: pre-checks each declared capability against the Capability Registry; throws PLUGIN_CAPABILITY_COLLISION if any capability is already owned by a different owner
// Accepts the manifest's `capabilities` (strings or {name,tier} objects); only the name is used.
export function checkCapabilityCollisions(
  registry: CapabilityRegistry,
  owner: string,
  capabilities: readonly ManifestCapability[],
): void {
  for (const entry of capabilities) {
    const cap = typeof entry === "string" ? entry : entry.name;
    const result = registry.describe(cap);
    if (result.capability && result.capability.owner !== owner) {
      throw new PluginManagerError(
        ERROR_CODES.CAPABILITY_COLLISION,
        `capability "${cap}" is already registered by "${result.capability.owner}"`,
        { capability: cap, existingOwner: result.capability.owner },
      );
    }
  }
}

// CID:helpers-005 - readManifestFromSource
// Purpose: read+parse a manifest from a source path; wrap fs errors as PLUGIN_SOURCE_NOT_FOUND/PLUGIN_SOURCE_UNREADABLE and YAML errors as PLUGIN_MANIFEST_INVALID
export async function readManifestFromSource(
  ctx: PluginManagerContext,
  source: string,
): Promise<PluginManifest> {
  let content: string;
  try {
    content = await ctx.fs.readFile(source);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      throw new PluginManagerError(
        ERROR_CODES.SOURCE_NOT_FOUND,
        `source file ${source} does not exist`,
        { source },
      );
    }
    throw new PluginManagerError(
      ERROR_CODES.SOURCE_UNREADABLE,
      err instanceof Error ? err.message : String(err),
      { source },
    );
  }
  return parseManifest(content, ctx.yaml);
}

// CID:helpers-006 - applyManifest
// Purpose: shared parse + validate + persist + register pipeline used by update, reload, and startup re-install
export async function applyManifest(
  ctx: PluginManagerContext,
  existing: InstallRecord,
  source: string,
  opts: { expectedId: string; allowVersionRefresh: boolean },
): Promise<InstallRecord> {
  const manifest = await readManifestFromSource(ctx, source);
  validateManifest(manifest);

  const type = manifestType(manifest);
  const id = manifestId(manifest, type);

  if (id !== opts.expectedId) {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      `manifest id "${id}" does not match expected "${opts.expectedId}"`,
      { expected: opts.expectedId, got: id, field: "id" },
    );
  }

  const owner = pluginOwner(id);
  checkCapabilityCollisions(ctx.capabilityRegistry, owner, manifest.capabilities ?? []);

  const versionChanged = manifest.version !== existing.version;
  const updated: InstallRecord = {
    ...existing,
    version: opts.allowVersionRefresh && !versionChanged ? existing.version : manifest.version,
    source: opts.allowVersionRefresh ? existing.source : source,
    lastError: undefined,
  };

  ctx.store.set(updated);
  await ctx.store.save();

  try {
    await ctx.capabilityRegistry.register(owner, {
      owner,
      capabilities: buildCapabilityRecords(manifest, pluginCapabilityType(type), owner),
    });
  } catch (err) {
    // Roll back the persisted record so disk and registry stay consistent.
    ctx.store.set(existing);
    try {
      await ctx.store.save();
    } catch {
      /* swallow secondary failure — the original error is what matters */
    }
    throw err;
  }

  return updated;
}