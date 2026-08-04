/**
 * Phase 5 — lifecycle event publisher (8 events, sdk-node parity).
 *
 * Maps SDK state transitions to `@spanexx/event-bus` publishes:
 *   sdk.connected / sdk.disconnected / sdk.capability.{registered,
 *   unregistered, rejected} / sdk.invoke.{started, completed, failed}
 *
 * Every publish is fire-and-forget (`void`) so a slow subscriber cannot
 * block the SDK's hot path. Payload shapes mirror sdk-node's events.ts.
 */

import type { BackendValue } from "@spanexx/backend-runtime";
import type { EventBus } from "@spanexx/event-bus";

// CID:events-001 - SdkConnectedPayload
export interface SdkConnectedPayload {
  readonly appId: string;
  readonly gatewayUrl: string;
  /** ms from connect() to socket open. */
  readonly latencyMs: number;
}

// CID:events-002 - SdkDisconnectedPayload
// reason: "deliberate" | "pagehide" | "offline" | "origin-mismatch"
// (a network drop never surfaces here — the socket goes to "reconnecting"
// and onDisconnected is not called until the close is terminal).
export interface SdkDisconnectedPayload {
  readonly appId: string;
  readonly reason: string;
}

// CID:events-003 - SdkCapabilityRegisteredPayload
// reconnected: true on post-reconnect re-registration, false initially.
export interface SdkCapabilityRegisteredPayload {
  readonly appId: string;
  readonly capability: string;
  readonly reconnected: boolean;
}

// CID:events-004 - SdkCapabilityUnregisteredPayload
export interface SdkCapabilityUnregisteredPayload {
  readonly appId: string;
  readonly capability: string;
}

// CID:events-005 - SdkCapabilityRejectedPayload
// Emitted when the Gateway refuses a registration.
export interface SdkCapabilityRejectedPayload {
  readonly appId: string;
  readonly capability: string;
  readonly reason: string;
}

// CID:events-006 - SdkInvokeStartedPayload
export interface SdkInvokeStartedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly input: BackendValue;
}

// CID:events-007 - SdkInvokeCompletedPayload
export interface SdkInvokeCompletedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly durationMs: number;
}

// CID:events-008 - SdkInvokeFailedPayload
export interface SdkInvokeFailedPayload {
  readonly appId: string;
  readonly callId: string;
  readonly capability: string;
  readonly error: { message: string; code: string };
}

// CID:events-009 - SdkEventPublisher
// Thin wrapper mapping SDK transitions to bus publishes. Fire-and-forget.
export class SdkEventPublisher {
  constructor(
    private readonly eventBus: EventBus,
    private readonly appId: string,
  ) {}

  connected(gatewayUrl: string, latencyMs: number): void {
    void this.eventBus.publish<SdkConnectedPayload>("sdk.connected", {
      appId: this.appId,
      gatewayUrl,
      latencyMs,
    });
  }

  disconnected(reason: string): void {
    void this.eventBus.publish<SdkDisconnectedPayload>("sdk.disconnected", {
      appId: this.appId,
      reason,
    });
  }

  capabilityRegistered(capability: string, reconnected: boolean): void {
    void this.eventBus.publish<SdkCapabilityRegisteredPayload>(
      "sdk.capability.registered",
      { appId: this.appId, capability, reconnected },
    );
  }

  capabilityUnregistered(capability: string): void {
    void this.eventBus.publish<SdkCapabilityUnregisteredPayload>(
      "sdk.capability.unregistered",
      { appId: this.appId, capability },
    );
  }

  capabilityRejected(capability: string, reason: string): void {
    void this.eventBus.publish<SdkCapabilityRejectedPayload>(
      "sdk.capability.rejected",
      { appId: this.appId, capability, reason },
    );
  }

  invokeStarted(callId: string, capability: string, input: BackendValue): void {
    void this.eventBus.publish<SdkInvokeStartedPayload>("sdk.invoke.started", {
      appId: this.appId,
      callId,
      capability,
      input,
    });
  }

  invokeCompleted(callId: string, capability: string, durationMs: number): void {
    void this.eventBus.publish<SdkInvokeCompletedPayload>(
      "sdk.invoke.completed",
      { appId: this.appId, callId, capability, durationMs },
    );
  }

  invokeFailed(callId: string, capability: string, message: string, code: string): void {
    void this.eventBus.publish<SdkInvokeFailedPayload>("sdk.invoke.failed", {
      appId: this.appId,
      callId,
      capability,
      error: { message, code },
    });
  }
}
