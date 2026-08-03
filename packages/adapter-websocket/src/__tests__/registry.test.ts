import { describe, expect, it } from "vitest";
import { ConnectionRegistry } from "../registry.js";

function socket(): object {
  return {};
}

describe("ConnectionRegistry", () => {
  it("assigns stable connection ids and supports snapshot lookup", () => {
    const registry = new ConnectionRegistry();
    const first = registry.add(socket() as never, undefined);
    const second = registry.add(socket() as never, "https://app.acme.com");
    expect(first.id).toBe("ws-1");
    expect(second.id).toBe("ws-2");
    expect(registry.get(first.id)).toBe(first);
    expect(registry.snapshot()).toEqual([first, second]);
    expect(registry.count()).toBe(2);
  });
});
