/*
 * Code Map: lifecycle orchestration (Phase 6)
 *
 * Wires the SDK's lifecycle to the WsClient's events:
 *
 *   - On connect:  subscribe to 'open', 'close', 'message', 'error'
 *   - On 'open' after a reconnect: re-register every previously-registered cap
 *   - On 'close': mark phase=disconnected, schedule reconnect
 *   - On 'message': dispatch as an inbound invocation
 *
 * The lifecycle object holds the registered-capabilities list so re-register
 * can replay them after reconnect. Reset clears the list and tears down
 * handlers.
 *
 * Bus events are emitted via the injected SdkEventPublisher (Phase 7):
 *   - sdk.connected           on every successful open
 *   - sdk.disconnected        on every close
 *   - sdk.capability.registered  per initial + reconnect re-registration
 *   - sdk.capability.unregistered per cap on reset (called from index.ts)
 */

import type { WsClient, WsClientMessage, WsClientEventPayload } from "./client";
import type { Phase } from "./types";
import type { SdkEventPublisher } from "./events";

export interface LifecycleState {
  readonly phase: { value: Phase };
  readonly registered: Map<string, RegisteredCapability>;
}

export interface RegisteredCapability {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly permissions: readonly string[];
  readonly tier: string | null;
}

export interface LifecycleHandlers {
  /** Called once on every successful open (initial and post-reconnect). */
  readonly onOpen: (() => void) | null;
  /** Called on every close. */
  readonly onClose: (() => void) | null;
  /** Called on every error. */
  readonly onError: ((err: Error) => void) | null;
  /** Called on every inbound message. */
  readonly onMessage: ((msg: WsClientMessage) => void) | null;
}

export interface LifecycleDeps {
  readonly client: WsClient;
  readonly state: LifecycleState;
  readonly handlers: LifecycleHandlers;
  readonly logger: { info(message: string, meta?: Record<string, string | number | boolean | null>): void; warn(message: string, meta?: Record<string, string | number | boolean | null>): void; error(message: string, meta?: Record<string, string | number | boolean | null>): void };
  /** Bus publisher. Required — wired in Phase 7 to fix the event-bus gap. */
  readonly publisher: SdkEventPublisher;
}

/**
 * Attach lifecycle event handlers to a WsClient. Idempotent: calling twice
 * replaces the previous handlers.
 */
export function attachLifecycle(deps: LifecycleDeps): void {
  const { client, state, handlers, logger, publisher } = deps;

  client.on("open", () => {
    state.phase.value = "connected";
    if (state.registered.size > 0) {
      // Reconnect path: re-register everything we had before.
      logger.info("lifecycle: re-registering capabilities", { count: state.registered.size });
      reRegisterAll(client, state.registered, publisher);
      state.phase.value = "registered";
    }
    publisher.connected(client.configuredUrl(), client.latencyMs());
    if (handlers.onOpen) handlers.onOpen();
  });

  client.on("close", () => {
    state.phase.value = "disconnected";
    publisher.disconnected("ws-closed");
    if (handlers.onClose) handlers.onClose();
  });

  client.on("error", (err: WsClientEventPayload | Error) => {
    const errMessage = err instanceof Error ? err.message : "unknown";
    logger.error("lifecycle: client error", { message: errMessage });
    if (handlers.onError && err instanceof Error) handlers.onError(err);
  });

  client.on("message", (msg: WsClientEventPayload | Error) => {
    if (handlers.onMessage) {
      // JSON round-trip narrows the union to WsClientMessage.
      handlers.onMessage(JSON.parse(JSON.stringify(msg)) as WsClientMessage);
    }
  });
}

/**
 * Re-register every previously-registered capability.
 *
 * Phase 6 behavior: just replay the register messages. We don't try to be
 * clever about which caps the Gateway already knows about.
 */
function reRegisterAll(
  client: WsClient,
  registered: Map<string, RegisteredCapability>,
  publisher: SdkEventPublisher,
): void {
  for (const cap of registered.values()) {
    client.send({
      type: "sdk.capability.register",
      name: cap.name,
      description: cap.description,
      version: cap.version,
      permissions: cap.permissions.join(","),
      tier: cap.tier ?? "",
    });
    publisher.capabilityRegistered(cap.name, true);
  }
}

/**
 * Track a freshly-registered capability so we can re-register it later.
 */
export function trackRegistration(
  state: LifecycleState,
  cap: RegisteredCapability,
): void {
  state.registered.set(cap.name, cap);
}

/**
 * Forget every tracked registration (used by reset).
 */
export function clearRegistrations(state: LifecycleState): void {
  state.registered.clear();
}
