// Phase 4 — output shaping (S3). Pure renderer tests; consumer wiring
// covered in consumer.test.ts.
import { describe, expect, it } from "vitest";
import { renderTable, renderKeyValue, renderJson } from "../output.js";

const TTY = { json: false, isTTY: true };
const PIPE = { json: false, isTTY: false };
const JSON_FORCED = { json: true, isTTY: true };

describe("output: tables (S3)", () => {
  it("TTY + alias → table with header + rows", () => {
    const out = renderTable(
      ["ID", "STATUS", "CREATED"],
      [["s-1", "active", "1700000000000"], ["s-2", "active", "1699900000000"]],
      TTY,
    );
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/ID\s+STATUS\s+CREATED/);
    expect(lines[1]).toMatch(/s-1\s+active\s+1700000000000/);
  });

  it("empty result set → empty string, no error", () => {
    expect(renderTable(["ID"], [], TTY)).toBe("");
  });

  it("table respects width limit (truncate gracefully)", () => {
    const out = renderTable(
      ["NAME", "DESC"],
      [["gateway.status", "a very long description that exceeds any reasonable terminal width for sure"]],
      { ...TTY, width: 60 },
    );
    expect(out.length).toBeLessThanOrEqual(122);
    expect(out).toContain("…");
  });

  it("piped (non-TTY) alias output is compact JSON — renderJson path, no table", () => {
    // the consumer decides: !isTTY || --json → renderJson, never renderTable
    const out = renderJson([{ id: "s-1", status: "active" }], PIPE);
    expect(out).toBe('[{"id":"s-1","status":"active"}]');
  });
});

describe("output: key:value (S3)", () => {
  it("TTY + status → key:value lines", () => {
    const out = renderKeyValue({ tenants: 1, plugins: 0, uptimeMs: 42000 }, TTY);
    expect(out).toBe("tenants: 1\nplugins: 0\nuptimeMs: 42000");
  });

  it("--json + status → compact JSON", () => {
    const out = renderKeyValue({ tenants: 1, plugins: 0 }, JSON_FORCED);
    expect(out).toBe('{"tenants":1,"plugins":0}');
  });
});

describe("output: JSON shaping (S3)", () => {
  const cap = { name: "gateway.status", version: "1.0.0" };

  it("TTY + invoke → pretty JSON (2-space indent)", () => {
    const out = renderJson(cap, TTY);
    expect(out).toBe('{\n  "name": "gateway.status",\n  "version": "1.0.0"\n}');
  });

  it("non-TTY (pipe) → compact one-line JSON", () => {
    const out = renderJson(cap, PIPE);
    expect(out).toBe('{"name":"gateway.status","version":"1.0.0"}');
    expect(out).not.toContain("\n");
  });

  it("--json flag → compact regardless of TTY", () => {
    const out = renderJson(cap, JSON_FORCED);
    expect(out).toBe('{"name":"gateway.status","version":"1.0.0"}');
  });
});
