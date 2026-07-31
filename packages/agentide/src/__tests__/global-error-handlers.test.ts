import { describe, expect, it } from "vitest";
import { installGlobalErrorHandlers } from "../index.js";

describe("installGlobalErrorHandlers", () => {
  it("registers handlers that route through the provided sink", async () => {
    const lines: string[] = [];
    const sink = (line: string): void => {
      lines.push(line);
    };
    installGlobalErrorHandlers(sink);
    process.emit("uncaughtException", new Error("synthetic-boom"));
    Promise.reject(new Error("synthetic-rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lines.some((l) => l.includes("synthetic-boom"))).toBe(true);
    expect(lines.some((l) => l.includes("synthetic-rejection"))).toBe(true);
  });

  it("is idempotent — calling twice does not add a second listener", () => {
    const before = process.listeners("uncaughtException").length;
    installGlobalErrorHandlers();
    installGlobalErrorHandlers();
    const after = process.listeners("uncaughtException").length;
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
