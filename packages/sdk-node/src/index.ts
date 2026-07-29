/*
 * Code Map: sdk-node public entry point
 *
 * createSdk is the factory. Phase 1 returns a stub that satisfies the
 * SdkInstance shape but throws on every method except state(). Subsequent
 * phases replace each method with real behavior:
 *
 *   Phase 3: connect() opens WebSocket
 *   Phase 4: register() reads manifest + handlers, registers caps
 *   Phase 5: invoke() dispatches calls + returns results
 *   Phase 6: disconnect() + reconnect-with-reregister
 */

import type {
  SdkConfig,
  SdkInstance,
  SdkState,
  Phase,
} from "./types.js";

/**
 * Create an SDK instance from the developer's config.
 *
 * Phase 1: returns a typed stub. Phases 3-6 wire up the real lifecycle.
 */
export function createSdk(config: SdkConfig): SdkInstance {
  // Validate config shape early — fail fast on bad input.
  if (!config.gateway?.url || !config.gateway?.token) {
    throw new Error("sdk-node: config.gateway must include both url and token");
  }
  if (!config.app?.id || !config.app?.name) {
    throw new Error("sdk-node: config.app must include both id and name");
  }
  if (config.manifest === undefined || config.manifest === null) {
    throw new Error("sdk-node: config.manifest is required (path or inline object)");
  }
  if (config.handlers === undefined || config.handlers === null) {
    throw new Error("sdk-node: config.handlers is required (path or inline map)");
  }

  // Mutable internal state — kept private.
  // (Internal type is mutable; the public state() returns a readonly view.)
  const phase: { value: Phase } = { value: "init" };
  const capabilities: Record<string, { tier: string | null; registered: boolean }> = {};

  return {
    async connect(): Promise<void> {
      throw new Error("sdk-node: connect() not yet implemented (Phase 3)");
    },

    async register(): Promise<void> {
      throw new Error("sdk-node: register() not yet implemented (Phase 4)");
    },

    async invoke<I = unknown, O = unknown>(_name: string, _input: I): Promise<O> {
      throw new Error("sdk-node: invoke() not yet implemented (Phase 5)");
    },

    async disconnect(): Promise<void> {
      throw new Error("sdk-node: disconnect() not yet implemented (Phase 6)");
    },

    reset(): void {
      // Reset is allowed even in Phase 1 — it just clears local state.
      phase.value = "init";
      for (const k of Object.keys(capabilities)) {
        delete capabilities[k];
      }
    },

    state(): SdkState {
      // Return a shallow copy so callers can't mutate our internal state.
      return {
        phase: phase.value,
        capabilities: { ...capabilities },
      };
    },
  };
}

export type {
  SdkConfig,
  SdkInstance,
  SdkState,
  Phase,
  Logger,
  Handler,
  HandlerContext,
  CallContext,
  GatewayTarget,
  AppIdentity,
  Observability,
  ManifestSource,
  HandlerSource,
} from "./types.js";