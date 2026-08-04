/**
 * @platform/sdk-browser — public entry point.
 *
 * `createSdk` is the factory. The DOM is the manifest: `data-sdk-cap`
 * annotations are scanned on create (and on `observe()`), watched via
 * MutationObserver (observer.ts), fanned out on `sdk.invoke` (dispatch.ts),
 * carried over `globalThis.WebSocket` with auth-first + backoff (client.ts),
 * gated by visibility/offline/pagehide (lifecycle.ts), and surfaced through
 * `onStateChange` (state.ts) plus 8 bus events (events.ts).
 *
 * CID Index:
 * CID:index-001 -> createSdk (validation + engine wiring)
 * CID:index-002 -> attachRoot (scan + watch an observation root)
 * CID:index-003 -> syncRegistration (register 0→1 / unregister 1→0)
 * CID:index-004 -> handleInvoke (wire invoke → fan-out → events)
 */

import type { BackendValue } from "@platform/backend-runtime";
import { createEventBus } from "@spanexx/event-bus";
import { SdkClient } from "./client.js";
import type { InvokeMessage, RegisterErrorMessage } from "./client.js";
import { dispatchInvoke } from "./dispatch.js";
import { SdkEventPublisher } from "./events.js";
import { attachLifecycle } from "./lifecycle.js";
import { CapRegistry, scanRoot, watchCaps } from "./observer.js";
import type { CapabilityView, Sdk, SdkOptions } from "./types.js";
import { StateStore } from "./state.js";

// Module-level counter for auto-generated tab ids (drift D-43). Each JS
// context (page/tab) gets a unique id even when the developer omits tabId.
let autoTabSeq = 0;

