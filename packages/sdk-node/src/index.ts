/*
 * Code Map: sdk-node public entry point
 *
 * createSdk is the factory. Phase 1: typed stub. Phases 3-6 wire real
 * behavior. This file orchestrates the lifecycle; the heavy lifting
 * happens in client.ts, manifest.ts, lifecycle.ts.
 *
 *   Phase 1: state() + reset() work; everything else throws
 *   Phase 3: connect() opens WebSocket via WsClient
 *   Phase 4: register() reads manifest, registers capabilities
 *   Phase 5: invoke() dispatches calls
 *   Phase 6: disconnect() + auto-reconnect-with-reregister
 */

import type {
  SdkConfig,
  SdkInstance,
  SdkState,
  Phase,
} from "./types.js";
import { WsClient } from "./client.js";

/**
 * Create an SDK instance from the developer's config.
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
  const phase: { value: Phase } = { value: "init" };
  const capabilities: Record<string, { tier: string | null; registered: boolean }> = {};

  // The WebSocket client is created lazily on first connect(); held here for
  // later phases (register, invoke, disconnect) and for cleanup on reset.
  let client: WsClient | null = null;

  return {
    async connect(): Promise<void> {
      if (client === null) {
        client = new WsClient({ url: config.gateway.url, token: config.gateway.token });
      }
      await client.open();
      phase.value = "connected";
    },

    async register(): Promise<void> {
      throw new Error("sdk-node: register() not yet implemented (Phase 4)");
    },

    async invoke<I = unknown, O = unknown>(_name: string, _input: I): Promise<O> {
      throw new Error("sdk-node: invoke() not yet implemented (Phase 5)");
    },

    async disconnect(): Promise<void> {
      if (client !== null) {
        await client.close();
        client = null;
      }
      phase.value = "disconnected";
    },

    reset(): void {
      // Reset is allowed in any phase — it just clears local state.
      phase.value = "init";
      for (const k of Object.keys(capabilities)) {
        delete capabilities[k];
      }
      // Note: we don't close the client; the developer should call
      // disconnect() explicitly if they want the WebSocket closed.
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