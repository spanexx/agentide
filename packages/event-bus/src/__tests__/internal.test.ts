import { describe, expect, it } from "vitest";
import { createEventBus, publishInternalEvent } from "../index.js";

describe("publishInternalEvent", () => {
  it("delivers reserved events without exposing them to public publish", async () => {
    const bus = createEventBus();
    const names: string[] = [];
    bus.subscribe("event.*", (event) => { names.push(event.name); });
    await publishInternalEvent(bus, "event.connection.rotated", { connectionId: "ws-1" });
    expect(names).toEqual(["event.connection.rotated"]);
    await expect(bus.publish("event.connection.rotated", {})).rejects.toThrow();
  });
});
