/*
 * Code Map: audit log writer
 * - AuditWriter: appends one JSON line per invocation; file write failure is best-effort (logged to stderr)
 *
 * CID Index:
 * CID:audit-001 -> AuditWriter
 *
 * Quick lookup: rg -n "CID:audit-" packages/gateway-core/src/audit.ts
 */

import type { AuditRecord, FileSystem } from "./types.js";

// CID:audit-001 - AuditWriter
// Purpose: durable, append-only JSON-lines writer for the audit log; one line per invocation; failure is best-effort (logged to stderr, does NOT throw)
// Used by: handleInvocation pipeline (every exit path)
// Used in tests by: in-memory FileSystem fake; production uses node:fs via fs.promises.appendFile
export class AuditWriter {
  constructor(
    private readonly auditLogPath: string,
    private readonly fs: FileSystem,
  ) {}

  async append(record: AuditRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    try {
      // FileSystem.writeFile is APPEND-only (per the interface contract in types.ts). The production
      // filesystem uses node:fs/promises.appendFile. This guarantees the audit log never loses
      // history due to a stray overwrite.
      await this.fs.writeFile(this.auditLogPath, line);
    } catch (err) {
      console.warn(
        `[gateway-core] failed to append audit record to ${this.auditLogPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}