/*
 * Code Map: manifest parser tests (Phase 2)
 * - reads valid YAML manifest
 * - reads valid JSON manifest
 * - rejects missing app field
 * - rejects missing capabilities array
 * - rejects capability without name
 * - rejects capability without permissions
 * - rejects capability name without dot
 * - accepts inline manifest object (already-parsed)
 * - rejects capability with empty permissions array
 * - rejects capability with invalid permissions (non-string items)
 */

import { describe, it, expect } from "vitest";
import { parseManifest, validateManifest, type ManifestError } from "../manifest.js";
import type { ParsedManifest } from "../manifest.js";

const VALID_YAML = `
app: customer-app
name: Acme Customer Service
capabilities:
  - name: customer.read
    description: Fetch a customer record
    version: 1.0.0
    permissions:
      - customer.read
  - name: customer.delete
    description: Delete a customer
    version: 1.0.0
    permissions:
      - customer.delete
`;

const VALID_JSON = JSON.stringify({
  app: "billing-app",
  name: "Acme Billing",
  capabilities: [
    {
      name: "invoice.read",
      description: "Read invoice",
      version: "1.0.0",
      permissions: ["invoice.read"],
    },
  ],
});

describe("parseManifest — file/string sources (Phase 2)", () => {
  it("parses a valid YAML manifest", () => {
    const result = parseManifest(VALID_YAML);
    expect(result.app).toBe("customer-app");
    expect(result.capabilities).toHaveLength(2);
    expect(result.capabilities[0]?.name).toBe("customer.read");
    expect(result.capabilities[0]?.permissions).toEqual(["customer.read"]);
  });

  it("parses a valid JSON manifest", () => {
    const result = parseManifest(VALID_JSON);
    expect(result.app).toBe("billing-app");
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]?.name).toBe("invoice.read");
  });

  it("accepts an already-parsed inline manifest", () => {
    const inline = {
      app: "inline-app",
      capabilities: [
        { name: "x.foo", description: "foo", version: "1.0.0", permissions: ["x.foo"] },
      ],
    };
    const result = parseManifest(inline);
    expect(result.app).toBe("inline-app");
    expect(result.capabilities).toHaveLength(1);
  });
});

describe("validateManifest — schema validation (Phase 2)", () => {
  it("accepts a valid manifest", () => {
    const m: ParsedManifest = {
      app: "test",
      capabilities: [
        { name: "x.foo", description: "foo", version: "1.0.0", permissions: ["x.foo"] },
      ],
    };
    expect(() => validateManifest(m)).not.toThrow();
  });

  it("rejects missing app field", () => {
    const m = {
      capabilities: [
        { name: "x.foo", description: "foo", version: "1.0.0", permissions: ["x.foo"] },
      ],
    } as unknown as ParsedManifest;
    expect(() => validateManifest(m)).toThrow(/app/);
  });

  it("rejects missing capabilities array", () => {
    const m = { app: "x" } as unknown as ParsedManifest;
    expect(() => validateManifest(m)).toThrow(/capabilities/);
  });

  it("rejects capability without name", () => {
    const m: ParsedManifest = {
      app: "x",
      capabilities: [
        { name: "", description: "foo", version: "1.0.0", permissions: ["x.foo"] },
      ],
    };
    expect(() => validateManifest(m)).toThrow(/name/);
  });

  it("rejects capability without permissions", () => {
    const m: ParsedManifest = {
      app: "x",
      capabilities: [
        { name: "x.foo", description: "foo", version: "1.0.0", permissions: [] },
      ],
    };
    expect(() => validateManifest(m)).toThrow(/permissions/);
  });

  it("rejects capability name without dot", () => {
    const m: ParsedManifest = {
      app: "x",
      capabilities: [
        { name: "no_dot_here", description: "foo", version: "1.0.0", permissions: ["x.foo"] },
      ],
    };
    expect(() => validateManifest(m)).toThrow(/dot/);
  });

  it("rejects capability with non-string permissions", () => {
    const m: ParsedManifest = {
      app: "x",
      capabilities: [
        { name: "x.foo", description: "foo", version: "1.0.0", permissions: ["x.foo", 42] as readonly string[] },
      ],
    };
    expect(() => validateManifest(m)).toThrow(/permissions/);
  });
});

describe("parseManifest + validateManifest — error reporting (Phase 2)", () => {
  it("returns errors with code + path on validation failure", () => {
    const m: ParsedManifest = {
      app: "x",
      capabilities: [
        { name: "bad", description: "foo", version: "1.0.0", permissions: [] },
      ],
    };
    try {
      validateManifest(m);
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ManifestError;
      expect(e.code).toMatch(/MANIFEST_/);
      expect(e.path).toBeTruthy();
    }
  });
});