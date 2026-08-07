import { describe, expect, it } from "vitest";
import { RecordRegistry } from "../record-registry.js";

interface DummyRecord {
  readonly id: string;
  readonly label: string;
}

const makeRegistry = () =>
  new RecordRegistry<DummyRecord>({
    prefix: "conn",
    create: (id) => ({ id, label: `rec-${id}` }),
  });

describe("RecordRegistry", () => {
  it("add assigns auto-incrementing prefixed ids", () => {
    const reg = makeRegistry();
    expect(reg.add().id).toBe("conn-1");
    expect(reg.add().id).toBe("conn-2");
    expect(reg.count()).toBe(2);
  });

  it("get returns the record or undefined", () => {
    const reg = makeRegistry();
    const rec = reg.add();
    expect(reg.get(rec.id)).toEqual(rec);
    expect(reg.get("nope")).toBeUndefined();
  });

  it("remove deletes and returns the record", () => {
    const reg = makeRegistry();
    const rec = reg.add();
    expect(reg.remove(rec.id)).toEqual(rec);
    expect(reg.count()).toBe(0);
    expect(reg.remove(rec.id)).toBeUndefined();
  });

  it("snapshot returns all records in insertion order", () => {
    const reg = makeRegistry();
    const a = reg.add();
    const b = reg.add();
    expect(reg.snapshot()).toEqual([a, b]);
  });

  it("clear empties the store and returns the prior records", () => {
    const reg = makeRegistry();
    reg.add();
    reg.add();
    const cleared = reg.clear();
    expect(cleared).toHaveLength(2);
    expect(reg.count()).toBe(0);
  });

  it("honors a custom id generator", () => {
    const reg = new RecordRegistry<DummyRecord>({
      prefix: "ws",
      generateId: (n) => `ws-${100 + n}`,
      create: (id) => ({ id, label: id }),
    });
    expect(reg.add().id).toBe("ws-101");
    expect(reg.add().id).toBe("ws-102");
  });

  it("does not reuse ids after removal", () => {
    const reg = makeRegistry();
    reg.add();
    const rec2 = reg.add();
    reg.remove(rec2.id);
    expect(reg.add().id).toBe("conn-3");
  });
});
