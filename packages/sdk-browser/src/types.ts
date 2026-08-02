/**
 * @platform/sdk-browser — public types.
 *
 * The browser SDK has no manifest file: the DOM is the manifest. A developer
 * annotates elements with `data-sdk-cap="<name>"`; `createSdk` scans the page,
 * observes it for changes, and registers each unique capability with the
 * Gateway. Invocations fan out as `CustomEvent`s on the annotated elements.
 */

import type { BackendValue } from "@platform/backend-runtime";

/** Gateway URL (ws(s)://), app identity, and the JWT carrying `expectedOrigins`. */
export interface SdkOptions {
  /** ws(s):// URL of the Agentide Gateway. */
  gateway: string;
  /** Application identifier registered with the platform. */
  appId: string;
  /** JWT whose signed claims include `expectedOrigins` (origin binding, GRILL T5 Q2). */
  token: string;
  /**
   * Per-page-instance identifier (drift D-43). When omitted, a unique id is
   * auto-generated so two tabs of the same app stay distinguishable at the
   * Gateway instead of evicting each other.
   */
  tabId?: string;
  /** Root element to observe; defaults to `document.body`. */
  observeRoot?: Element;
  /** Default permission tier for discovered capabilities; defaults to `"act"`. */
  defaultTier?: string;
  /** Default version for discovered capabilities; defaults to `"1.0.0"`. */
  defaultVersion?: string;
}

/** The four states surfaced by `onStateChange` (GRILL T4 D3). */
export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/** A capability discovered in the DOM, after count-based dedup. */
export interface CapabilityView {
  name: string;
  tier: string;
  version: string;
  /** Number of annotated elements in the observed DOM (dedup key). */
  count: number;
  /** True while registered with the Gateway (0→1 register, 1→0 unregister). */
  registered: boolean;
}

/** Synchronous state snapshot. */
export interface SdkState {
  connectionState: ConnectionState;
  capabilities: CapabilityView[];
}

/** Incoming invocation payload delivered to dev listeners. */
export interface InvocationDetail {
  input: BackendValue;
  ctx: { token: string };
}

/** The public SDK surface returned by `createSdk`. */
export interface Sdk {
  /** Connect (or reconnect) to the Gateway; auth-first-message handshake. */
  connect(): void;
  /** Deliberate teardown — no reconnect. */
  disconnect(): void;
  /** Add an extra observation root (no shadow DOM / iframe piercing in v1). */
  observe(root: Element): void;
  /** Subscribe to real connection-state transitions only. */
  onStateChange(cb: (state: ConnectionState) => void): () => void;
  /** Synchronous state getter. */
  state(): SdkState;
  /** Programmatic invocation of a capability. */
  invoke(name: string, input?: BackendValue): void;
}
