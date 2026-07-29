/*
 * Code Map: register() implementation (Phase 4)
 *
 * Reads the manifest (from path or inline), validates it, matches each
 * capability to a handler, and sends a `sdk.capability.register` message
 * to the Gateway for each match.
 *
 * Errors:
 *   - Manifest fails validation → throws with manifest error code
 *   - Capability has no matching handler → throws with the missing name
 *
 * On success:
 *   - Each capability registered with the Gateway
 *   - Phase transitions to 'registered'
 *
 * Bus events emitted (Phase 6 wires these to @platform/event-bus):
 *   - sdk.capability.registered  per capability
 */

import { type Handler } from "./types.js";
import {
  type ParsedManifest,
  type ManifestCapability,
  type ManifestValue,
  parseManifest,
  validateManifest,
  loadManifestFromFile,
} from "./manifest.js";

/** Input shapes for resolveManifest — anything the developer might pass. */
export type ManifestInput = string | Record<string, ManifestValue> | ParsedManifest;

export interface RegisterInput {
  readonly manifest: string | Record<string, ManifestValue>;
  readonly handlers: string | Record<string, Handler>;
}

export interface RegisteredCapability {
  readonly cap: ManifestCapability;
  readonly handler: Handler;
}

/**
 * Resolve a manifest from its source (path string or inline object).
 * Loads from disk if a path, parses inline if an object, then validates.
 */
export async function resolveManifest(source: ManifestInput): Promise<ParsedManifest> {
  let parsed: ParsedManifest;
  if (typeof source === "string") {
    // Path → load from disk (which also parses + validates)
    parsed = await loadManifestFromFile(source);
  } else {
    parsed = parseManifest(source);
    validateManifest(parsed);
  }
  return parsed;
}

/**
 * Resolve handlers from their source (module path or inline map).
 * Inline maps are returned as-is; module paths use dynamic import.
 */
export async function resolveHandlers(
  source: string | Record<string, Handler>,
): Promise<Record<string, Handler>> {
  if (typeof source === "string") {
    // Dynamic import the module. The module should export handlers by
    // capability name. We accept either a default export that's a map, or
    // named exports that match capability names.
    const mod = (await import(source)) as Record<string, Handler> | { default: Record<string, Handler> };
    if ("default" in mod && typeof mod.default === "object" && mod.default !== null) {
      return mod.default;
    }
    return mod as Record<string, Handler>;
  }
  return source;
}

/**
 * Match each manifest capability against the handler map.
 * Throws on the first capability that has no matching handler.
 */
export function matchCapabilities(
  manifest: ParsedManifest,
  handlers: Record<string, Handler>,
): readonly RegisteredCapability[] {
  const matched: RegisteredCapability[] = [];
  for (const cap of manifest.capabilities) {
    const handler = handlers[cap.name];
    if (handler === undefined) {
      throw new Error(
        `register: capability '${cap.name}' declared in manifest but no handler found ` +
        `(handlers: ${Object.keys(handlers).join(", ")})`,
      );
    }
    matched.push({ cap, handler });
  }
  return matched;
}