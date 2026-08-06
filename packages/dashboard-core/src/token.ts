/*
 * Code Map: dashboard token mint helper (D4 lock).
 *
 * Per-page-load mint: in-process call to gateway.issueToken with the locked
 * D4 claims (callerId dashboard-bot, scope platform.*.read,
 * expectedOrigins for both localhost:7200 + 127.0.0.1:7200 forms — W2 Q4
 * multi-origin support, 1h default TTL). Refresh = reload (page reload
 * re-fetches `GET /` which mints a fresh token; the adapter's mid-
 * connection re-auth exists but is NOT used in v1).
 *
 * CID Index:
 *   CID:token-001 -> mintDashboardToken
 *
 * Quick lookup: rg -n "CID:token-" packages/dashboard-core/src/
 */

import type { Gateway } from "@spanexx/gateway-core";
import type { Clock } from "@spanexx/gateway-core";
import { DASHBOARD_DEFAULT_PORT } from "./config.js";

// CID:token-001 - mintDashboardToken
// Purpose: produce the locked D4 token shape for the served dashboard page.
// Returns the raw JWT + the claims it was minted with (handy for tests
// and for the server's GET / token-injection step).
export interface DashboardMintResult {
  readonly token: string;
  readonly claims: {
    readonly sub: { readonly tenantId: string; readonly callerId: string };
    readonly scope: readonly string[];
    readonly expectedOrigins: readonly string[];
    readonly iat: number;
    readonly exp: number;
  };
}

export async function mintDashboardToken(
  gateway: Gateway,
  opts: {
    readonly clock: Clock;
    readonly tenantId?: string;
    readonly port?: number;
    readonly ttlMs?: number;
  },
): Promise<DashboardMintResult> {
  const port = opts.port ?? DASHBOARD_DEFAULT_PORT;
  const result = await gateway.issueToken({
    tenantId: opts.tenantId ?? "default",
    callerId: "dashboard-bot",
    scope: ["platform.*.read"],
    expiresInMs: opts.ttlMs ?? 60 * 60 * 1000,
    expectedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ],
  });
  return {
    token: result.token,
    // The full claims come back from issueToken — narrow to what callers need.
    claims: {
      sub: { tenantId: opts.tenantId ?? "default", callerId: "dashboard-bot" },
      scope: ["platform.*.read"],
      expectedOrigins: [
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ],
      iat: opts.clock.now(),
      exp: opts.clock.now() + (opts.ttlMs ?? 60 * 60 * 1000),
    },
  };
}