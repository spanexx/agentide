/*
 * Code Map: Plugin Manifest parser + validator
 * - parseManifest: YAML string → PluginManifest (coerces shape, wraps YAML errors)
 * - validateManifest: pure structural checks (exactly one type key, id+version present, capability names valid)
 * - manifestType: extracts the type from a validated manifest
 * - manifestId: extracts the id for a given type
 *
 * CID Index:
 * CID:manifest-001 -> parseManifest
 * CID:manifest-002 -> validateManifest
 * CID:manifest-003 -> manifestType
 * CID:manifest-004 -> manifestId
 *
 * Quick lookup: rg -n "CID:manifest-" packages/plugin-manager/src/manifest.ts
 */

import type { CapabilityTier } from "@platform/capability-registry";
import { ERROR_CODES, PluginManagerError } from "./errors.js";
import type {
  ManifestCapability,
  PluginManifest,
  PluginType,
  YamlParser,
  YamlValue,
} from "./types.js";

const CAPABILITY_NAME_REGEX = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/;

// CID:manifest-001 - parseManifest
// Purpose: YAML string → PluginManifest; coerces shape and wraps YAML errors with line/col
// Uses: YamlParser (injected), PluginManagerError
// Used by: install / update / reload lifecycle methods
export function parseManifest(content: string, yaml: YamlParser): PluginManifest {
  let raw: YamlValue;
  try {
    raw = yaml.parse(content);
  } catch (err) {
    const pos =
      err && typeof err === "object" && "linePos" in err
        ? (err as { linePos?: Array<{ line: number; col: number }> }).linePos?.[0]
        : undefined;
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      err instanceof Error ? err.message : String(err),
      {
        line: pos?.line ?? null,
        column: pos?.col ?? null,
      },
    );
  }
  return coerceManifest(raw);
}

function isYamlObject(value: YamlValue): value is { readonly [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceManifest(raw: YamlValue): PluginManifest {
  if (!isYamlObject(raw)) {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      "manifest root must be a YAML mapping",
      { expected: "object", got: Array.isArray(raw) ? "array" : typeof raw },
    );
  }
  const runtime = coerceTypeKey(raw.runtime, "runtime");
  const service = coerceTypeKey(raw.service, "service");
  const developer = coerceTypeKey(raw.developer, "developer");
  const version = coerceVersion(raw.version);
  const capabilities = coerceCapabilities(raw.capabilities);
  const metadata = coerceMetadata(raw.metadata);
  return {
    ...(runtime !== undefined ? { runtime } : {}),
    ...(service !== undefined ? { service } : {}),
    ...(developer !== undefined ? { developer } : {}),
    version,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

// CID:manifest-005 - coerceTypeKey (BI[8a] gateway-plugin-dispatch)
// Purpose: extract the typed sub-object for the plugin's discriminator key.
//   For "runtime" plugins, preserves the optional `entry` field (path to a
//   Node ESM module loaded at install time per BI[8a]). For "service" and
//   "developer", entry isn't applicable; only `id` is required.
// Used by: coerceManifest (above).
function coerceTypeKey(
  value: YamlValue,
  type: PluginType,
): { readonly id: string; readonly entry?: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isYamlObject(value)) {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      `manifest type key "${type}" must be an object`,
      { expected: "object", got: Array.isArray(value) ? "array" : typeof value, type },
    );
  }
  const id = value.id;
  if (typeof id !== "string") {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      `manifest type key "${type}" must have a string "id"`,
      { expected: "string", got: typeof id, field: "id", type },
    );
  }
  // For runtime plugins, the optional `entry` field is the path to a Node
  // ESM module to dynamic-import at install time. We validate it's a string
  // (or undefined) here; the existence check happens in the loader, not
  // during manifest parsing.
  if (type === "runtime") {
    const entry = value.entry;
    if (entry !== undefined && typeof entry !== "string") {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        `manifest runtime.entry must be a string (path to a Node ESM module)`,
        { expected: "string", got: typeof entry, field: "entry" },
      );
    }
    return entry === undefined ? { id } : { id, entry };
  }
  return { id };
}

function coerceVersion(value: YamlValue): string {
  if (typeof value !== "string") {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      "manifest must have a string \"version\"",
      { expected: "string", got: typeof value, field: "version" },
    );
  }
  return value;
}

