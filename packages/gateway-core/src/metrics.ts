/*
 * Code Map: gateway metrics counter (D-46 closeout).
 * The gateway.metrics capability returns a snapshot of these counters.
 * Increment points are the canonical handleInvocation exit paths:
 *   - auditOk        → invocations.ok
 *   - auditError     → invocations.error (handler/schema failures)
 *   - exitWithError  → invocations.denied (+ rateLimitDenials / authFailures
 *                      sub-buckets classified from the error code)
 *
 * CID Index:
 * CID:metrics-001 - createMetricsCounter
 * CID:metrics-002 - GatewayMetricsSnapshot shape (stable — interface forever)
 *
 * Quick lookup: rg -n "CID:metrics-" packages/gateway-core/src/metrics.ts
 */

import { ERROR_CODES } from "./errors.js";

// CID:metrics-002 - snapshot shape. Kept identical to the pre-D-46
// placeholder shape so consumers (dashboard Metrics view, Grafana-style
// panels) see the same contract, now with real numbers.
export interface GatewayMetricsSnapshot {
  readonly invocations: {
    readonly ok: number;
    readonly denied: number;
    readonly error: number;
  };
  readonly rateLimitDenials: number;
  readonly authFailures: number;
}

export interface MetricsCounter {
  snapshot(): GatewayMetricsSnapshot;
  recordOk(): void;
  recordError(): void;
  recordDenied(code: string): void;
}

const AUTH_FAILURE_CODES = new Set<string>([
  ERROR_CODES.AUTH_FAILED,
  ERROR_CODES.TOKEN_INVALID,
  ERROR_CODES.TOKEN_EXPIRED,
]);

// CID:metrics-001 - createMetricsCounter
export function createMetricsCounter(): MetricsCounter {
  const counts = {
    invocations: { ok: 0, denied: 0, error: 0 },
    rateLimitDenials: 0,
    authFailures: 0,
  };

  return {
    snapshot: () => ({
      invocations: { ...counts.invocations },
      rateLimitDenials: counts.rateLimitDenials,
      authFailures: counts.authFailures,
    }),
    recordOk: () => {
      counts.invocations.ok += 1;
    },
    recordError: () => {
      counts.invocations.error += 1;
    },
    recordDenied: (code) => {
      counts.invocations.denied += 1;
      if (code === ERROR_CODES.RATE_LIMIT_EXCEEDED) counts.rateLimitDenials += 1;
      if (AUTH_FAILURE_CODES.has(code)) counts.authFailures += 1;
    },
  };
}
