/*
 * Code Map: capability-registry tier validation tests
 * - tier field type definition
 * - runtime cap with no tier → TIER_REQUIRED
 * - runtime cap with invalid tier (e.g. "write") → INVALID_TIER_FOR_RUNTIME
 * - business cap with tier set → INVALID_TIER_FOR_TYPE
 * - platform cap without tier → derived from permissions[0] last segment
 * - platform cap with explicit tier → respected
 * - business cap with no tier → null (allowed)
 */
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

describe("CapabilityRegistry — tier validation", () => {
  it("runtime cap without tier is rejected", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [
          cap("browser.foo", {
            type: "runtime",
            permissions: ["runtime.browser.act"],
          }),
        ],
      }),
    ).rejects.toThrow(/tier/i);
  });

  it("runtime cap with invalid tier ('write') is rejected", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [
          cap("browser.foo", {
            type: "runtime",
            permissions: ["runtime.browser.write"],
            tier: "write",
          }),
        ],
      }),
    ).rejects.toThrow(/tier/i);
  });

  it("runtime cap with valid tier ('act') is accepted", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("browser.foo", {
          type: "runtime",
          permissions: ["runtime.browser.act"],
          tier: "act",
        }),
      ],
    });
    expect(result.added).toHaveLength(1);
  });

  it("business cap with tier set is rejected", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await expect(
      registry.register("test-app", {
        owner: "test-app",
        capabilities: [
          cap("order.create", {
            type: "business",
            tier: "read",
          }),
        ],
      }),
    ).rejects.toThrow(/tier/i);
  });

  it("business cap with no tier is accepted (tier=null)", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [cap("order.create")],
    });
    expect(result.added).toHaveLength(1);
  });

  it("platform cap without tier derives from permissions[0] last segment", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    const result = await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("session.read", {
          type: "platform",
          permissions: ["platform.session.read"],
        }),
      ],
    });
    expect(result.added).toHaveLength(1);
    const card = registry.list().find((c) => c.name === "session.read");
    expect(card?.tier).toBe("read");
  });

  it("platform cap with explicit tier is respected", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("session.write", {
          type: "platform",
          permissions: ["platform.session.write"],
          tier: "write",
        }),
      ],
    });
    const card = registry.list().find((c) => c.name === "session.write");
    expect(card?.tier).toBe("write");
  });

  it("CapabilityCard includes tier field in list output", async () => {
    const bus = createEventBus();
    const registry = createCapabilityRegistry(bus);
    await registry.register("test-app", {
      owner: "test-app",
      capabilities: [
        cap("browser.foo", {
          type: "runtime",
          permissions: ["runtime.browser.act"],
          tier: "act",
        }),
      ],
    });
    const card = registry.list().find((c) => c.name === "browser.foo");
    expect(card).toBeDefined();
    expect(card).toHaveProperty("tier");
    expect(card?.tier).toBe("act");
  });
});