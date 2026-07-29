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
import { resolveManifest, resolveHandlers, matchCapabilities } from "./register.js";
import type { Handler } from "./types.js";
import { dispatchIncoming as _dispatchIncoming, invokeHandler, makeHandlerContext, makeCallContext, makeLogger } from "./invoke.js";
// _dispatchIncoming will be wired in Phase 6 to handle inbound messages.
void _dispatchIncoming;

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
      if (client === null) {
        throw new Error("sdk-node: register() requires connect() first");
      }
      // Resolve manifest (path or inline) + handlers (path or inline map).
      const manifest = await resolveManifest(
        config.manifest as string | Record<string, import("./manifest.js").ManifestValue> | import("./manifest.js").ParsedManifest,
      );
      const handlers: Record<string, Handler> = await resolveHandlers(
        config.handlers as string | Record<string, Handler>,
      );

      // Match manifest capabilities to handlers; throws on mismatch.
      const matched = matchCapabilities(manifest, handlers);

      // Send each capability registration to the Gateway.
      for (const { cap } of matched) {
        client.send({
          type: "sdk.capability.register",
          name: cap.name,
          description: cap.description,
          version: cap.version,
          permissions: cap.permissions.join(","),  // serialize for the wire format
          tier: cap.tier ?? "",
        });
        capabilities[cap.name] = { tier: cap.tier ?? null, registered: true };
      }

      phase.value = "registered";
    },

    async invoke<I = unknown, O = unknown>(name: string, input: I): Promise<O> {
      if (client === null) {
        throw new Error("sdk-node: invoke() requires connect() first");
      }
      const handlers: Record<string, Handler> = await resolveHandlers(
        config.handlers as string | Record<string, Handler>,
      );
      const handler = handlers[name];
      if (handler === undefined) {
        throw new Error(`sdk-node: no handler for '${name}'`);
      }
      const ctx = makeHandlerContext(
        config.app,
        makeCallContext(`local-${Date.now()}`, name, "local"),
        makeLogger(false),
      );
      return invokeHandler(handler, input, ctx) as Promise<O>;
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