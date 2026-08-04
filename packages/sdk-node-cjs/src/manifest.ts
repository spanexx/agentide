/*
 * Code Map: manifest parser + validator (Phase 2)
 *
 * Two-stage pipeline:
 *   1. parseManifest(source) — turns a string or object into a ParsedManifest
 *      by detecting format (YAML vs JSON vs inline) and parsing.
 *   2. validateManifest(manifest) — checks the parsed shape against the
 *      schema documented in PRD-TRD §Data Models.
 *
 * Validation errors carry a code + path so handlers can render meaningful
 * messages and so the SDK can surface them in events.
 *
 * File I/O (reading manifest.yaml from disk) is Phase 2's other deliverable;
 * see loadManifestFromFile().
 */

import { parse as parseYaml } from "yaml";

/** A capability declaration as it appears in a manifest. */
export interface ManifestCapability {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly permissions: readonly string[];
  readonly tier?: string;
  readonly inputSchema?: Record<string, string | number | boolean>;
  readonly outputSchema?: Record<string, string | number | boolean>;
}

/** A parsed manifest, after YAML/JSON parsing, before validation. */
export interface ParsedManifest {
  readonly app: string;
  readonly name?: string;
  readonly capabilities: readonly ManifestCapability[];
}

/** Structured error from manifest validation. */
export interface ManifestError extends Error {
  readonly code: string;
  readonly path: string;
}

const CAPABILITY_NAME_REGEX = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i;

function makeError(code: string, path: string, message: string): ManifestError {
  const err = new Error(message) as ManifestError;
  Object.assign(err, { code, path });
  return err;
}

/** A primitive value type used in inline manifests and meta fields.
 *  Avoids `unknown` per project banned-types rule.
 */
export type ManifestPrimitive = string | number | boolean | null;
export type ManifestValue =
  | ManifestPrimitive
  | readonly ManifestValue[]
  | { readonly [key: string]: ManifestValue };

/**
 * Detect format and parse a manifest source.
 *
 * @param source - YAML/JSON string OR inline object
 * @returns ParsedManifest (not yet validated)
 */
export function parseManifest(source: string | ManifestValue | ParsedManifest): ParsedManifest {
  if (typeof source === "object" && source !== null) {
    return source as ParsedManifest;
  }
  if (typeof source !== "string") {
    throw makeError("MANIFEST_INVALID_TYPE", "$", "manifest source must be a string or object");
  }

  const trimmed = source.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(source) as ParsedManifest;
    } catch (err) {
      throw makeError("MANIFEST_INVALID_JSON", "$", `invalid JSON: ${(err as Error).message}`);
    }
  }
  try {
    return parseYaml(source) as ParsedManifest;
  } catch (err) {
    throw makeError("MANIFEST_INVALID_YAML", "$", `invalid YAML: ${(err as Error).message}`);
  }
}

/**
 * Validate a parsed manifest against the schema.
 *
 * Throws ManifestError on any structural problem.
 */
export function validateManifest(m: ParsedManifest): void {
  if (!m || typeof m !== "object") {
    throw makeError("MANIFEST_NOT_OBJECT", "$", "manifest must be an object");
  }
  if (typeof m.app !== "string" || m.app.length === 0) {
    throw makeError("MANIFEST_MISSING_APP", "$.app", "manifest.app is required (non-empty string)");
  }
  if (!Array.isArray(m.capabilities)) {
    throw makeError("MANIFEST_MISSING_CAPABILITIES", "$.capabilities", "manifest.capabilities must be an array");
  }
  if (m.capabilities.length === 0) {
    throw makeError("MANIFEST_EMPTY_CAPABILITIES", "$.capabilities", "manifest.capabilities must contain at least one capability");
  }

  m.capabilities.forEach((cap, i) => {
    const p = `$.capabilities[${i}]`;
    if (!cap || typeof cap !== "object") {
      throw makeError("MANIFEST_INVALID_CAPABILITY", p, `capability[${i}] must be an object`);
    }
    if (typeof cap.name !== "string" || cap.name.length === 0) {
      throw makeError("MANIFEST_MISSING_NAME", `${p}.name`, `capability[${i}].name is required (non-empty string)`);
    }
    if (!CAPABILITY_NAME_REGEX.test(cap.name)) {
      throw makeError(
        "MANIFEST_INVALID_NAME",
        `${p}.name`,
        `capability[${i}].name '${cap.name}' must match <domain>.<action> (letters, digits, underscore)`,
      );
    }
    if (typeof cap.description !== "string" || cap.description.length === 0) {
      throw makeError(
        "MANIFEST_MISSING_DESCRIPTION",
        `${p}.description`,
        `capability[${i}].description is required (non-empty string)`,
      );
    }
    if (typeof cap.version !== "string" || cap.version.length === 0) {
      throw makeError(
        "MANIFEST_MISSING_VERSION",
        `${p}.version`,
        `capability[${i}].version is required (semver string)`,
      );
    }
    if (!Array.isArray(cap.permissions)) {
      throw makeError(
        "MANIFEST_MISSING_PERMISSIONS",
        `${p}.permissions`,
        `capability[${i}].permissions must be an array`,
      );
    }
    if (cap.permissions.length === 0) {
      throw makeError(
        "MANIFEST_EMPTY_PERMISSIONS",
        `${p}.permissions`,
        `capability[${i}].permissions must contain at least one permission`,
      );
    }
    for (let j = 0; j < cap.permissions.length; j++) {
      if (typeof cap.permissions[j] !== "string") {
        throw makeError(
          "MANIFEST_INVALID_PERMISSION",
          `${p}.permissions[${j}]`,
          `capability[${i}].permissions[${j}] must be a string`,
        );
      }
    }
  });
}

/**
 * Load a manifest from a file path. Parses YAML or JSON based on extension.
 *
 * Phase 2's I/O entry point. The SDK's register() will call this.
 */
export async function loadManifestFromFile(path: string): Promise<ParsedManifest> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  const parsed = parseManifest(raw);
  validateManifest(parsed);
  return parsed;
}