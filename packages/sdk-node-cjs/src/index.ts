/*
 * Code Map: sdk-node public entry point
 *
 * createSdk is the factory. The full lifecycle is wired here:
 *   - connect() opens a WebSocket via WsClient and attaches lifecycle handlers
 *   - register() reads the manifest + handlers, sends registrations
 *   - invoke() handles direct (developer-facing) calls
 *   - disconnect() closes the WebSocket and emits unregistered events
 *   - reset() clears local state and emits unregistered events
 *   - state() exposes phase + capabilities
 *
 * Phase 6 adds lifecycle.ts which keeps a Map of registered capabilities
 * so that on reconnect, every cap is re-registered automatically.
 *
 * Phase 7 wires @spanexx/event-bus — every PRD-TRD event is emitted here:
 *   sdk.connected, sdk.disconnected, sdk.capability.{registered,unregistered},
 *   sdk.invoke.{started,completed,failed}.
 */

import type {
  SdkConfig,
  SdkInstance,
  SdkState,
  Phase,
  Handler,
} from "./types";
import { WsClient } from "./client";
import { TokenRefresher, type FetchImpl } from "./refresher";
import { resolveManifest, resolveHandlers, matchCapabilities } from "./register";
import {
  dispatchIncoming,
  invokeHandler,
  makeHandlerContext,
  makeCallContext,
  makeLogger,
} from "./invoke";
import {
  attachLifecycle,
  trackRegistration,
  clearRegistrations,
  type LifecycleState,
  type RegisteredCapability,
} from "./lifecycle";
import { createEventBus, type EventBus } from "@spanexx/event-bus-cjs";
import { SdkEventPublisher } from "./events";

/**
 * Create an SDK instance from the developer's config.
 */
