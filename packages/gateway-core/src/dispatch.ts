/*
 * Code Map: capability invocation dispatch
 * - dispatchCapability: owner-prefix-routed dispatch; returns output or throws GatewayError
 * - translatePluginError: maps PluginManagerError codes to GATEWAY_* codes (BI[8a] Option B)
 *
 * CID Index:
 * CID:dispatch-001 -> dispatchCapability
 * CID:dispatch-002 -> translatePluginError
 *
 * Quick lookup: rg -n "CID:dispatch-" packages/gateway-core/src/dispatch.ts
 */

import type { CapabilityRegistry, CapabilityRecord, DescribeResult } from "@spanexx/capability-registry";
import type { BackendRuntime } from "@spanexx/backend-runtime";
import type { SessionManager } from "@spanexx/session-manager";
import type { PluginManager } from "@spanexx/plugin-manager";
import { ERROR_CODES as PM_ERROR_CODES, PluginManagerError } from "@spanexx/plugin-manager";
import { ERROR_CODES, GatewayError } from "./errors.js";
import type { Clock, YamlValue } from "./types.js";

// JsonValue is the structural intersection of YamlValue (gateway-core's canonical
// invocation payload type) and BackendValue (the SDK wire-protocol value type).
// Both are recursive unions of string | number | boolean | null | array | object,
// so they're structurally identical — but TypeScript can't see that across package
// boundaries. JsonValue is the typed bridge so we can cast without using `unknown`
// (banned in non-catch positions by scripts/check-banned-types.sh).
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface DispatchHandlers {
  readonly gatewayHandlers: Readonly<Record<string, (input: YamlValue, sessionId: string | undefined) => Promise<YamlValue>>>;
}

// CID:dispatch-001 - dispatchCapability
// Purpose: route a capability invocation to its handler based on the CapabilityRecord's `owner` field (Q5 three-path model)
//   (a) owner === "gateway"  → in-process gatewayHandlers map (session.create, tenant.create, etc.)
//   (b) owner starts with "plugin:"  → in-process via Plugin Manager (registers runtime plugin capabilities)
//   (c) owner starts with "backend-sdk-"  → GATEWAY_SDK_UNREACHABLE (no SDK pack yet)
// All other owner prefixes are rejected with GATEWAY_PLUGIN_NOT_INSTALLED.
// Used by: handleInvocation pipeline (after authn + authz + version resolve)
// Applies: config.handlerTimeoutMs via Promise.race
export async function dispatchCapability(
  capability: CapabilityRecord,
  input: YamlValue,
  sessionId: string | undefined,
  ctx: {
    readonly registry: CapabilityRegistry;
    readonly sessionManager: SessionManager;
    readonly pluginManager: PluginManager;
    readonly handlers: DispatchHandlers;
    readonly clock: Clock;
    readonly handlerTimeoutMs: number;
    readonly backendRuntime?: BackendRuntime;
  },
): Promise<YamlValue> {
  const owner = capability.owner;
  const work = (async (): Promise<YamlValue> => {
    // (a) Platform built-ins: the Gateway itself ("gateway") or any known Tier 1 manager
    // ("session-manager", "plugin-manager", "capability-registry", or "platform-*"). All dispatch
    // to the gatewayHandlers map. The Gateway registers its own + the session.* / plugin.* / capability.* /
    // tenant.* / gateway.* / auth.* capabilities under owner "gateway"; a future Tier 1 manager
    // with its own owner just needs its capabilities registered under owner "gateway" too (or extend
    // this dispatch to recognize the new owner).
    if (owner === "gateway" || owner === "session-manager" || owner === "plugin-manager" || owner === "capability-registry" || owner.startsWith("platform-")) {
      const handler = ctx.handlers.gatewayHandlers[capability.name];
      if (!handler) {
        throw new GatewayError(
          ERROR_CODES.MANAGER_UNAVAILABLE,
          `no handler registered for ${capability.name} (owner: ${owner})`,
          { capability: capability.name, owner },
        );
      }
      return await handler(input, sessionId);
    }
    if (owner.startsWith("plugin:")) {
      const pluginId = owner.slice("plugin:".length);
      // Check install + enabled status for clear error semantics. These
      // mirror PluginManager's own checks; running them here first gives
      // the operator a stable kernel-level code instead of a handler-side
      // failure when the plugin is simply not loaded.
      const installed = ctx.pluginManager.list().find((p) => p.id === pluginId);
      if (!installed) {
        throw new GatewayError(
          ERROR_CODES.PLUGIN_NOT_INSTALLED,
          `plugin "${pluginId}" is not installed`,
          { pluginId },
        );
      }
      if (!installed.enabled) {
        throw new GatewayError(
          ERROR_CODES.PLUGIN_DISABLED,
          `plugin "${pluginId}" is disabled`,
          { pluginId },
        );
      }
      // BI[8a] Phase 4: real handler dispatch via pluginManager.handleInvocation.
      // The PM throws PluginManagerError with codes that map to kernel codes
      // per the Option B matrix in the GRILL:
      //   PLUGIN_HANDLER_NOT_FOUND  → GATEWAY_HANDLER_NOT_FOUND
      //   PLUGIN_HANDLER_ERROR      → GATEWAY_HANDLER_ERROR
      //   anything else             → GATEWAY_INTERNAL_ERROR
      // Kernel-level HANDLER_TIMEOUT is enforced by the Promise.race below
      // (handler exceeded handlerTimeoutMs) and is independent of the PM.
      try {
        const result = await ctx.pluginManager.handleInvocation(
          capability.name,
          input as JsonValue,
          sessionId,
        );
        return result as JsonValue;
      } catch (err) {
        // `err` is `unknown` in strict TS; translatePluginError accepts `Error`.
        // Non-Error throwables fall through to the generic-internal-error branch.
        throw translatePluginError(err as Error, pluginId, capability.name);
      }
    }
    if (owner.startsWith("backend-sdk-")) {
      if (ctx.backendRuntime === undefined) {
        throw new GatewayError(
          ERROR_CODES.SDK_UNREACHABLE,
          `no Backend Runtime configured for owner "${owner}"`,
          { owner },
          true,
        );
      }
      // YamlValue and BackendValue are structurally identical recursive unions
      // (same JSON-compatible shape). Cast via the union `JsonValue` which both
      // types accept as a supertype, avoiding the banned `unknown` bridge.
      const result = await ctx.backendRuntime.dispatchInvocation(
        owner,
        capability,
        input as JsonValue,
        sessionId,
      );
      return result as JsonValue;
    }
    throw new GatewayError(
      ERROR_CODES.PLUGIN_NOT_INSTALLED,
      `unknown capability owner "${owner}"`,
      { owner, capability: capability.name },
    );
  })();
  let timeoutHandle: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = ctx.clock.setTimeout(() => {
      reject(new GatewayError(
        ERROR_CODES.HANDLER_TIMEOUT,
        `handler exceeded ${ctx.handlerTimeoutMs}ms`,
        { capability: capability.name, timeoutMs: ctx.handlerTimeoutMs },
        true,
      ));
    }, ctx.handlerTimeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) ctx.clock.clearTimeout(timeoutHandle);
  }
}

