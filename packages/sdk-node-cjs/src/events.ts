/*
 * Code Map: sdk-node event publisher + payload types (Phase 7 / Gap 1)
 *
 * Wires the SDK's lifecycle to the shared @spanexx/event-bus. Every
 * PRD-TRD §Events emitted payload lives here; the publisher below maps
 * internal state transitions to the 8 documented events.
 *
 * CID Index:
 * CID:events-001 -> SdkConnectedPayload
 * CID:events-002 -> SdkDisconnectedPayload
 * CID:events-003 -> SdkCapabilityRegisteredPayload
 * CID:events-004 -> SdkCapabilityUnregisteredPayload
 * CID:events-005 -> SdkInvokeStartedPayload
 * CID:events-006 -> SdkInvokeCompletedPayload
 * CID:events-007 -> SdkInvokeFailedPayload
 * CID:events-009 -> SdkCapabilityRejectedPayload  (8th event, added in Phase 7)
 * CID:events-008 -> SdkEventPublisher
 *
 * Quick lookup: rg -n "CID:events-" packages/sdk-node/src/events.ts
 */

import type { EventBus } from "@spanexx/event-bus-cjs";
import type { WirePrimitive, WireObject } from "./client";

/** Any value that can appear on the wire — primitives, nested objects, and
 *  readonly arrays of either. Banned-`unknown` substitute for handler input. */
export type WireValue =
  | WirePrimitive
  | WireObject
  | readonly WirePrimitive[]
  | readonly WireObject[];

// CID:events-001 - SdkConnectedPayload
// Purpose: payload for `sdk.connected`. Carries the appId, gateway url, and
//   measured latency from open() resolving to auth-handshake completion.
export interface SdkConnectedPayload {
  readonly appId: string;
  readonly gatewayUrl: string;
  readonly latencyMs: number;
}

// CID:events-002 - SdkDisconnectedPayload
// Purpose: payload for `sdk.disconnected`. Carries the appId and a textual
//   reason (`"explicit"`, `"simulated-drop"`, `"error"`, etc.).
export interface SdkDisconnectedPayload {
  readonly appId: string;
  readonly reason: string;
}

// CID:events-003 - SdkCapabilityRegisteredPayload
// Purpose: payload for `sdk.capability.registered`. `reconnected` flips to
//   true on a post-reconnect re-registration, false on the initial register.
export interface SdkCapabilityRegisteredPayload {
  readonly appId: string;
  readonly capability: string;
  readonly reconnected: boolean;
}

// CID:events-004 - SdkCapabilityUnregisteredPayload
// Purpose: payload for `sdk.capability.unregistered`. Emitted on
//   disconnect() and reset() for every previously-registered capability.
export interface SdkCapabilityUnregisteredPayload {
  readonly appId: string;
  readonly capability: string;
}

// CID:events-005 - SdkInvokeStartedPayload
// Purpose: payload for `sdk.invoke.started`. Emitted before the handler
//   runs; carries callId, capability name, and the input payload.
export interface SdkInvokeStartedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly input: WireValue;
}

// CID:events-006 - SdkInvokeCompletedPayload
// Purpose: payload for `sdk.invoke.completed`. Carries the measured
//   duration from started to handler-return.
export interface SdkInvokeCompletedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly durationMs: number;
}

// CID:events-007 - SdkInvokeFailedPayload
// Purpose: payload for `sdk.invoke.failed`. Carries the handler's error
//   message and a normalized code so subscribers can branch on it.
export interface SdkInvokeFailedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly error: { message: string; code: string };
}

// CID:events-009 - SdkCapabilityRejectedPayload
// Purpose: payload for `sdk.capability.rejected`. Emitted when the Gateway
//   refuses a `sdk.capability.register` request. Carries the rejection
//   reason from the Gateway.
export interface SdkCapabilityRejectedPayload {
  readonly appId: string;
  readonly capability: string;
  readonly reason: string;
}

// CID:events-008 - SdkEventPublisher
// Purpose: thin wrapper that maps SDK state transitions to Event Bus
//   publishes. Every publish is fire-and-forget (`void`) so a slow
//   subscriber cannot block the SDK's hot path.
export class SdkEventPublisher {
  constructor(
    private readonly eventBus: EventBus,
    private readonly appId: string,
  ) {}

  connected(gatewayUrl: string, latencyMs: number): void {
    const payload: SdkConnectedPayload = {
      appId: this.appId,
      gatewayUrl,
      latencyMs,
    };
    void this.eventBus.publish<SdkConnectedPayload>("sdk.connected", payload);
  }

  disconnected(reason: string): void {
    const payload: SdkDisconnectedPayload = {
      appId: this.appId,
      reason,
    };
    void this.eventBus.publish<SdkDisconnectedPayload>("sdk.disconnected", payload);
  }

  capabilityRegistered(capability: string, reconnected: boolean): void {
    const payload: SdkCapabilityRegisteredPayload = {
      appId: this.appId,
      capability,
      reconnected,
    };
    void this.eventBus.publish<SdkCapabilityRegisteredPayload>(
      "sdk.capability.registered",
      payload,
    );
  }

  capabilityUnregistered(capability: string): void {
    const payload: SdkCapabilityUnregisteredPayload = {
      appId: this.appId,
      capability,
    };
    void this.eventBus.publish<SdkCapabilityUnregisteredPayload>(
      "sdk.capability.unregistered",
      payload,
    );
  }

  invokeStarted(callId: string, capability: string, input: WireValue): void {
    const payload: SdkInvokeStartedPayload = {
      appId: this.appId,
      callId,
      capability,
      input,
    };
    void this.eventBus.publish<SdkInvokeStartedPayload>("sdk.invoke.started", payload);
  }

  invokeCompleted(callId: string, capability: string, durationMs: number): void {
    const payload: SdkInvokeCompletedPayload = {
      appId: this.appId,
      callId,
      capability,
      durationMs,
    };
    void this.eventBus.publish<SdkInvokeCompletedPayload>("sdk.invoke.completed", payload);
  }

  invokeFailed(callId: string, capability: string, code: string, message: string): void {
    const payload: SdkInvokeFailedPayload = {
      appId: this.appId,
      callId,
      capability,
      error: { message, code },
    };
    void this.eventBus.publish<SdkInvokeFailedPayload>("sdk.invoke.failed", payload);
  }

  capabilityRejected(capability: string, reason: string): void {
    const payload: SdkCapabilityRejectedPayload = {
      appId: this.appId,
      capability,
      reason,
    };
    void this.eventBus.publish<SdkCapabilityRejectedPayload>(
      "sdk.capability.rejected",
      payload,
    );
  }
}
