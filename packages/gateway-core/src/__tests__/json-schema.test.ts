import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../json-schema.js";

describe("validateJsonSchema (subset)", () => {
  it("accepts a value matching its declared type", () => {
    expect(validateJsonSchema("hello", { type: "string" }).ok).toBe(true);
    expect(validateJsonSchema(42, { type: "integer" }).ok).toBe(true);
    expect(validateJsonSchema({ a: 1 }, { type: "object" }).ok).toBe(true);
  });

  it("rejects a value with the wrong type", () => {
    const r = validateJsonSchema("hello", { type: "number" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toMatch(/expected type number/);
  });

  it("enforces required properties", () => {
    const r = validateJsonSchema({ a: 1 }, { type: "object", required: ["a", "b"], properties: { a: {}, b: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === "$.b")).toBe(true);
  });

  it("rejects unknown properties when additionalProperties=false", () => {
    const r = validateJsonSchema({ a: 1, b: 2 }, { type: "object", properties: { a: {} }, additionalProperties: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === "$.b" && e.message.includes("unknown"))).toBe(true);
  });

  it("validates array items", () => {
    const r = validateJsonSchema([1, "two"], { type: "array", items: { type: "integer" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === "$[1]")).toBe(true);
  });

  it("enforces enum", () => {
    expect(validateJsonSchema("a", { enum: ["a", "b", "c"] }).ok).toBe(true);
    expect(validateJsonSchema("d", { enum: ["a", "b", "c"] }).ok).toBe(false);
  });

  it("handles nested object schemas", () => {
    const schema = {
      type: "object",
      properties: {
        address: { type: "object", properties: { zip: { type: "string" } }, required: ["zip"] },
      },
      required: ["address"],
    };
    expect(validateJsonSchema({ address: { zip: "12345" } }, schema).ok).toBe(true);
    const bad = validateJsonSchema({ address: { zip: 12345 } }, schema);
    expect(bad.ok).toBe(false);
  });
});
