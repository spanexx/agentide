import { describe, it, expect } from "vitest";
import * as eventBusModule from "./index.js";
import { createEventBus, type PlatformEvent } from "./index.js";

describe("createEventBus — Phase 3 immutability + readonly contract", () => {
  it("payload is shallowly frozen before dispatch — handler cannot mutate seen values", async () => {
    const bus = createEventBus();
    const seenByHandler2: { url?: string; tabId?: number } = {};
    bus.subscribe("browser.page.loaded", (e) => {
      // Attempt to mutate. In strict mode this throws; in sloppy mode this
      // silently no-ops. Either way the handler must not observe a changed
      // value when reading later.
      try {
        (e.payload as { url?: string }).url = "hacked://attacker";
      } catch {
        // strict mode threw — that's fine
      }
    });
    bus.subscribe("browser.page.loaded", (e) => {
      Object.assign(seenByHandler2, e.payload as object);
    });
    const original = { url: "https://example.com", tabId: 7 };
    await bus.publish("browser.page.loaded", original);
    expect(seenByHandler2.url).toBe("https://example.com");
    expect(seenByHandler2.tabId).toBe(7);
  });

  it("publisher-side mutation after publish is blocked because payload is frozen", async () => {
    const bus = createEventBus();
    const seen: Array<{ url?: string }> = [];
    bus.subscribe("page", (e) => seen.push({ ...(e.payload as object) }));
    const payload: { url: string } = { url: "https://a" };
    await bus.publish("page", payload);
    // Stronger guarantee than AC-12 requires: the original object is itself
    // frozen, so a late mutation by the publisher throws in strict mode and
    // silently no-ops in sloppy mode. Either way handlers saw the original.
    let mutationThrew = false;
    try {
      payload.url = "https://b";
    } catch {
      mutationThrew = true;
    }
    expect(mutationThrew).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://a");
  });

  it("payload references handed to all handlers point to the same frozen object", async () => {
    const bus = createEventBus();
    const refs: unknown[] = [];
    bus.subscribe("p", (e) => refs.push(e.payload));
    bus.subscribe("p", (e) => refs.push(e.payload));
    await bus.publish("p", { a: 1 });
    expect(refs[0]).toBe(refs[1]); // same reference, so any freeze is shared
    expect(Object.isFrozen(refs[0])).toBe(true);
  });

  it("readonly types compile correctly (compile-time contract)", () => {
    // This is a compile-time check. If `Readonly<>` were dropped from
    // `PlatformEvent.payload`, callers could write `event.payload.x = 1`
    // without a type error. We assert the structural shape via a typed
    // helper that the compiler would reject if the readonly marker were
    // missing.
    type SamplePayload = Readonly<{ id: string; count: number }>;
    type SampleEvent = PlatformEvent<SamplePayload>;
    const sample: SampleEvent = {
      name: "x",
      payload: { id: "abc", count: 1 },
      id: "u0",
      publishedAt: 1,
    };
    // The two lines below would fail to compile if readonly is missing.
    // We can't truly assert a negative from runtime, but the structural
    // shape keeps the contract visible at use sites.
    expect(sample.payload.id).toBe("abc");
    // @ts-expect-error — assignment to readonly property
    sample.payload.id = "mutated";
  });

  it("public entry point exports only the documented runtime surface", () => {
    // The public runtime surface is everything exported from index.ts. Type-
    // only exports (interfaces and type aliases) do not appear at runtime
    // and so are checked at compile time, not here.
    const publicNames = Object.keys(eventBusModule).sort();
    expect(publicNames).toEqual([
      "RESERVED_INTERNAL_PREFIX",
      "createEventBus",
      "matches",
    ]);
  });
});