function coerceCapabilities(value: YamlValue): readonly ManifestCapability[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      "manifest \"capabilities\" must be an array of strings or {name,tier} objects",
      { expected: "array", got: typeof value, field: "capabilities" },
    );
  }
  const out: ManifestCapability[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (!isCapabilityObject(item)) {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        `manifest capabilities[${i}] must be a string or {name,tier} object`,
        { expected: "string|object", got: typeof item, index: i },
      );
    }
    const validTiers: readonly string[] = ["read", "act", "destructive"];
    if (item.tier !== undefined && !validTiers.includes(item.tier)) {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        `manifest capabilities[${i}] tier must be one of read|act|destructive (got ${JSON.stringify(item.tier)})`,
        { index: i, got: String(item.tier) },
      );
    }
    out.push({
      name: item.name,
      tier: (item.tier ?? "act") as CapabilityTier,
    });
  }
  return out;
}

// Narrow YamlValue into a {name:string, tier?:string} capability-object shape.
// Returns false for strings, arrays, null, or objects missing a string `name`.
function isCapabilityObject(
  value: YamlValue,
): value is { readonly name: string; readonly tier?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const name = (value as { name?: YamlValue }).name;
  if (typeof name !== "string") return false;
  const tier = (value as { tier?: YamlValue }).tier;
  if (tier === undefined) return true;
  return typeof tier === "string";
}

function coerceMetadata(
  value: YamlValue,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isYamlObject(value)) {
    throw new PluginManagerError(
      ERROR_CODES.MANIFEST_INVALID,
      "manifest \"metadata\" must be an object of string → string",
      { expected: "object", got: typeof value, field: "metadata" },
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      throw new PluginManagerError(
        ERROR_CODES.MANIFEST_INVALID,
        `manifest metadata["${k}"] must be a string`,
        { expected: "string", got: typeof v, key: k },
      );
    }
    out[k] = v;
  }
  return out;
}

// CID:manifest-002 - validateManifest
// Purpose: pure structural checks — type key uniqueness, id+version presence, capability name format
// Uses: ERROR_CODES, PluginManagerError
// Used by: install / update / reload after parseManifest
export function validateManifest(manifest: PluginManifest): void {
  const types: PluginType[] = [];
  if (manifest.runtime) types.push("runtime");
  if (manifest.service) types.push("service");
  if (manifest.developer) types.push("developer");

  if (types.length === 0) {
    throw new PluginManagerError(
      ERROR_CODES.TYPE_MISSING,
      "manifest must declare exactly one of: runtime, service, developer",
      { expected: "one type key", got: "none" },
    );
  }
  if (types.length > 1) {
    throw new PluginManagerError(
      ERROR_CODES.TYPE_AMBIGUOUS,
      "manifest must declare exactly one of: runtime, service, developer",
      { expected: "one type key", found: types },
    );
  }

  const type = types[0];
  const id = manifest[type]!.id;
  if (!id) {
    throw new PluginManagerError(
      ERROR_CODES.ID_MISSING,
      `manifest ${type} plugin must have a non-empty "id"`,
      { type },
    );
  }

  if (!manifest.version) {
    throw new PluginManagerError(
      ERROR_CODES.VERSION_MISSING,
      "manifest must have a non-empty \"version\"",
      {},
    );
  }

  if (manifest.capabilities) {
    for (let i = 0; i < manifest.capabilities.length; i++) {
      const entry = manifest.capabilities[i];
      const capName = typeof entry === "string" ? entry : entry.name;
      if (!CAPABILITY_NAME_REGEX.test(capName)) {
        throw new PluginManagerError(
          ERROR_CODES.CAPABILITY_NAME_INVALID,
          `capability "${capName}" is not in the required format`,
          { capability: capName, format: "domain.action", index: i },
        );
      }
    }
  }
}

// CID:manifest-003 - manifestType
// Purpose: returns the type discriminator for a validated manifest
// Used by: install/update/reload lifecycle methods when building the InstallRecord
export function manifestType(manifest: PluginManifest): PluginType {
  if (manifest.runtime) return "runtime";
  if (manifest.service) return "service";
  if (manifest.developer) return "developer";
  throw new PluginManagerError(
    ERROR_CODES.TYPE_MISSING,
    "manifest has no type key",
    {},
  );
}

// CID:manifest-004 - manifestId
// Purpose: returns the plugin id for a validated manifest + type pair
// Used by: install/update/reload lifecycle methods (id never changes via update)
export function manifestId(manifest: PluginManifest, type: PluginType): string {
  return manifest[type]!.id;
}