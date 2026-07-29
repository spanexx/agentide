import { describe, it, expect } from "vitest";
import { createEventBus } from "@platform/event-bus";
import { createCapabilityRegistry, type CapabilityRecord } from "../index.js";

function cap(
  name: string,
  overrides?: Partial<CapabilityRecord>,
): CapabilityRecord {
  return {
    name,
    version: "1.0.0",
    type: "business",
    description: `cap ${name}`,
    permissions: ["read"],
    owner: "test-app",
    ...overrides,
  };
}

describe("CapabilityRegistry", () => {
  it("createCapabilityRegistry returns an object with register, list, search, describe", () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.list).toBe("function");
    expect(typeof registry.search).toBe("function");
    expect(typeof registry.describe).toBe("function");
  });

  it("register adds capabilities and list returns them", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    expect(result.added).toHaveLength(2);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    const cards = registry.list();
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe("order.create");
    expect(cards[1].name).toBe("order.read");
  });

  it("register replaces same owner's previous list", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.read"), cap("order.delete")],
    });
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.update", { version: "2.0.0" })],
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0].name).toBe("order.update");
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(2);
    expect(result.removed.map((r) => r.name).sort()).toEqual(["order.delete", "order.read"]);
    const cards = registry.list();
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.name).sort()).toEqual(["order.create", "order.update"]);
  });

  it("empty capabilities array clears owner's list", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [],
    });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(2);
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects cross-owner clash", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app-a", {
      owner: "app-a",
      capabilities: [cap("customer.read")],
    });
    await expect(
      registry.register("app-b", {
        owner: "app-b",
        capabilities: [cap("customer.read")],
      }),
    ).rejects.toThrow(/clash/i);
    const cards = registry.list();
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("customer.read");
  });

  it("rejects owner mismatch between param and manifest", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await expect(
      registry.register("owner-a", {
        owner: "owner-b",
        capabilities: [cap("good.one")],
      }),
    ).rejects.toThrow(/owner mismatch/i);
  });

  it("rejects name without dot", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [cap("nodot")],
      }),
    ).rejects.toThrow(/name/i);
  });

  it("rejects permissions that are not string arrays", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const withInvalid = cap("good.one");
    (withInvalid as { permissions: unknown }).permissions = [123];
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [withInvalid],
      }),
    ).rejects.toThrow(/permissions/i);
  });

  it("rejects invalid capabilities", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const valid = cap("good.one");

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, name: "" }],
      }),
    ).rejects.toThrow(/name/i);

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, version: "" }],
      }),
    ).rejects.toThrow(/version/i);

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, type: "invalid" as never }],
      }),
    ).rejects.toThrow(/type/i);

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, description: "" }],
      }),
    ).rejects.toThrow(/description/i);

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, inputSchema: null as never }],
      }),
    ).rejects.toThrow(/inputSchema/i);

    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...valid, outputSchema: "not-object" as never }],
      }),
    ).rejects.toThrow(/outputSchema/i);

    const cards = registry.list();
    expect(cards).toHaveLength(0);
  });

  it("search matches name and description case-insensitively", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app", {
      owner: "app",
      capabilities: [
        cap("customer.read", { description: "View customer details" }),
        cap("order.create", { description: "Create new orders" }),
        cap("billing.pay", { description: "Process payments" }),
      ],
    });
    expect(registry.search("customer")).toHaveLength(1);
    expect(registry.search("Customer")).toHaveLength(1);
    expect(registry.search("order")).toHaveLength(1);
    expect(registry.search("pay")).toHaveLength(1);
    expect(registry.search("")).toHaveLength(0);
    expect(registry.search("nonexistent")).toHaveLength(0);
  });

  it("search returns results in registration order", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app", {
      owner: "app",
      capabilities: [
        cap("alpha.one", { description: "first" }),
        cap("beta.two", { description: "second" }),
        cap("gamma.three", { description: "third" }),
      ],
    });
    const results = registry.search("");
    expect(results).toHaveLength(0);
    const all = registry.search("a");
    expect(all.map((c) => c.description)).toEqual(["first", "second", "third"]);
  });

  it("describe returns exact version", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app", {
      owner: "app",
      capabilities: [cap("customer.read", { version: "1.0.0" })],
    });
    const result = registry.describe("customer.read", "1.0.0");
    expect(result.capability).not.toBeNull();
    expect(result.capability!.name).toBe("customer.read");
    expect(result.selectedVersion).toBe("1.0.0");
    const missing = registry.describe("customer.read", "9.9.9");
    expect(missing.capability).toBeNull();
  });

  it("describe without version returns single version", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app", {
      owner: "app",
      capabilities: [
        cap("customer.read", { version: "1.0.0" }),
        cap("order.create", { version: "2.0.0" }),
      ],
    });
    const result = registry.describe("customer.read");
    expect(result.capability).not.toBeNull();
    expect(result.selectedVersion).toBe("1.0.0");
  });

  it("describe without version returns latest when multiple versions exist", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("app", {
      owner: "app",
      capabilities: [
        cap("customer.read", { version: "1.0.0" }),
        cap("customer.read", { version: "2.0.0" }),
        cap("customer.read", { version: "1.5.0" }),
      ],
    });
    const result = registry.describe("customer.read");
    expect(result.capability).not.toBeNull();
    expect(result.selectedVersion).toBe("2.0.0");
    expect(result.note).toContain("2.0.0");
  });

  it("describe with no match returns null", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const result = registry.describe("nonexistent");
    expect(result.capability).toBeNull();
    expect(result.selectedVersion).toBeNull();
  });

  it("list returns a new array each call", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    expect(registry.list()).not.toBe(registry.list());
  });

  it("describe returns a copy not internal reference", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    const r1 = registry.describe("order.create", "1.0.0");
    const r2 = registry.describe("order.create", "1.0.0");
    expect(r1.capability).not.toBeNull();
    expect(r1.capability).not.toBe(r2.capability);
  });

  it("publishes capability.registered for added records", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const events: Array<{ name: string; payload: object }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name, payload: e.payload });
    });
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("capability.registered");
  });

  it("publishes capability.removed for dropped records", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    const events: Array<{ name: string; payload: object }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name, payload: e.payload });
    });
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("capability.removed");
  });

  it("publishes capability.updated with previous and current", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create", { description: "original" })],
    });
    const events: Array<{ name: string; payload: object }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name, payload: e.payload });
    });
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create", { description: "updated desc" })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("capability.updated");
    const payload = events[0].payload as { previous: CapabilityRecord; current: CapabilityRecord };
    expect(payload.previous.description).toBe("original");
    expect(payload.current.description).toBe("updated desc");
  });

  it("publishes events interleaved in manifest order", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("keep.me", { description: "same" }),
        cap("update.me", { description: "old" }),
        cap("remove.me"),
      ],
    });
    const events: Array<{ name: string }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name });
    });
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("keep.me", { description: "same" }),
        cap("add.me"),
        cap("update.me", { description: "new value" }),
      ],
    });
    expect(events[0].name).toBe("capability.registered");
    expect(events[1].name).toBe("capability.updated");
    expect(events[2].name).toBe("capability.removed");
  });

  it("does not publish events for unchanged records", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    const events: Array<{ name: string }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name });
    });
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    expect(events).toHaveLength(0);
  });

  it("does not publish events on failed register", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const events: Array<{ name: string }> = [];
    bus.subscribe<object>("capability.*", (e) => {
      events.push({ name: e.name });
    });
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [{ ...cap("bad"), name: "" }],
      }),
    ).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  it("removeByOwner returns and clears every cap owned by the owner", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("acme", {
      owner: "acme",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    await registry.register("other", {
      owner: "other",
      capabilities: [cap("payment.charge")],
    });
    const removed = await registry.removeByOwner("acme");
    expect(removed.map((r) => r.name).sort()).toEqual(["order.create", "order.read"]);
    // acme caps are gone; other's remain
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.name).toBe("payment.charge");
  });

  it("removeByOwner is idempotent — second call returns empty", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("acme", { owner: "acme", capabilities: [cap("a.b")] });
    const first = await registry.removeByOwner("acme");
    const second = await registry.removeByOwner("acme");
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("removeByOwner emits capability.removed per dropped record", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("acme", {
      owner: "acme",
      capabilities: [cap("order.create"), cap("order.read")],
    });
    const events: Array<{ name: string; payload: { capability: { name: string } } }> = [];
    bus.subscribe<{ capability: { name: string } }>("capability.removed", (e) => {
      events.push({ name: e.name, payload: e.payload });
    });
    await registry.removeByOwner("acme");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload.capability.name).sort()).toEqual([
      "order.create",
      "order.read",
    ]);
  });
});
