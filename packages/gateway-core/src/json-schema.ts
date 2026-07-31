/*
 * Code Map: hand-rolled JSON Schema validator (v1 subset)
 * - validateJsonSchema: validates a value against a JSON Schema object
 * - Supports: type (string/number/boolean/object/array/null/integer), required,
 *   properties, additionalProperties, items, enum, const
 * - Returns either { ok: true } or { ok: false, errors: ValidationIssue[] }
 *
 * Used by: handleInvocation pipeline (input + output schema enforcement)
 * Subset chosen to cover the schemas platform caps actually declare; full
 * Ajv integration deferred until a cap needs a richer feature.
 *
 * CID Index:
 * CID:schema-001 -> validateJsonSchema
 * CID:schema-002 -> ValidationIssue
 *
 * Quick lookup: rg -n "CID:schema-" packages/gateway-core/src/json-schema.ts
 */

import type { YamlValue } from "./types.js";

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

// CID:schema-002 - ValidationIssue
// Purpose: structured per-field failure; consumed by handleInvocation to build GATEWAY_INVALID_REQUEST responses

function jsonTypeOf(value: YamlValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeMatches(value: YamlValue, expected: string): boolean {
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "number") return typeof value === "number";
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return jsonTypeOf(value) === expected;
}

// CID:schema-001 - validateJsonSchema
// Purpose: validate one value against one JSON Schema (subset)
// Returns: { ok: true } on success; { ok: false, errors } with per-field messages on failure
// Side effects: none (pure)
// Used by: handleInvocation input/output schema enforcement
export function validateJsonSchema(value: YamlValue, schema: Readonly<object>, path = "$"): ValidationResult {
  const s = schema as Record<string, YamlValue>;
  const errors: ValidationIssue[] = [];

  if (typeof s.type === "string") {
    if (!typeMatches(value, s.type)) {
      errors.push({ path, message: `expected type ${s.type}, got ${jsonTypeOf(value)}` });
    }
  }

  if (Array.isArray(s.enum)) {
    if (!s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push({ path, message: `value not in enum` });
    }
  }

  if (s.const !== undefined) {
    if (JSON.stringify(s.const) !== JSON.stringify(value)) {
      errors.push({ path, message: `value does not match const` });
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, YamlValue>;
    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key !== "string") continue;
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: `missing required property` });
        }
      }
    }
    if (s.properties !== undefined && typeof s.properties === "object" && s.properties !== null) {
      const props = s.properties as Record<string, Readonly<object>>;
      for (const [k, childSchema] of Object.entries(props)) {
        if (k in obj) {
          const sub = validateJsonSchema(obj[k] as YamlValue, childSchema, `${path}.${k}`);
          if (!sub.ok) errors.push(...sub.errors);
        }
      }
    }
    if (s.additionalProperties === false) {
      const propsRecord = s.properties !== undefined && typeof s.properties === "object" && s.properties !== null
        ? (s.properties as Record<string, Readonly<object>>)
        : ({} as Record<string, Readonly<object>>);
      const allowed = new Set(Object.keys(propsRecord));
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          errors.push({ path: `${path}.${k}`, message: `unknown property` });
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (s.items !== undefined && typeof s.items === "object" && s.items !== null) {
      const itemSchema = s.items as Readonly<object>;
      value.forEach((item, i) => {
        const sub = validateJsonSchema(item, itemSchema, `${path}[${i}]`);
        if (!sub.ok) errors.push(...sub.errors);
      });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
