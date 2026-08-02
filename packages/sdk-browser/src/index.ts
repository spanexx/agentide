/**
 * @platform/sdk-browser — public entry point.
 *
 * `createSdk` is the factory. Phase 1 scaffolds the shape; later phases wire
 * the engine:
 *   - Phase 2 (observer.ts): initial scan + MutationObserver over
 *     `observeRoot` (default `document.body`), count-based dedup
 *     (register 0→1, unregister 1→0). The DOM is the manifest.
 *   - Phase 3 (dispatch.ts): Gateway `sdk.invoke` fans out
 *     `CustomEvent("sdk:cap:<name>")` on every annotated element, with the
 *     form-fill fallback.
 *   - Phase 4 (client.ts): `globalThis.WebSocket` transport, auth-first
 *     message `{ type: "sdk.auth", token }`, reconnect backoff
 *     1s→30s ±20% jitter.
 *   - Phase 5 (lifecycle.ts / state.ts / events.ts): visibility / offline /
 *     pagehide gates, `onStateChange` 4-state surface, 8 bus events
 *     (sdk-node parity).
 */

import type { Sdk, SdkOptions } from "./types.js";

// CID:index-001 - createSdk
// Purpose: factory — validates options, verifies the WebSocket transport
//   exists, and returns the public Sdk surface. Engine modules (observer,
//   dispatch, client, lifecycle) attach in Phases 2–5.
// Uses: types.ts
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

  // Phase 2–5 modules attach here. For now, connect()/disconnect() are
  // no-ops so the package builds and tests can pin the factory contract.
  return {
    connect() {
      /* wired in Phase 4 */
    },
    disconnect() {
      /* wired in Phase 4 */
    },
    observe() {
      /* wired in Phase 2 */
    },
    onStateChange() {
      /* wired in Phase 5 */
      return () => undefined;
    },
    state() {
      return { connectionState: "disconnected", capabilities: [] };
    },
    invoke() {
      /* wired in Phase 3 */
    },
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