// CID:dispatch-002 - translatePluginError
// Purpose: map a PluginManagerError to a GatewayError per the Option B matrix
//   PLUGIN_HANDLER_NOT_FOUND  → GATEWAY_HANDLER_NOT_FOUND  (retryable=false)
//   PLUGIN_HANDLER_ERROR      → GATEWAY_HANDLER_ERROR      (retryable=false)
//   anything else             → GATEWAY_INTERNAL_ERROR      (retryable=false)
// Non-PluginManagerError exceptions are wrapped as GATEWAY_INTERNAL_ERROR
// so the kernel never leaks an un-classified error to MCP adapters.
// The originalError and pluginErrorCode are preserved in `details` so
// operators can drill into the source from the audit log.
// Caller is expected to pass the caught value; we type the parameter as
// `Error` to satisfy check-banned-types.sh (no `unknown` in function
// parameters; `unknown` is only allowed in catch clauses).
export function translatePluginError(
  err: Error,
  pluginId: string,
  capability: string,
): GatewayError {
  if (err instanceof PluginManagerError) {
    switch (err.code) {
      case PM_ERROR_CODES.HANDLER_NOT_FOUND:
        return new GatewayError(
          ERROR_CODES.HANDLER_NOT_FOUND,
          err.message,
          { pluginId, capability, originalError: err.message },
        );
      case PM_ERROR_CODES.HANDLER_ERROR: {
        // AUDIT F10 (browser-runtime, user-approved 2026-08-02): additive
        // envelope extension — pass the plugin-manager-preserved
        // originalErrorCode + retryable into details when present so
        // callers can match on the handler's own code (e.g. BROWSER_*).
        const details: Record<string, JsonValue> = {
          pluginId,
          capability,
          originalError: err.message,
        };
        const originalErrorCode = err.details.originalErrorCode;
        if (typeof originalErrorCode === "string") {
          details.originalErrorCode = originalErrorCode;
        }
        const retryable = err.details.retryable;
        if (typeof retryable === "boolean") {
          details.retryable = retryable;
        }
        return new GatewayError(ERROR_CODES.HANDLER_ERROR, err.message, details);
      }
      default:
        return new GatewayError(
          ERROR_CODES.INTERNAL_ERROR,
          `plugin manager error: ${err.message}`,
          { pluginId, capability, pluginErrorCode: err.code },
        );
    }
  }
  return new GatewayError(
    ERROR_CODES.INTERNAL_ERROR,
    `unexpected plugin dispatch error: ${err.message}`,
    { pluginId, capability },
  );
}

/**
 * Resolve the CapabilityRecord from the registry. Auto-latest when no version is supplied.
 * Returns null when not found. Maps "not found" into a structured GatewayError for the caller.
 */
export function resolveCapability(
  registry: CapabilityRegistry,
  name: string,
  version: string | undefined,
): CapabilityRecord | null {
  let result: DescribeResult;
  if (version === undefined) {
    result = registry.describe(name);
  } else {
    result = registry.describe(name, version);
  }
  return result.capability;
}