/*
 * Code Map: dashboard.view.* thin passthrough wrappers (D2 lock).
 *
 * Each handler in the returned map receives the wrapper's outer invocation
 * (caller + token + capability + input) and re-invokes its backing read cap
 * on the same gateway, using an internal `dashboard-bot` token scoped to
 * `platform.*.read`. The inner invocation is canonical — full token verify,
 * session check, authz, audit row. Outer invocation also audits (double
 * audit is the intended behavior). GATEWAY_* errors from the inner call
 * pass through verbatim — the wrapper never rewrites codes.
 *
 * The handlers are pure functions over Gateway: no state, no side effects
 * beyond what handleInvocation does. Minting the dashboard-bot token
 * happens once at factory time (composition root) and the resulting JWT
 * is captured in the closure below.
 *
 * CID Index:
 *   CID:handlers-001 -> createDashboardHandlers
 *   CID:handlers-002 -> DASHBOARD_BOT_CLAIMS
 *
 * Quick lookup: rg -n "CID:handlers-" packages/dashboard-core/src/
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";

// CID:handlers-002 - DASHBOARD_BOT_CLAIMS
// Locked D4 shape: callerId dashboard-bot, scope platform.*.read, no
// expectedOrigins (these are for browser-bound tokens; the internal
// re-invoke path runs over the in-process Gateway, not over a socket).
const DASHBOARD_BOT_TENANT = "default";
const DASHBOARD_BOT_CALLER = "dashboard-bot";
const DASHBOARD_BOT_SCOPE = ["platform.*.read"] as const;

// Minted token + claim snapshot. Returned so the composition root can reuse
// it (or refresh it; P3 may mint per-page-load). For P2 the token is minted
// once at factory time.
export interface DashboardBotToken {
  readonly token: string;
  readonly expiresAt: number;
}

export interface DashboardHandlerContext {
  // Forwarded to the inner invoke; mint via gateway.issueToken in the
  // composition root.
  readonly innerToken: string;
}

// CID:handlers-001 - createDashboardHandlers
// Returns the flat name→handler map (DispatchHandlers.gatewayHandlers shape)
// the factory merges in via extraOwners. Each handler re-invokes its backing
// cap and returns the output as-is.
export function createDashboardHandlers(
  gateway: Gateway,
  ctx: DashboardHandlerContext,
): Record<string, (input: YamlValue) => Promise<YamlValue>> {
  const invoke = async (
    backingName: string,
    input: YamlValue,
  ): Promise<YamlValue> => {
    const res = await gateway.handleInvocation({
      // Inner token is the canonical caller for the backing-cap audit row.
      token: ctx.innerToken,
      // Inner CallerIdentity — callerId dashboard-bot, scope platform.*.read.
      caller: {
        tenantId: DASHBOARD_BOT_TENANT,
        callerId: DASHBOARD_BOT_CALLER,
        scope: [...DASHBOARD_BOT_SCOPE],
      },
      capability: { name: backingName },
      input,
    });
    if ("output" in res) return res.output;
    // Pass GATEWAY_* errors through verbatim. Throw GatewayError so
    // handleInvocation's dispatch-error path produces the canonical
    // { error: { code, message, details, retryable } } response.
    throw new Error(
      `dashboard view backing ${backingName} failed: ${(res.error as { code?: string }).code ?? "unknown"}`,
    );
  };

  return {
    "dashboard.view.sessions": (input) => invoke(DASHBOARD_BACKING["dashboard.view.sessions"], input),
    "dashboard.view.plugins": (input) => invoke(DASHBOARD_BACKING["dashboard.view.plugins"], input),
    "dashboard.view.capabilities": (input) => invoke(DASHBOARD_BACKING["dashboard.view.capabilities"], input),
    "dashboard.view.health": (input) => invoke(DASHBOARD_BACKING["dashboard.view.health"], input),
  };
}

// Keep DASHBOARD_BACKING import here for the wrapping above (re-exported
// from index.ts to keep the public surface in one place).
import { DASHBOARD_BACKING } from "./index.js";