export function createSdk(config: SdkConfig): SdkInstance {
  // Validate config shape early — fail fast on bad input.
  // BI[29]: gateway.token OR clientId+clientSecret; clientId wins when both.
  const hasClientCreds = config.clientId !== undefined || config.clientSecret !== undefined;
  if (hasClientCreds) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error("sdk-node: clientId and clientSecret must be provided together");
    }
    if (!config.oauthUrl) {
      throw new Error("sdk-node: oauthUrl is required when clientId is set");
    }
  }
  if (!config.gateway?.url) {
    throw new Error("sdk-node: config.gateway.url is required");
  }
  if (!hasClientCreds && !config.gateway?.token) {
    throw new Error("sdk-node: config.gateway.token (or clientId+clientSecret) is required");
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

  const logger = makeLogger(false);

  // BI[29]: client_credentials token lifecycle. Created when clientId is set;
  // the initial mint kicks off immediately so the first connect() is fast.
  const refresher: TokenRefresher | null = hasClientCreds
    ? new TokenRefresher({
        oauthUrl: config.oauthUrl as string,
        clientId: config.clientId as string,
        clientSecret: config.clientSecret as string,
        fetchImpl: config.fetchImpl as FetchImpl | undefined,
        clock: config.clock,
        random: config.random,
        backoffBaseMs: config.backoffBaseMs,
        backoffMaxMs: config.backoffMaxMs,
        maxAttempts: config.maxAttempts,
        onRevoked: () => {
          // Revocation: close the ws cleanly and never reconnect. Errors
          // surface through the user's onRevoked callback (PRD S4).
          config.onRevoked?.();
          void sdkInternal.client?.close();
        },
      })
    : null;
  if (refresher !== null) {
    // Fire-and-forget: connect()/refreshIfNeeded() await the same in-flight
    // promise, so failures still surface deterministically there.
    void refresher.ensureToken().catch(() => {});
  }

  /** The JWT used for the auth handshake: refreshed token wins over static. */
  function currentToken(): string {
    if (refresher !== null) {
      const t = refresher.token();
      if (t !== null) return t;
    }
    return config.gateway.token ?? "";
  }

  // Mutable internal state — kept private.
  const phase: { value: Phase } = { value: "init" };
  const registered = new Map<string, RegisteredCapability>();

  const lifecycleState: LifecycleState = { phase, registered };

  // The WebSocket client is created lazily on first connect().
  // Exposed as a property on the returned object so tests can dispatch
  // inbound messages against the same client the lifecycle uses.
  const sdkInternal: { client: WsClient | null } = { client: null };

  // Each SDK instance gets its own event bus so subscribers don't see
  // events from unrelated SDKs in the same process. Tests can override
  // via the `bus` field on SdkConfig (advanced; not on the public surface).
  const bus: EventBus = (config as { bus?: EventBus }).bus ?? createEventBus();
  const publisher = new SdkEventPublisher(bus, config.app.id);

  // Resolve handlers lazily — used by invoke() and the inbound dispatcher.
  let resolvedHandlers: Record<string, Handler> | null = null;
  async function getHandlers(): Promise<Record<string, Handler>> {
    if (resolvedHandlers === null) {
      resolvedHandlers = await resolveHandlers(
        config.handlers as string | Record<string, Handler>,
      );
    }
    return resolvedHandlers;
  }

  function attachLifecycleToClient(c: WsClient): void {
    attachLifecycle({
      client: c,
      state: lifecycleState,
      logger,
      publisher,
      handlers: {
        onOpen: null,
        onClose: null,
        onError: null,
        onMessage: async (msg) => {
          // Inbound message — dispatch as an invocation.
          const handlers = await getHandlers();
          await dispatchIncoming(
            c,
            handlers,
            { app: config.app, token: currentToken() },
            msg,
            logger,
            publisher,
          );
        },
      },
    });
  }

  const sdk: SdkInstance & { client: WsClient | null } = {
    async connect(): Promise<void> {
      if (refresher !== null) {
        // Mint (or refresh) before opening — the ws auth handshake needs a
        // live JWT. Throws when the mint failed after backoff exhaustion;
        // onRevoked already fired for client_revoked.
        const t = await refresher.ensureToken();
        if (t === null) {
          throw new Error("sdk-node: client revoked; reconnect blocked");
        }
      }
      if (sdkInternal.client === null) {
        sdkInternal.client = new WsClient({ url: config.gateway.url, token: currentToken() });
        attachLifecycleToClient(sdkInternal.client);
      } else {
        sdkInternal.client.updateToken(currentToken());
      }
      await sdkInternal.client.open();
      // Phase is set by the 'open' lifecycle handler. If registered.size > 0,
      // it transitions to 'registered' after re-registration. Otherwise it
      // stays at 'connected' until register() is called.
    },

    async register(): Promise<void> {
      if (sdkInternal.client === null) {
        throw new Error("sdk-node: register() requires connect() first");
      }
      const manifest = await resolveManifest(
        config.manifest as string | Record<string, import("./manifest.js").ManifestValue> | import("./manifest.js").ParsedManifest,
      );
      const handlers = await getHandlers();
      const matched = matchCapabilities(manifest, handlers);

      for (const { cap } of matched) {
        sdkInternal.client.send({
          type: "sdk.capability.register",
          name: cap.name,
          description: cap.description,
          version: cap.version,
          permissions: cap.permissions.join(","),
          tier: cap.tier ?? "",
        });
        trackRegistration(lifecycleState, {
          name: cap.name,
          description: cap.description,
          version: cap.version,
          permissions: cap.permissions,
          tier: cap.tier ?? null,
        });
        // Phase 7: emit sdk.capability.registered on the event bus.
        publisher.capabilityRegistered(cap.name, false);
      }

      phase.value = "registered";
    },

    async invoke<I = unknown, O = unknown>(name: string, input: I): Promise<O> {
      if (sdkInternal.client === null) {
        throw new Error("sdk-node: invoke() requires connect() first");
      }
      const handlers = await getHandlers();
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
      if (sdkInternal.client !== null) {
        // Emit unregistered for every tracked capability before closing
        // the connection (Gap 4 fix).
        for (const capName of registered.keys()) {
          publisher.capabilityUnregistered(capName);
        }
        await sdkInternal.client.close();
        sdkInternal.client = null;
      }
      phase.value = "disconnected";
    },

    reset(): void {
      // Reset is allowed in any phase — it just clears local state.
      // Emit unregistered for every tracked capability (Gap 4 fix).
      for (const capName of registered.keys()) {
        publisher.capabilityUnregistered(capName);
      }
      phase.value = "init";
      clearRegistrations(lifecycleState);
    },

    state(): SdkState {
      // Return a shallow copy so callers can't mutate our internal state.
      const caps: Record<string, { tier: string | null; registered: boolean }> = {};
      for (const [name, cap] of registered) {
        caps[name] = { tier: cap.tier, registered: true };
      }
      return { phase: phase.value, capabilities: caps };
    },
    // CID:sdk-002 - token lifecycle (BI[29]): refreshed JWT wins over static.
    token: (): string | null => (refresher !== null ? refresher.token() : (config.gateway.token ?? null)),
    async refreshIfNeeded(): Promise<void> {
      if (refresher !== null) await refresher.refreshIfNeeded();
    },
    // Exposed for tests so they can dispatch inbound messages against
    // the same WsClient the lifecycle uses. Not part of the public API.
    client: null,
  };

  // Live reference so connect() can populate and tests can read.
  Object.defineProperty(sdk, "client", {
    get(): WsClient | null {
      return sdkInternal.client;
    },
  });

  return sdk;
}

export {
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
} from "./types";

export { WsClient } from "./client";
export { TokenRefresher, type FetchImpl } from "./refresher";

export {
  SdkEventPublisher,
  type SdkConnectedPayload,
  type SdkDisconnectedPayload,
  type SdkCapabilityRegisteredPayload,
  type SdkCapabilityUnregisteredPayload,
  type SdkInvokeStartedPayload,
  type SdkInvokeCompletedPayload,
  type SdkInvokeFailedPayload,
} from "./events";