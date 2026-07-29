/*
 * Code Map: sdk-node public API tests (Phase 1)
 * - createSdk returns an SdkInstance with all methods
 * - SdkConfig has gateway, app, manifest, handlers, observability fields
 * - HandlerContext is constructible with required fields
 * - createSdk accepts a minimal config and returns a typed instance
 *
 * Phase 1 is just the skeleton — full behavior comes in later phases.
 * These tests verify the public surface exists and is type-correct.
 */

import { describe, it, expect } from "vitest";
import { createSdk, type SdkInstance, type SdkConfig } from "../index.js";
import type { Handler, HandlerContext } from "../types.js";

describe("createSdk — public API surface (Phase 1)", () => {
  it("returns an SdkInstance when given a valid config", () => {
    const sdk: SdkInstance = createSdk({
      gateway: { url: "ws://localhost:7777", token: "dev-token" },
      app: { id: "test-app", name: "Test App" },
      manifest: "./manifest.yaml",
      handlers: "./dist/handlers",
    });

    expect(sdk).toBeDefined();
    expect(typeof sdk.connect).toBe("function");
    expect(typeof sdk.register).toBe("function");
    expect(typeof sdk.disconnect).toBe("function");
    expect(typeof sdk.invoke).toBe("function");
    expect(typeof sdk.reset).toBe("function");
    expect(typeof sdk.state).toBe("function");
  });

  it("initial state is phase=init, capabilities={}", () => {
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7777", token: "dev-token" },
      app: { id: "test-app", name: "Test App" },
      manifest: "./manifest.yaml",
      handlers: "./dist/handlers",
    });

    const state = sdk.state();
    expect(state.phase).toBe("init");
    expect(state.capabilities).toEqual({});
  });
});

describe("SdkConfig — type surface (Phase 1)", () => {
  it("accepts all required fields", () => {
    // Compile-time check: this assignment must type-check.
    const cfg: SdkConfig = {
      gateway: { url: "ws://localhost:7777", token: "dev-token" },
      app: { id: "test-app", name: "Test App" },
      manifest: "./manifest.yaml",
      handlers: "./dist/handlers",
    };
    expect(cfg.gateway.url).toBe("ws://localhost:7777");
    expect(cfg.app.id).toBe("test-app");
  });

  it("accepts optional observability field", () => {
    const cfg: SdkConfig = {
      gateway: { url: "ws://localhost:7777", token: "dev-token" },
      app: { id: "test-app", name: "Test App" },
      manifest: "./manifest.yaml",
      handlers: "./dist/handlers",
      observability: {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
    };
    expect(cfg.observability?.logger).toBeDefined();
  });
});

describe("HandlerContext — type surface (Phase 1)", () => {
  it("is constructible from the documented fields", () => {
    const ctx: HandlerContext = {
      app: { id: "test-app", name: "Test App" },
      call: {
        id: "call-123",
        capability: "customer.read",
        token: "caller-jwt",
      },
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    };
    expect(ctx.app.id).toBe("test-app");
    expect(ctx.call.capability).toBe("customer.read");
  });

  it("sessionId on call is optional", () => {
    const ctx: HandlerContext = {
      app: { id: "test-app", name: "Test App" },
      call: { id: "call-1", capability: "x", token: "t" },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    expect(ctx.call.sessionId).toBeUndefined();
  });
});

describe("Handler — type surface (Phase 1)", () => {
  it("accepts a function with (input, ctx) signature", () => {
    const handler: Handler<{ customerId: string }, { name: string }> =
      async (input, _ctx) => {
        return { name: `Customer ${input.customerId}` };
      };
    expect(typeof handler).toBe("function");
  });
});