// CID:index-001 - createSdk
// Purpose: factory — validates options, verifies the WebSocket transport,
//   wires the engine modules together, and returns the public Sdk surface.
// Uses: client.ts, dispatch.ts, events.ts, lifecycle.ts, observer.ts,
//   state.ts, types.ts
// Used by: page code, tests, post-impl sim
export function createSdk(options: SdkOptions): Sdk {
  if (!options.gateway) {
    throw new Error("sdk-browser: options.gateway is required");
  }
  if (!options.appId) {
    throw new Error("sdk-browser: options.appId is required");
  }
  if (!options.token) {
    throw new Error("sdk-browser: options.token is required");
  }
  if (typeof globalThis.WebSocket === "undefined") {
    // GRILL T5 Q4: no polyfill — fail fast so the developer knows the
    // environment cannot support the SDK.
    throw new Error(
      "sdk-browser: globalThis.WebSocket is missing — this SDK requires a browser WebSocket transport (no polyfill).",
    );
  }

  const eventBus = createEventBus();
  const registry = new CapRegistry(options.defaultTier, options.defaultVersion);
  const publisher = new SdkEventPublisher(eventBus, options.appId);
  const stateStore = new StateStore(registry);
  // Drift D-43: per-page-instance tab id. Explicit option wins; otherwise a
  // unique id per JS context so two tabs of the same app don't evict each
  // other at the Gateway (which keys connections by tabId).
  const tabId = options.tabId ?? `tab-${Date.now().toString(36)}-${(autoTabSeq += 1).toString(36)}`;

  let connectCount = 0;
  let connected = false;
  let invokeCounter = 0;
  // Assigned after the client is built (wire sender for registrations).
  let sendRegister: (name: string) => void = () => undefined;

  // CID:index-003 - syncRegistration
  // Purpose: 0→1 register / 1→0 unregister, gated on the connection so
  //   capabilities are only registered while connected (GRILL T2). The
  //   register wire message is sent to the Gateway and the bus event is
  //   published; unregister only emits the bus event (the Gateway learns
  //   via the socket closing or the count reaching zero).
  //   `view` is passed by the observer on removals, where the registry entry
  //   is already deleted (count 0) — without it, 1→0 would silently vanish.
  const syncRegistration = (name: string, view?: CapabilityView) => {
    const current = view ?? registry.get(name);
    if (current === undefined) return;
    if (connected && current.count > 0) {
      if (!current.registered) {
        registry.setRegistered(name, true);
        sendRegister(name);
        // reconnected=true only after the initial connection (sdk-node parity).
        publisher.capabilityRegistered(name, connectCount > 1);
      }
    } else if (current.registered) {
      registry.setRegistered(name, false);
      publisher.capabilityUnregistered(name);
    }
  };

  // CID:index-004 - handleInvoke
  // Purpose: shared path for wire invokes (client hook) and the public
  //   invoke() — emit started/failed/completed events around the fan-out,
  //   and reply on the wire with sdk.invoke.result / sdk.invoke.error
  //   (sdk-node parity: callId correlates the gateway's original request).
  const handleInvoke = (callId: string, name: string, input?: BackendValue) => {
    publisher.invokeStarted(callId, name, input ?? null);
    const started = performance.now();
    const ok = dispatchInvoke(registry.elements(name), name, input ?? null, options.token);
    if (ok) {
      client.send({ type: "sdk.invoke.result", callId, payload: null });
      publisher.invokeCompleted(callId, name, performance.now() - started);
    } else {
      client.send({
        type: "sdk.invoke.error",
        callId,
        code: "NO_TARGETS",
        message: `no annotated elements for ${name}`,
      });
      publisher.invokeFailed(callId, name, `no annotated elements for ${name}`, "NO_TARGETS");
    }
  };

  const client = new SdkClient(options.gateway, options.token, {
    onState: (state) => {
      const wasConnected = connected;
      stateStore.setConnection(state);
      connected = state === "connected";
      if (connected) {
        connectCount += 1;
        for (const view of registry.list()) syncRegistration(view.name);
      } else if (wasConnected) {
        // Dropped / disconnected: unregister everything (registered
        // only while connected).
        for (const view of registry.list()) syncRegistration(view.name);
      }
    },
    onOpen: (latencyMs) => publisher.connected(options.gateway, latencyMs),
    onDisconnected: (reason) => publisher.disconnected(reason),
    onInvoke: (message: InvokeMessage) => handleInvoke(message.callId, message.name, message.input),
    onRegisterError: (message: RegisterErrorMessage) =>
      publisher.capabilityRejected(message.name, message.reason),
  }, tabId);
  // Drift D-40: the wire frame mirrors sdk-node — name + description +
  // version + permissions + tier — so gateway validation accepts it
  // (validateRecord requires version + description). The DOM has no
  // description or permission model; name stands in for description and
  // permissions stay empty (server splits "" -> []).
  sendRegister = (name) => {
    const view = registry.get(name);
    client.send({
      type: "sdk.capability.register",
      name,
      description: view?.name ?? name,
      version: view?.version ?? "1.0.0",
      permissions: "",
      tier: view?.tier ?? "",
    });
  };

  // CID:index-002 - attachRoot
  // Purpose: initial scan (GRILL T2) + MutationObserver on one root.
  const attachRoot = (root: Element) => {
    for (const cap of scanRoot(root)) {
      if (registry.add(cap.el)) syncRegistration(cap.name);
    }
    // Pass the observer's view through: on 1→0 removals the registry entry is
    // already gone, and the synthetic count:0 view carries the real
    // `registered` flag so the unregister event still fires.
    watchCaps(root, registry, (name, view) => syncRegistration(name, view));
  };

  attachRoot(options.observeRoot ?? document.body);
  attachLifecycle(client);

  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    observe: (root: Element) => attachRoot(root),
    onStateChange: (cb) => stateStore.onStateChange(cb),
    state: () => stateStore.state(),
    invoke: (name: string, input?: BackendValue) => handleInvoke(`inv-${++invokeCounter}`, name, input),
  };
}

export type {
  Sdk,
  SdkOptions,
  SdkState,
  ConnectionState,
  CapabilityView,
  InvocationDetail,
} from "./types.js";
