// Phase 1: URL port defaulting (consumer.ts → url-default.ts)
// Behavior: ws://host/ws without a port → ws://host:7300/ws.
//           ws://host:7300/ws → unchanged.
//           malformed URL → throws ConfigError (exit 2).
import { describe, expect, it } from "vitest";
import { applyPortDefault } from "../url-default.js";
import { ConfigError } from "../config.js";

describe("applyPortDefault", () => {
  it("inserts :7300 when the URL has no port", () => {
    const out = applyPortDefault("ws://127.0.0.1/ws");
    expect(out).toBe("ws://127.0.0.1:7300/ws");
  });

  it("leaves the URL unchanged when it already has a port", () => {
    expect(applyPortDefault("ws://127.0.0.1:7301/ws")).toBe("ws://127.0.0.1:7301/ws");
    expect(applyPortDefault("ws://127.0.0.1:7350/ws")).toBe("ws://127.0.0.1:7350/ws");
  });

  it("inserts :7300 with a path and query", () => {
    expect(applyPortDefault("ws://localhost/api?x=1")).toBe("ws://localhost:7300/api?x=1");
  });

  it("throws ConfigError on a malformed URL", () => {
    expect(() => applyPortDefault("not a url")).toThrow(ConfigError);
    expect(() => applyPortDefault("not a url")).toThrow(/invalid URL/);
  });

  it("inserts :7300 for an IPv6 host (no port)", () => {
    expect(applyPortDefault("ws://[::1]/ws")).toBe("ws://[::1]:7300/ws");
  });

  it("leaves IPv6 host URL with explicit port unchanged", () => {
    expect(applyPortDefault("ws://[::1]:7301/ws")).toBe("ws://[::1]:7301/ws");
  });
});
