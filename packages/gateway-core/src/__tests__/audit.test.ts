import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { AuditWriter, nodeFileSystem } from "../index.js";
import type { AuditRecord, FileSystem } from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }
  // Mirrors fs.promises.appendFile (append, not overwrite). For tests of an
  // append-only writer, this matters: a real fs.appendFile accumulates; an
  // overwriting writeFile would lose prior records.
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    schemaVersion: 1,
    ts: 1700000000000,
    tenantId: "acme",
    caller: { id: "agent-1", scope: ["customer.read"] },
    capability: { name: "customer.read", version: "1.0.0" },
    owner: "backend-sdk-acme",
    status: "ok",
    durationMs: 12,
    ...overrides,
  };
}

describe("AuditWriter", () => {
  it("appends one valid JSON line per record", async () => {
    const fs = new InMemoryFs();
    const writer = new AuditWriter("/data/audit.log", fs);
    await writer.append(record());
    const written = fs.files.get("/data/audit.log") ?? "";
    expect(written.endsWith("\n")).toBe(true);
    const lines = written.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      schemaVersion: 1,
      ts: 1700000000000,
      caller: { id: "agent-1", scope: ["customer.read"] },
      capability: { name: "customer.read", version: "1.0.0" },
      owner: "backend-sdk-acme",
      status: "ok",
      durationMs: 12,
    });
  });

  it("round-trips records: write + read yields the same shape", async () => {
    const fs = new InMemoryFs();
    const writer = new AuditWriter("/data/audit.log", fs);
    const original = record({ durationMs: 42, errorCode: "GATEWAY_HANDLER_TIMEOUT" });
    await writer.append(original);
    const written = fs.files.get("/data/audit.log") ?? "";
    const parsed = JSON.parse(written.trimEnd()) as AuditRecord;
    expect(parsed).toEqual(original);
  });

  it("appends multiple records as newline-delimited JSON (one line per record)", async () => {
    const fs = new InMemoryFs();
    const writer = new AuditWriter("/data/audit.log", fs);
    await writer.append(record({ ts: 1 }));
    await writer.append(record({ ts: 2 }));
    await writer.append(record({ ts: 3 }));
    const written = fs.files.get("/data/audit.log") ?? "";
    const lines = written.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as AuditRecord);
    expect(parsed.map((r) => r.ts)).toEqual([1, 2, 3]);
  });

  it("does not throw on file write failure (best-effort, logs to stderr)", async () => {
    const fs: FileSystem = {
      readFile: async () => "",
      writeFile: async () => { throw new Error("disk full"); },
      exists: async () => true,
    };
    const writer = new AuditWriter("/data/audit.log", fs);
    // Capture console.warn to verify it's invoked.
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      await writer.append(record());
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0][0]).toMatch(/audit/i);
  });

  it("creates the file if it does not exist", async () => {
    const fs = new InMemoryFs();
    const writer = new AuditWriter("/data/new-audit.log", fs);
    expect(fs.files.has("/data/new-audit.log")).toBe(false);
    await writer.append(record());
    expect(fs.files.has("/data/new-audit.log")).toBe(true);
  });

  it("nodeFileSystem writeFile APPENDS without mode (D-128 — CLI fs must not truncate)", async () => {
    const fs = nodeFileSystem();
    const path = join(tmpdir(), `audit-d128-${process.pid}.log`);
    try {
      await fs.writeFile(path, "line1\n");
      await fs.writeFile(path, "line2\n");
      const written = await fs.readFile(path);
      expect(written.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("nodeFileSystem writeFile WRITES (not appends) when mode is set (secrets)", async () => {
    const fs = nodeFileSystem();
    const path = join(tmpdir(), `secret-d128-${process.pid}.log`);
    try {
      await fs.writeFile(path, "secret-a", 0o600);
      await fs.writeFile(path, "secret-b", 0o600);
      const written = await fs.readFile(path);
      expect(written).toBe("secret-b"); // replaced, not appended
    } finally {
      await rm(path, { force: true });
    }
  });
});