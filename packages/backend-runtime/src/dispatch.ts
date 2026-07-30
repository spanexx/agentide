/*
 * Code Map: InvocationDispatcher (Phase 4)
 * - dispatchInvocation: public entry point — find the connected SDK for
 *   `backend-sdk-<appId>`, send `sdk.invoke` over the WebSocket, await
 *   `sdk.invoke.result` / `sdk.invoke.error` with a configurable timeout.
 * - handleResult / handleError: called by server.ts when the SDK responds;
 *   resolve the pending invocation.
 * - rejectAllPending(appId, reason): called by server.ts when the socket
 *   closes mid-invoke; reject every pending callId owned by that appId.
 *
 * Wire-format error mapping:
 *   SDK `HANDLER_NOT_FOUND` -> GATEWAY_CAPABILITY_NOT_FOUND (retryable: false)
 *   SDK `HANDLER_ERROR`     -> GATEWAY_INTERNAL_ERROR      (retryable: false)
 *   SDK other / unknown     -> GATEWAY_INTERNAL_ERROR      (retryable: false)
 *   timeout                 -> GATEWAY_HANDLER_TIMEOUT     (retryable: true)
 *   socket closed mid-flight-> GATEWAY_SDK_UNREACHABLE     (retryable: true)
 *   socket.send() throws     -> GATEWAY_SDK_UNREACHABLE     (retryable: true)
 *   no connection            -> GATEWAY_SDK_UNREACHABLE     (retryable: true)
 *
 * CID Index:
 * CID:dispatch-001 -> InvocationDispatcher.dispatchInvocation
 * CID:dispatch-002 -> InvocationDispatcher.handleResult
 * CID:dispatch-003 -> InvocationDispatcher.handleError
 * CID:dispatch-004 -> InvocationDispatcher.rejectAllPending
 */

import { ERROR_CODES, GatewayError } from "@platform/gateway-core";
import type { ConnectionRegistry } from "./registry.js";
import type { BackendValue, Clock } from "./types.js";

interface PendingInvocation {
  readonly appId: string;
  readonly resolve: (payload: BackendValue) => void;
  readonly reject: (err: Error) => void;
  readonly timeoutHandle: number;
}

export interface DispatchErrorMapping {
  readonly handlerNotFoundCode: string;   // default GATEWAY_CAPABILITY_NOT_FOUND
  readonly handlerErrorCode: string;       // default GATEWAY_INTERNAL_ERROR
  readonly handlerTimeoutCode: string;     // default GATEWAY_HANDLER_TIMEOUT
  readonly sdkUnreachableCode: string;     // default GATEWAY_SDK_UNREACHABLE
  readonly invalidOwnerCode: string;       // default GATEWAY_CAPABILITY_NOT_FOUND
}

const DEFAULT_ERROR_MAPPING: DispatchErrorMapping = {
  handlerNotFoundCode: ERROR_CODES.CAPABILITY_NOT_FOUND,
  handlerErrorCode: ERROR_CODES.INTERNAL_ERROR,
  handlerTimeoutCode: ERROR_CODES.HANDLER_TIMEOUT,
  sdkUnreachableCode: ERROR_CODES.SDK_UNREACHABLE,
  invalidOwnerCode: ERROR_CODES.CAPABILITY_NOT_FOUND,
};

