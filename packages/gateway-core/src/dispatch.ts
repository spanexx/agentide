/*
 * Code Map: capability invocation dispatch
 * - dispatchCapability: owner-prefix-routed dispatch; returns output or throws GatewayError
 *
 * CID Index:
 * CID:dispatch-001 -> dispatchCapability
 *
 * Quick lookup: rg -n "CID:dispatch-" packages/gateway-core/src/dispatch.ts
 */

import type { CapabilityRegistry, CapabilityRecord, DescribeResult } from "@platform/capability-registry";
import type { SessionManager } from "@platform/session-manager";
import type { PluginManager } from "@platform/plugin-manager";
import { ERROR_CODES, GatewayError } from "./errors.js";
import type { Clock, YamlValue } from "./types.js";

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
  },
): Promise<YamlValue> {
  const owner = capability.owner;
  const work = (async (): Promise<YamlValue> => {
    if (owner === "gateway") {
      const handler = ctx.handlers.gatewayHandlers[capability.name];
      if (!handler) {
        throw new GatewayError(
          ERROR_CODES.INTERNAL_ERROR,
          `gateway has no handler for ${capability.name}`,
          { capability: capability.name },
        );
      }
      return await handler(input, sessionId);
    }
    if (owner.startsWith("plugin:")) {
      const pluginId = owner.slice("plugin:".length);
      // Check install + enabled status for clear error semantics.
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
      // NOTE[agent]: runtime plugin handler dispatch is deferred to a follow-up pack.
      // The Plugin Manager doesn't yet expose a `handleInvocation(owner, capability, input)`
      // API that returns the registered handler. When that lands, dispatch replaces
      // the MANAGER_UNAVAILABLE below with a synchronous handler call.
      throw new GatewayError(
        ERROR_CODES.MANAGER_UNAVAILABLE,
        `runtime plugin dispatch is not yet wired (${capability.name})`,
        { pluginId, capability: capability.name },
        true,
      );
    }
    if (owner.startsWith("backend-sdk-")) {
      throw new GatewayError(
        ERROR_CODES.SDK_UNREACHABLE,
        `no Backend SDK pack installed yet for owner "${owner}"`,
        { owner },
        true,
      );
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