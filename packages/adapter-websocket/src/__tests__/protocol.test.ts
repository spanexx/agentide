import { describe, expect, it } from "vitest";
import { parseClientFrame } from "../protocol.js";

describe("client frame parser", () => {
  it("parses the four client frame families", () => {
    expect(parseClientFrame({ type: "auth", token: "jwt" })).toEqual({ type: "auth", token: "jwt" });
    expect(parseClientFrame({ type: "subscribe", topics: ["session.*"] })).toEqual({ type: "subscribe", topics: ["session.*"] });
    expect(parseClientFrame({ type: "unsubscribe", topics: ["session.*"] })).toEqual({ type: "unsubscribe", topics: ["session.*"] });
    expect(parseClientFrame({ type: "invoke", correlationId: "c1", name: "system.health" })).toEqual({
      type: "invoke",
      correlationId: "c1",
      name: "system.health",
    });
  });
});