export class InvocationDispatcher {
  private readonly pending = new Map<string, PendingInvocation>();
  private nextCallId = 0;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly handlerTimeoutMs: number,
    private readonly clock: Clock,
    private readonly errorMapping: DispatchErrorMapping = DEFAULT_ERROR_MAPPING,
  ) {}

  /**
   * CID:dispatch-001 - dispatchInvocation
   * Send an invocation to the SDK connected for `owner = backend-sdk-<appId>`
   * and await its reply. Throws GatewayError on every documented failure mode
   * (no connection, owner prefix wrong, socket send throws, handler timeout,
   * socket closed mid-invoke, SDK-reported handler error).
   */
  async dispatchInvocation(
    owner: string,
    capabilityName: string,
    input: BackendValue,
    sessionId: string | undefined,
  ): Promise<BackendValue> {
    if (!owner.startsWith("backend-sdk-")) {
      throw new GatewayError(
        this.errorMapping.invalidOwnerCode,
        `dispatchInvocation called with non-backend-sdk owner "${owner}"`,
        { owner },
        false,
      );
    }
    const appId = owner.slice("backend-sdk-".length);
    const conn = this.registry.get(appId);
    if (!conn) {
      throw new GatewayError(
        this.errorMapping.sdkUnreachableCode,
        `no SDK connection for owner "${owner}"`,
        { owner, appId },
        true,
      );
    }

    const callId = `call-${++this.nextCallId}`;

    return new Promise<BackendValue>((resolve, reject) => {
      const timeoutHandle = this.clock.setTimeout(() => {
        this.pending.delete(callId);
        reject(new GatewayError(
          this.errorMapping.handlerTimeoutCode,
          `handler exceeded ${this.handlerTimeoutMs}ms`,
          { capability: capabilityName, timeoutMs: this.handlerTimeoutMs },
          true,
        ));
      }, this.handlerTimeoutMs);

      const cleanup = (): void => {
        this.clock.clearTimeout(timeoutHandle);
        this.pending.delete(callId);
      };

      const pending: PendingInvocation = {
        appId,
        timeoutHandle,
        resolve: (payload) => {
          cleanup();
          resolve(payload);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };
      this.pending.set(callId, pending);

      // Send sdk.invoke over the WebSocket. A send throw means the connection
      // is already dead — reject immediately with SDK_UNREACHABLE rather than
      // waiting for the timeout.
      const wireMessage = JSON.stringify({
        type: "sdk.invoke",
        callId,
        name: capabilityName,
        input,
        sessionId,
      });
      try {
        conn.socket.send(wireMessage);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cleanup();
        reject(new GatewayError(
          this.errorMapping.sdkUnreachableCode,
          `WebSocket send failed: ${message}`,
          { owner, capability: capabilityName, appId },
          true,
        ));
      }
    });
  }

  /**
   * CID:dispatch-002 - handleResult
   * Called by server.ts when `sdk.invoke.result` arrives. Resolves the matching
   * pending invocation with the SDK's payload. Returns true if the callId was
   * found (and resolved); false if no pending invocation matches (defensive —
   * late-arriving response after timeout or unknown callId).
   */
  handleResult(callId: string, payload: BackendValue): boolean {
    const inv = this.pending.get(callId);
    if (inv === undefined) return false;
    inv.resolve(payload);
    return true;
  }

  /**
   * CID:dispatch-003 - handleError
   * Called by server.ts when `sdk.invoke.error` arrives. Maps the SDK's error
   * code to the canonical GatewayError code (per the table at top of file)
   * and rejects the matching pending invocation.
   */
  handleError(callId: string, code: string, message: string): boolean {
    const inv = this.pending.get(callId);
    if (inv === undefined) return false;
    this.pending.delete(callId);
    this.clock.clearTimeout(inv.timeoutHandle);

    let gatewayCode: string;
    let retryable: boolean;
    switch (code) {
      case "HANDLER_NOT_FOUND":
        gatewayCode = this.errorMapping.handlerNotFoundCode;
        retryable = false;
        break;
      case "HANDLER_ERROR":
        gatewayCode = this.errorMapping.handlerErrorCode;
        retryable = false;
        break;
      default:
        // Unknown SDK code — surface as internal error. The SDK shouldn't
        // emit anything outside the two documented codes; log the deviance.
        gatewayCode = this.errorMapping.handlerErrorCode;
        retryable = false;
        break;
    }
    inv.reject(new GatewayError(
      gatewayCode,
      `SDK reports ${code}: ${message}`,
      { code, message, sdkCode: code },
      retryable,
    ));
    return true;
  }

  /**
   * CID:dispatch-004 - rejectAllPending
   * Called by server.ts when an SDK's socket closes mid-flight. Reject every
   * pending invocation owned by `appId` with SDK_UNREACHABLE (retryable).
   */
  rejectAllPending(appId: string, reason: string): void {
    for (const [callId, inv] of this.pending) {
      if (inv.appId !== appId) continue;
      this.pending.delete(callId);
      this.clock.clearTimeout(inv.timeoutHandle);
      inv.reject(new GatewayError(
        this.errorMapping.sdkUnreachableCode,
        `SDK connection closed mid-invoke: ${reason}`,
        { appId, callId, reason },
        true,
      ));
    }
  }
}