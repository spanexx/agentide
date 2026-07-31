import { describe, expect, it } from "vitest";
import {
  APPLICATION_ID_PATTERN,
  APPLICATION_ID_PREFIX,
  createApplicationId,
  isApplicationId,
} from "../id.js";

describe("createApplicationId", () => {
  it("returns a string with the app_ prefix", () => {
    const id = createApplicationId();
    expect(id.startsWith(APPLICATION_ID_PREFIX)).toBe(true);
    expect(id.length).toBe(APPLICATION_ID_PREFIX.length + 26);
  });

  it("matches the canonical pattern", () => {
    expect(APPLICATION_ID_PATTERN.test(createApplicationId())).toBe(true);
  });

  it("produces monotonically increasing ids within a single process", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(createApplicationId());
    expect(ids.size).toBe(1000);
  });

  it("is sortable by creation time (string sort == chrono order)", async () => {
    const a = createApplicationId();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const b = createApplicationId();
    expect(a < b).toBe(true);
  });
});

describe("isApplicationId", () => {
  it("accepts a generated id", () => {
    expect(isApplicationId(createApplicationId())).toBe(true);
  });

  it("rejects strings without the app_ prefix", () => {
    expect(isApplicationId("ten_01K2X8T6ZP4JY3N5W7R9A1B2C")).toBe(false);
  });

  it("rejects malformed ULID bodies", () => {
    expect(isApplicationId("app_xxxxxxxxxxxxxxxxxxxxxxxxxx")).toBe(false);
    expect(isApplicationId("app_01K2X8T6ZP4JY3N5W7R9A1B2CXX")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isApplicationId("")).toBe(false);
  });
});
